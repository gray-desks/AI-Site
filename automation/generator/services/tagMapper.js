/**
 * @fileoverview タグマッピングサービス
 *
 * AIが生成したタグ（自由な文字列）を、`data/tags.json`で事前定義された
 * 正規のタグ情報（slug, label, category, styleなど）にマッピング（対応付け）する機能を提供します。
 *
 * 【主な機能】
 *
 * 1. 正規化されたタグ名とエイリアスによるマッチング
 *    - 大文字・小文字やハイフンなどを無視して柔軟に照合します
 *    - 例: "ChatGPT", "chat gpt", "CHATGPT" は全て同じタグとして認識されます
 *
 * 2. 未登録タグの自動生成
 *    - 辞書にないタグが見つかった場合、その場で新しいタグ情報を自動生成します
 *    - ユニークなslugを生成し、適切な色スタイルも自動的に割り当てられます
 *
 * 3. 色の自動選択（重要な機能！）
 *    - カテゴリベース: タグのカテゴリに応じて推奨色を選択
 *      例: 「ニュース」→スカイブルー、「ガバナンス」→オレンジ
 *    - ハッシュベース: カテゴリがない場合、タグ名から決定的に色を選択
 *      同じタグ名は常に同じ色になることが保証されます
 *
 * 4. 重複タグの除去
 *    - 最終的なタグリストに同じタグが複数含まれないようにします
 *
 * 【処理の流れ】
 * 入力: ["ChatGPT", "新技術", "AI活用"]
 *   ↓
 * 正規化・辞書検索
 *   ↓
 * 出力: [
 *   { slug: "chatgpt", label: "ChatGPT", category: "ツール", style: "accent-purple" },
 *   { slug: "xin-ji-shu", label: "新技術", category: "その他", style: "accent-pink" },
 *   { slug: "ai-utilization", label: "AI活用", category: "ユースケース", style: "accent-teal" }
 * ]
 */

const slugify = require('../../lib/slugify');
const { normalizeTagToken } = require('./tokenUtils');

/**
 * 利用可能なタグスタイルのリスト
 *
 * このリストには、`assets/css/components/tags.css`で定義されている
 * 全てのaccent-*スタイルが含まれています。
 *
 * 各スタイルは美しいグラデーション背景と、ホバー時の光エフェクトを持っています。
 *
 * 【注意】
 * 新しい色スタイルをCSSに追加した場合は、このリストにも追加してください。
 * リストの順序が変わると、ハッシュベースの色選択の結果も変わるため、
 * 一度決めた順序は変更しないことを推奨します。
 */
const AVAILABLE_TAG_STYLES = [
  'accent-sky',      // スカイブルー - ニュース、学習リソース向け
  'accent-pink',     // ピンク - 技術トピック、生成AI向け
  'accent-purple',   // パープル - ツール、企業・プロダクト向け
  'accent-lime',     // ライムグリーン - ユースケース向け
  'accent-gold',     // ゴールド - スキル向け
  'accent-lavender', // ラベンダー - ツール機能向け
  'accent-teal',     // ティール - ユースケース、ヘルスケア向け
  'accent-orange',   // オレンジ - ガバナンス、セキュリティ向け
  'accent-blue',     // ブルー - 開発向け
];

/**
 * 文字列から簡易的なハッシュ値を計算します
 *
 * この関数は、同じ文字列からは常に同じハッシュ値が生成される「決定的な」ハッシュ関数です。
 * これにより、同じタグ名には常に同じ色が割り当てられることが保証されます。
 *
 * 例: 「ブロックチェーン」というタグは、何度処理しても必ず同じ色になります。
 *
 * @param {string} str - ハッシュ化する文字列
 * @returns {number} ハッシュ値（非負整数）
 */
const simpleHash = (str) => {
  let hash = 0;
  if (!str || str.length === 0) return hash;

  // 文字列の各文字をループして、ハッシュ値を計算
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i); // 文字のUnicodeコードポイントを取得
    hash = ((hash << 5) - hash) + char; // (hash * 31) + char と同じ意味（ビットシフトで高速化）
    hash = hash & hash; // 32bit整数に変換（オーバーフロー防止）
  }

  // 負の数になる可能性があるため、絶対値を返す
  return Math.abs(hash);
};

/**
 * タグのカテゴリに基づいて推奨される色スタイルを返します
 *
 * カテゴリごとに最適な色を事前にマッピングしています。
 * これにより、同じカテゴリのタグは統一感のある色になります。
 *
 * 例:
 * - 「ニュース」カテゴリのタグ → 爽やかなスカイブルー
 * - 「技術トピック」カテゴリのタグ → 目を引くピンク
 * - 「ガバナンス」カテゴリのタグ → 警告を連想させるオレンジ
 *
 * @param {string} category - タグのカテゴリ（例: 「ニュース」「技術トピック」など）
 * @returns {string|null} 推奨される色スタイル、または該当なしの場合は null
 */
