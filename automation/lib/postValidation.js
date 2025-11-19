/**
 * @fileoverview 記事の整合性チェックモジュール
 * `posts/` ディレクトリ内のHTMLファイルと `data/posts.json` のエントリの間に
 * 整合性があるかを検証します。
 *
 * 主に「孤立記事（Orphan Posts）」を検出するために使用されます。
 * 孤立記事とは:
 * - `posts/` ディレクトリにHTMLファイルは存在するが、
 * - `data/posts.json` に対応するエントリが登録されていない記事。
 *
 * これらは手動での削除し忘れや、何らかの理由で登録が漏れた記事の可能性があります。
 */

const fs = require('fs/promises');
const path = require('path');
const { VALIDATION } = require('../config/constants');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const postsDir = path.join(root, 'posts');
const postsJsonPath = path.join(root, 'data', 'posts.json');

/**
 * パス文字列を正規化します。
 * - 先頭の `./` や `/` を削除
 * - Windows形式のパス区切り文字 `\` を `/` に変換
 * @param {string} value - 正規化するパス文字列
 * @returns {string|null} 正規化されたパス文字列。入力がfalsyな場合はnull。
 */
const normalizePath = (value) => {
  if (!value) return null;
  return value.replace(/^[./]+/, '').replace(/\\/g, '/');
};

/**
 * `posts/` ディレクトリ内のHTMLファイル名の一覧を非同期で読み取ります。
 * @returns {Promise<Array<string>>} HTMLファイル名の配列
 */
const readPostsDirectory = async () => {
  const entries = await fs.readdir(postsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name);
};

/**
 * `data/posts.json` を非同期で読み込み、内容を返します。
 * @returns {Promise<Array<object>>} `posts.json` の内容（記事オブジェクトの配列）。ファイルが存在しない場合は空配列を返します。
 */
const readPostsJson = async () => {
  try {
    const content = await fs.readFile(postsJsonPath, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    // ファイルが存在しないエラーの場合は、空の配列を返して正常に処理を続ける
    if (error.code === 'ENOENT') return [];
    // その他のエラー（JSONパースエラーなど）はスローする
    throw error;
  }
};

/**
 * `posts.json` の内容から、登録済みの記事URLのSetを構築します。
 * Setを使うことで、URLの存在チェックが高速になります。
 * @param {Array<object>} posts - `posts.json` から読み込んだ記事オブジェクトの配列
 * @returns {Set<string>} 登録済みURLのSet
 */
const buildKnownUrls = (posts) => {
  const urls = new Set();
  posts.forEach((post) => {
    const normalizedUrl = normalizePath(post?.url);
    if (normalizedUrl) {
      urls.add(normalizedUrl);
      return;
    }
    // `url` プロパティがない古いデータ形式の場合、`slug` からURLを推測
    if (post?.slug) {
      urls.add(`posts/${post.slug}.html`);
    }
  });
  return urls;
};

/**
 * 孤立記事（`posts/` ディレクトリには存在するが `data/posts.json` に未登録の記事）を検出します。
 * @returns {Promise<Array<object>>} 孤立記事情報の配列 `[{ filename, url }, ...]`
 */
const findOrphanPosts = async () => {
  // 設定でチェックが無効化されている場合は、何もせず空配列を返す
  const enabled = VALIDATION?.ORPHAN_POST_CHECK_ENABLED;
  if (!enabled) return [];

  // 設定ファイルから無視するファイルリストを取得
  const ignoreList = Array.isArray(VALIDATION?.ORPHAN_POST_IGNORE)
    ? VALIDATION.ORPHAN_POST_IGNORE
    : [];
  const ignores = new Set(ignoreList);

  // 1. `posts/` ディレクトリ内の全HTMLファイルを取得
  const htmlFiles = await readPostsDirectory();
  // 2. `data/posts.json` に登録されている全記事を取得
  const posts = await readPostsJson();
  // 3. 登録済みURLの高速なルックアップ用Setを構築
  const knownUrls = buildKnownUrls(posts);

  // 4. HTMLファイルの中から、無視リストになく、かつ登録済みURLにもないものを抽出
  return htmlFiles
    .filter((name) => !ignores.has(name)) // 無視リストにあるファイルを除外
    .map((name) => ({
      filename: name,
      url: normalizePath(path.posix.join('posts', name)), // ファイル名から正規化されたURLパスを生成
    }))
    .filter((entry) => !knownUrls.has(entry.url)); // 登録済みのURLセットに含まれていないものをフィルタリング
};

module.exports = {
  findOrphanPosts,
};