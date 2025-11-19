/**
 * @fileoverview 記事画像選択サービス
 * 記事の内容（タグ、タイトル、トピックキーなど）に基づいて、
 * 登録された画像プールから最適な画像を自動で選択する機能を提供します。
 *
 * 特徴:
 * - トピックやカテゴリによるマッチング: 記事のキーワードと画像のトピックを照合します。
 * - 決定論的な選択: 同じ記事内容（シード）であれば、常に同じ画像が選択されることを保証します。
 * - フォールバック: 適切な画像が見つからない場合、デフォルトの画像を使用します。
 */

const { normalizeTagToken } = require('./tokenUtils');

/**
 * 配列（プール）から決定論的に（＝常に同じ結果になるように）要素を1つ選択します。
 * `seed` 文字列からハッシュ値を生成し、その値を使って配列のインデックスを決定します。
 * これにより、同じ `seed` であれば何度実行しても同じ要素が返されます。
 * @param {Array<*>} pool - 選択候補の配列
 * @param {string} [seed=''] - 選択の基準となるシード文字列
 * @returns {*} 選択された要素。プールが空の場合はnullを返します。
 */
const deterministicPickFromPool = (pool, seed = '') => {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const normalizedSeed = seed ? String(seed) : 'ai-info-blog';
  
  // 文字列から簡易的なハッシュ値を生成する
  let hash = 0;
  for (let i = 0; i < normalizedSeed.length; i += 1) {
    // 31は素数で、ハッシュ値の衝突を減らすためによく使われる
    hash = (hash * 31 + normalizedSeed.charCodeAt(i)) & 0xffffffff; // 32ビット整数に収める
  }
  
  // ハッシュ値を配列のインデックスに変換
  const index = Math.abs(hash) % pool.length;
  return pool[index];
};

/**
 * 記事画像のプールを構築します。
 * マニフェストファイル（`assets/img/articles/index.json`）から画像一覧を読み込み、
 * 検索しやすいように各画像のトピックやカテゴリを正規化します。
 * @param {Function} readJson - JSONファイルを読み込むための関数
 * @param {string} manifestPath - 画像マニフェストファイルのパス
 * @returns {Array<object>} 正規化された画像情報の配列
 */
const buildArticleImagePool = (readJson, manifestPath) => {
  const manifest = readJson(manifestPath, []);
  if (!Array.isArray(manifest)) return [];
  
  return manifest
    .map((item, index) => {
      if (!item || !item.key || !item.src) return null;
      
      // 画像に紐づくトピックを正規化（小文字化、ハイフン化など）
      const topics = Array.isArray(item.topics)
        ? item.topics.map((topic) => normalizeTagToken(topic)).filter(Boolean)
        : [];
        
      return {
        key: item.key,
        src: item.src,
        alt: item.alt || item.label || 'AI情報ブログのビジュアル',
        label: item.label || null,
        description: item.description || null,
        category: normalizeTagToken(item.category) || null,
        topics,
        // isDefaultフラグがあるか、最初の画像をデフォルトとして扱う
        isDefault: Boolean(item.isDefault) || index === 0,
      };
    })
    .filter(Boolean); // 不正なデータをフィルタリング
};

/**
 * 記事と候補のデータから、画像選択のヒントとなるトークン（単語）を収集します。
 * @param {object} article - 生成された記事データ
 * @param {object} candidate - 元となった候補データ
 * @returns {Set<string>} 収集・正規化されたトークンのSet
 */
const gatherImageTokens = (article, candidate) => {
  const tokens = new Set();
  const pushToken = (value) => {
    const normalized = normalizeTagToken(value);
    if (normalized) tokens.add(normalized);
  };

  // 記事のタグからトークンを収集
  if (article?.tags) {
    article.tags.forEach((tag) => {
      if (!tag) return;
      if (typeof tag === 'string') {
        pushToken(tag);
        return;
      }
      pushToken(tag.slug);
      pushToken(tag.label);
      pushToken(tag.category);
    });
  }

  // 候補のソース（チャンネル）の専門分野からトークンを収集
  if (candidate?.source?.focus) {
    candidate.source.focus.forEach(pushToken);
  }

  // トピックキーとその構成要素からトークンを収集
  if (candidate?.topicKey) {
    pushToken(candidate.topicKey);
    candidate.topicKey.split(/[-_]+/).forEach(pushToken);
  }

  // 記事のスラグとその構成要素からトークンを収集
  if (article?.slug) {
    pushToken(article.slug);
    article.slug.split(/[-_]+/).forEach(pushToken);
  }

  // 記事と動画のタイトルからトークンを収集
  const injectFromTitle = (title) => {
    if (!title) return;
    title
      .split(/[\s・／/、。:+\-]+/)
      .map((token) => token.trim())
      .forEach(pushToken);
  };
  injectFromTitle(article?.title);
  injectFromTitle(candidate?.video?.title);

  return tokens;
};

/**
 * 画像選択サービスのファクトリ関数。
 * 依存関係（`readJson`関数とマニフェストパス）を注入して、`selectArticleImage`関数を生成します。
 * @param {{readJson: Function, manifestPath: string}} dependencies - 依存関係
 * @returns {{selectArticleImage: Function}} `selectArticleImage`メソッドを持つオブジェクト
 */
const createImageSelector = ({ readJson, manifestPath }) => {
  // サービス初期化時に画像プールを構築
  const articleImagePool = buildArticleImagePool(readJson, manifestPath);
  // デフォルト画像を設定
  const defaultArticleImage =
    articleImagePool.find((item) => item.isDefault) || articleImagePool[0] || null;

  /**
   * 記事データと候補データに基づいて、最適な画像を1枚選択します。
   * @param {object} article - 生成された記事データ
   * @param {object} candidate - 元となった候補データ
   * @returns {object|null} 選択された画像情報、またはnull
   */
  const selectArticleImage = (article, candidate) => {
    if (!articleImagePool.length) return null;
    
    // 1. 記事内容からトークンを収集
    const tokens = gatherImageTokens(article, candidate);
    
    // 2. トークンにマッチする画像をプールから検索
    const matched = articleImagePool.filter((entry) => {
      if (!entry) return false;
      // 画像のトピックかカテゴリが、収集したトークンに含まれているかチェック
      if (entry.topics.some((topic) => tokens.has(topic))) return true;
      if (entry.category && tokens.has(entry.category)) return true;
      return false;
    });
    
    // 3. 決定論的な選択のためのシードを決定
    const seed =
      candidate?.topicKey || article?.slug || article?.title || candidate?.id || 'ai-info';
      
    // 4. マッチした画像があればその中から、なければ全画像の中から決定論的に1枚選択
    const pool = matched.length > 0 ? matched : articleImagePool;
    const picked = deterministicPickFromPool(pool, seed) || defaultArticleImage;
    
    if (!picked) return null;
    
    // 5. 最終的な画像情報を整形して返す
    return {
      key: picked.key,
      src: picked.src,
      alt: picked.alt,
      label: picked.label,
      caption: picked.description || picked.label || '',
      category: picked.category,
    };
  };

  return { selectArticleImage };
};

module.exports = {
  createImageSelector,
};