const getStyleByCategory = (category) => {
  // カテゴリと色スタイルの対応表
  // この対応関係は、色の持つイメージとカテゴリの性質を考慮して設計されています
  const categoryStyleMap = {
    'ニュース': 'accent-sky',           // スカイブルー: 情報を連想させる爽やかな色
    '技術トピック': 'accent-pink',      // ピンク: 技術・イノベーションを表現
    'ツール': 'accent-purple',          // パープル: ツールの洗練さを表現
    'ユースケース': 'accent-lime',      // ライムグリーン: 実用性・活用を連想
    'スキル': 'accent-gold',            // ゴールド: スキル・価値を連想させる高級感
    'ツール機能': 'accent-lavender',    // ラベンダー: 機能の柔軟性を表現
    'ガバナンス': 'accent-orange',      // オレンジ: 注意・警告を連想させる色
    '開発': 'accent-blue',              // ブルー: 開発・技術的な印象
    '企業・プロダクト': 'accent-purple', // パープル: 企業ブランドの高級感
    '学習リソース': 'accent-sky',       // スカイブルー: 学習・知識を連想
    '社会課題': 'accent-orange',        // オレンジ: 課題への注目を促す色
  };

  // カテゴリがマップに存在すればその色を返し、なければnullを返す
  return categoryStyleMap[category] || null;
};

/**
 * タグ名から決定的に色スタイルを選択します
 *
 * この関数は2段階の色選択ロジックを持っています:
 *
 * 【第1段階】カテゴリベースの選択
 *   カテゴリに推奨色があれば、それを優先的に使用します。
 *   例: 「ニュース」カテゴリ → 必ずスカイブルー
 *
 * 【第2段階】ハッシュベースの選択
 *   カテゴリに推奨色がない場合（例: 「その他」カテゴリ）、
 *   タグ名から計算したハッシュ値を使って色を決定的に選びます。
 *   同じタグ名は常に同じ色になることが保証されます。
 *
 * この仕組みにより、新しいタグが生成されても自動的に適切な色が割り当てられます。
 *
 * @param {string} tagLabel - タグのラベル（例: 「ChatGPT」「ブロックチェーン」）
 * @param {string} category - タグのカテゴリ（デフォルト: 「その他」）
 * @returns {string} 色スタイル名（例: 'accent-sky', 'accent-pink'）
 */
const selectStyleForTag = (tagLabel, category = 'その他') => {
  // ステップ1: カテゴリに基づく推奨色があればそれを使用
  const categoryStyle = getStyleByCategory(category);
  if (categoryStyle) {
    return categoryStyle;
  }

  // ステップ2: カテゴリに基づく推奨がない場合、タグ名のハッシュから決定的に選択
  // タグ名をハッシュ化して数値に変換
  const hash = simpleHash(tagLabel);
  // ハッシュ値を利用可能な色の数で割った余りをインデックスとして使用
  // 例: ハッシュ値が1234で色が9種類なら、1234 % 9 = 7 → 7番目の色を選択
  const index = hash % AVAILABLE_TAG_STYLES.length;
  return AVAILABLE_TAG_STYLES[index];
};

/**
 * タグ辞書を構築します。
 *
 * この関数は、`data/tags.json`から事前定義されたタグ情報を読み込み、
 * 高速検索のためのインデックス（Map）を作成します。
 *
 * 【インデックスの仕組み】
 * インデックスは、正規化されたタグ名（トークン）をキーとして、
 * 対応するタグオブジェクトを値として保持します。
 *
 * 例:
 *   "chatgpt" → { slug: "chatgpt", label: "ChatGPT", category: "ツール", style: "accent-purple" }
 *   "chat gpt" → 同じオブジェクト（エイリアス）
 *   "gpt-4o" → 同じオブジェクト（エイリアス）
 *
 * この仕組みにより、AIが「chat gpt」や「GPT-4o」といった表記揺れのあるタグを生成しても、
 * 全て「ChatGPT」という統一されたタグにマッピングすることができます。
 *
 * @param {Function} readJson - JSONファイルを読み込むための関数
 * @param {string} tagsConfigPath - タグ定義ファイル（`tags.json`）のパス
 * @returns {{entries: Array<object>, index: Map<string, object>}} タグの生データ配列と、検索用インデックスMap
 */
