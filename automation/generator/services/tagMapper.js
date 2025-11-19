/**
 * @fileoverview タグマッピングサービス
 * AIが生成したタグ（自由な文字列）を、`data/tags.json`で事前定義された
 * 正規のタグ情報（slug, label, categoryなど）にマッピング（対応付け）する機能を提供します。
 *
 * 機能:
 * - 正規化されたタグ名とエイリアスによるマッチング: 大文字・小文字やハイフンなどを無視して柔軟に照合します。
 * - 未登録タグの自動生成: 辞書にないタグが見つかった場合、その場で新しいタグ情報を生成します。
 * - 重複タグの除去: 最終的なタグリストに同じタグが複数含まれないようにします。
 */

const slugify = require('../../lib/slugify');
const { normalizeTagToken } = require('./tokenUtils');

/**
 * タグ辞書を構築します。
 * `data/tags.json`からタグ定義を読み込み、高速に検索するためのインデックス（Map）を作成します。
 * インデックスは、正規化されたタグ名やエイリアスをキーとし、対応するタグオブジェクトを値とします。
 * @param {Function} readJson - JSONファイルを読み込むための関数
 * @param {string} tagsConfigPath - タグ定義ファイル（`tags.json`）のパス
 * @returns {{entries: Array<object>, index: Map<string, object>}} タグの生データ配列と、検索用インデックスMap
 */
const buildTagDictionary = (readJson, tagsConfigPath) => {
  const raw = readJson(tagsConfigPath, []);
  const entries = Array.isArray(raw) ? raw : [];
  // `トークン -> タグオブジェクト` のマッピングを保持するMap
  const index = new Map();

  /**
   * トークン（正規化されたタグ名）をインデックスに登録します。
   * @param {string} token - 正規化されたトークン
   * @param {object} entry - 対応するタグオブジェクト
   */
  const registerToken = (token, entry) => {
    // トークンが空、または既にインデックスに存在する場合は何もしない
    if (!token || index.has(token)) return;
    index.set(token, entry);
  };

  // `tags.json` の各エントリを処理
  entries.forEach((item) => {
    if (!item || !item.slug) return;
    
    // タグ情報を正規化
    const normalizedEntry = {
      slug: item.slug,
      label: item.label || item.slug,
      category: item.category || 'その他',
      style: item.style || null,
    };
    
    // slug, label, および各エイリアスをトークンとしてインデックスに登録
    registerToken(normalizeTagToken(item.slug), normalizedEntry);
    registerToken(normalizeTagToken(item.label), normalizedEntry);
    if (Array.isArray(item.aliases)) {
      item.aliases.forEach((alias) => registerToken(normalizeTagToken(alias), normalizedEntry));
    }
  });

  return { entries, index };
};

/**
 * タグマッパーのインスタンスを作成するファクトリ関数です。
 * 依存関係を注入し、タグマッピングを行う `mapArticleTags` 関数を返します。
 * @param {{readJson: Function, tagsConfigPath: string}} dependencies - 依存関係
 * @returns {{mapArticleTags: Function}} `mapArticleTags` メソッドを持つオブジェクト
 */
const createTagMapper = ({ readJson, tagsConfigPath }) => {
  // タグ辞書を遅延初期化（初回アクセス時に構築）するための変数
  let tagDictionary = null;

  /**
   * タグ辞書が初期化されていることを保証し、それを返します。
   * @returns {object} タグ辞書
   */
  const ensureDictionary = () => {
    if (!tagDictionary) {
      tagDictionary = buildTagDictionary(readJson, tagsConfigPath);
    }
    return tagDictionary;
  };

  /**
   * AIが生成した生のタグ配列を、定義済みの正規タグ情報にマッピングします。
   * @param {Array<string>} rawTags - AIが生成したタグ文字列の配列
   * @returns {Array<object>} マッピングおよび正規化されたタグオブジェクトの配列
   */
  const mapArticleTags = (rawTags) => {
    if (!Array.isArray(rawTags) || rawTags.length === 0) return [];
    
    const seen = new Set(); // 処理済みのタグslugを記録し、重複を防ぐためのSet
    const tags = [];
    const dictionary = ensureDictionary();

    rawTags.forEach((tag, idx) => {
      const token = normalizeTagToken(tag);
      if (!token) return;

      // 1. 辞書にマッチするタグがあるか検索
      const matched = dictionary.index.get(token);
      if (matched) {
        if (seen.has(matched.slug)) return; // 既に同じタグが追加されていればスキップ
        seen.add(matched.slug);
        tags.push({
          slug: matched.slug,
          label: matched.label || matched.slug,
          category: matched.category || 'その他',
          style: matched.style || null,
        });
        return;
      }

      // 2. 辞書にない場合、新しいタグとしてその場で生成
      const originalLabel = String(tag ?? '').trim();
      if (!originalLabel) return;

      // スラグを生成
      const fallbackBase = slugify(originalLabel, 'tag');
      let fallbackSlug = fallbackBase;

      // スラグが 'tag' になってしまったり、既に存在するスラグだった場合は、よりユニークなスラグを生成
      if (fallbackBase === 'tag' || seen.has(fallbackBase)) {
        const sanitizedLabel = originalLabel
          .normalize('NFKC')
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9\-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        fallbackSlug = sanitizedLabel || `tag-${idx + 1}`;

        // それでも重複する場合は連番を付与
        let counter = 1;
        let candidateSlug = fallbackSlug;
        while (seen.has(candidateSlug)) {
          candidateSlug = `${fallbackSlug}-${counter}`;
          counter += 1;
        }
        fallbackSlug = candidateSlug;
      }

      if (seen.has(fallbackSlug)) return; // 最終チェック
      seen.add(fallbackSlug);

      // 新しいタグオブジェクトを作成して追加
      tags.push({
        slug: fallbackSlug,
        label: originalLabel || `タグ${idx + 1}`,
        category: 'その他',
        style: 'accent-neutral', // デフォルトのスタイル
      });
    });

    return tags;
  };

  return { mapArticleTags };
};

module.exports = {
  createTagMapper,
};