const buildTagDictionary = (readJson, tagsConfigPath) => {
  // tags.jsonファイルを読み込む
  const raw = readJson(tagsConfigPath, []);
  const entries = Array.isArray(raw) ? raw : [];

  // `正規化されたトークン -> タグオブジェクト` のマッピングを保持するMap
  // Mapを使うことで、O(1)の高速な検索が可能になります
  const index = new Map();

  /**
   * トークン（正規化されたタグ名）をインデックスに登録します。
   *
   * 同じタグに対して複数のトークン（slug、label、エイリアス）を登録することで、
   * 様々な表記揺れに対応できるようになります。
   *
   * 例: 「ChatGPT」タグの場合、以下のトークンが全て同じタグオブジェクトを指します:
   *   - "chatgpt" (slugから)
   *   - "chatgpt" (labelから、正規化すると同じ)
   *   - "gpt4o" (エイリアス "gpt-4o" から)
   *   - "chatgpt" (エイリアス "chat gpt" から)
   *
   * @param {string} token - 正規化されたトークン
   * @param {object} entry - 対応するタグオブジェクト
   */
  const registerToken = (token, entry) => {
    // トークンが空、または既にインデックスに存在する場合は何もしない
    // （最初に登録されたものを優先）
    if (!token || index.has(token)) return;
    index.set(token, entry);
  };

  // `tags.json` の各エントリを処理してインデックスを構築
  entries.forEach((item) => {
    // slug がないエントリは無効なので、スキップ
    if (!item || !item.slug) return;

    // タグ情報を正規化（欠損値にデフォルト値を設定）
    const normalizedEntry = {
      slug: item.slug,                          // タグのユニークな識別子
      label: item.label || item.slug,           // 表示用のラベル
      category: item.category || 'その他',      // カテゴリ
      style: item.style || null,                // 色スタイル
    };

    // slug, label, および各エイリアスをトークンとしてインデックスに登録
    // これにより、どの表記でもタグを見つけられるようになります
    registerToken(normalizeTagToken(item.slug), normalizedEntry);
    registerToken(normalizeTagToken(item.label), normalizedEntry);

    // エイリアス（別名）があれば、それらもすべて登録
    if (Array.isArray(item.aliases)) {
      item.aliases.forEach((alias) => registerToken(normalizeTagToken(alias), normalizedEntry));
    }
  });

  return { entries, index };
};

/**
 * タグマッパーのインスタンスを作成するファクトリ関数です。
 *
 * この関数は、依存関係（JSONファイル読み込み関数とタグ定義ファイルのパス）を受け取り、
 * タグマッピング機能を提供するオブジェクトを返します。
 *
 * ファクトリパターンを使用することで、タグ辞書の初期化を遅延させ、
 * テスト時にモック関数を注入しやすくしています。
 *
 * @param {{readJson: Function, tagsConfigPath: string}} dependencies - 依存関係オブジェクト
 * @returns {{mapArticleTags: Function}} `mapArticleTags` メソッドを持つオブジェクト
 */
const createTagMapper = ({ readJson, tagsConfigPath }) => {
  // タグ辞書を遅延初期化（Lazy Initialization）するための変数
  // 初回のmapArticleTagsの呼び出し時にのみ構築されます
  let tagDictionary = null;

  /**
   * タグ辞書が初期化されていることを保証し、それを返します。
   *
   * この関数は遅延初期化パターンを実装しています。
   * 辞書がまだ構築されていない場合のみ、buildTagDictionaryを呼び出します。
   *
   * @returns {object} タグ辞書オブジェクト
   */
  const ensureDictionary = () => {
    if (!tagDictionary) {
      tagDictionary = buildTagDictionary(readJson, tagsConfigPath);
    }
    return tagDictionary;
  };

  /**
   * AIが生成した生のタグ配列を、定義済みの正規タグ情報にマッピングします。
   *
   * この関数は、AIが出力した自由なタグ文字列を受け取り、以下の処理を行います:
   *
   * 【処理フロー】
   * 1. 既存タグとのマッチング
   *    - tags.jsonに定義されたタグとマッチするか検索
   *    - エイリアス（別名）も考慮して柔軟にマッチング
   *
   * 2. 新規タグの自動生成
   *    - マッチしない場合、新しいタグとして自動生成
   *    - ユニークなslugを生成し、適切な色を自動的に割り当て
   *
   * 3. 重複の除去
   *    - 同じタグが複数回出現しても、結果には1回だけ含まれる
   *
   * 【具体例】
   * 入力: ["ChatGPT", "chat gpt", "新技術"]
   * 出力: [
   *   { slug: "chatgpt", label: "ChatGPT", category: "ツール", style: "accent-purple" },
   *   { slug: "xin-ji-shu", label: "新技術", category: "その他", style: "accent-pink" }
   * ]
   * ※ "ChatGPT"と"chat gpt"は同じタグとして認識され、重複が除去されます
   *
   * @param {Array<string>} rawTags - AIが生成したタグ文字列の配列
   * @returns {Array<object>} マッピングおよび正規化されたタグオブジェクトの配列
   */
  const mapArticleTags = (rawTags) => {
    // 入力が配列でない、または空の場合は空配列を返す
    if (!Array.isArray(rawTags) || rawTags.length === 0) return [];

    // 処理済みのタグslugを記録し、重複を防ぐためのSet
    const seen = new Set();
    // 最終的に返すタグオブジェクトの配列
    const tags = [];
    // タグ辞書を取得（初回のみ構築される）
    const dictionary = ensureDictionary();

    // 各タグを順番に処理
    rawTags.forEach((tag, idx) => {
      // タグ名を正規化（小文字化、記号除去など）
      const token = normalizeTagToken(tag);
      if (!token) return; // 正規化の結果が空なら、このタグをスキップ

      // ========================================
      // ステップ1: 既存タグとのマッチングを試みる
      // ========================================
      const matched = dictionary.index.get(token);
      if (matched) {
        // マッチした！既存のタグ定義が見つかった

        // 既に同じタグが追加されていればスキップ（重複除去）
        if (seen.has(matched.slug)) return;

        // このタグを処理済みとしてマーク
        seen.add(matched.slug);

        // タグオブジェクトを結果配列に追加
        tags.push({
          slug: matched.slug,                      // タグの識別子
          label: matched.label || matched.slug,    // 表示用ラベル
          category: matched.category || 'その他',  // カテゴリ
          style: matched.style || null,            // 色スタイル
        });
        return; // 次のタグの処理へ
      }

      // ========================================
      // ステップ2: 辞書にない場合、新しいタグとして自動生成
      // ========================================
      // マッチしなかった！このタグは未登録なので、新規タグとして生成する

      // 元のタグ名をトリミング（前後の空白を削除）
      const originalLabel = String(tag ?? '').trim();
      if (!originalLabel) return; // 空文字列なら処理をスキップ

      // ========================================
      // 2-1: ユニークなスラグ（識別子）を生成
      // ========================================
      // まずslugify関数を使って基本的なスラグを生成
      // 例: "新しい技術" → "xin-ji-shu"
      const fallbackBase = slugify(originalLabel, 'tag');
      let fallbackSlug = fallbackBase;

      // スラグが汎用的な 'tag' になってしまったり、既に使われているスラグの場合は、
      // よりユニークなスラグを生成する必要がある
      if (fallbackBase === 'tag' || seen.has(fallbackBase)) {
        // 日本語や特殊文字を含むタグ名を、URLに使える形式に変換
        const sanitizedLabel = originalLabel
          .normalize('NFKC')            // Unicode正規化（全角英数を半角に統一など）
          .toLowerCase()                // 小文字に変換
          .replace(/\s+/g, '-')         // 空白をハイフンに置換
          .replace(/[^a-z0-9\-]/g, '')  // 英数字とハイフン以外を削除
          .replace(/-+/g, '-')          // 連続するハイフンを1つに統合
          .replace(/^-|-$/g, '');       // 先頭と末尾のハイフンを削除

        // 変換後も有効なスラグが得られない場合は、連番を使用
        fallbackSlug = sanitizedLabel || `tag-${idx + 1}`;

        // それでも重複する場合は、末尾に連番を付与してユニークにする
        // 例: "ai" が既に存在する場合 → "ai-1", "ai-2", ...
        let counter = 1;
        let candidateSlug = fallbackSlug;
        while (seen.has(candidateSlug)) {
          candidateSlug = `${fallbackSlug}-${counter}`;
          counter += 1;
        }
        fallbackSlug = candidateSlug;
      }

      // 最終チェック: 万が一まだ重複していたらスキップ
      if (seen.has(fallbackSlug)) return;
      seen.add(fallbackSlug); // このスラグを使用済みとしてマーク

      // ========================================
      // 2-2: 新しいタグオブジェクトを作成して追加
      // ========================================
      const newTagLabel = originalLabel || `タグ${idx + 1}`;  // 表示用ラベル
      const newTagCategory = 'その他';                         // カテゴリはデフォルトで「その他」

      tags.push({
        slug: fallbackSlug,                                    // 生成したユニークなスラグ
        label: newTagLabel,                                    // 元のタグ名をラベルとして使用
        category: newTagCategory,                              // カテゴリ
        style: selectStyleForTag(newTagLabel, newTagCategory), // タグ名とカテゴリから自動的に色を選択
      });
    });

    return tags;
  };

  return { mapArticleTags };
};

module.exports = {
  createTagMapper,
};