/**
 * @fileoverview 文字列をURL-safeなスラグに変換するユーティリティ
 * 日本語や特殊文字、スペースなどを含む文字列を、URLやファイル名として安全に使用できる
 * 「ケバブケース」形式（例: `this-is-a-slug`）に変換します。
 */

/**
 * 文字列をURLに適したスラグ形式に変換します。
 *
 * 処理フロー:
 * 1. Unicode正規化 (NFKD): 「が」を「か」と「゛」のように、合成文字を基本文字と濁点・半濁点に分解します。
 * 2. 非ASCII文字の除去: 英数字、空白、ハイフン以外の文字（上記で分解された濁点などを含む）を削除します。
 * 3. 区切り文字の統一: 1つ以上のスペース、アンダースコア、ハイフンを単一のハイフンに置換します。
 * 4. 先頭・末尾のハイフンの除去: 不要なハイフンを取り除きます。
 * 5. 小文字化: 全体を小文字に統一します。
 *
 * @param {string} value - スラグ化する元の文字列。
 * @param {string} [fallback='ai-topic'] - 変換後の文字列が空になった場合（例: 絵文字のみの入力）に使用されるデフォルト値。
 * @returns {string} スラグ化された文字列。
 *
 * @example
 * slugify('AIの最新ニュース！') // => 'aino-news'
 * slugify('Hello World_and-more') // => 'hello-world-and-more'
 * slugify('　') // => 'ai-topic'
 * slugify('', 'default-slug') // => 'default-slug'
 */
const slugify = (value, fallback = 'ai-topic') => {
  if (!value || typeof value !== 'string') return fallback;

  const slug = value
    .normalize('NFKD') // 1. Unicode正規化
    .replace(/[^\w\s-]/g, '') // 2. 英数字、空白、ハイフン以外を削除
    .trim() // 先頭・末尾の空白を削除
    .replace(/[\s_-]+/g, '-') // 3. 区切り文字をハイフンに統一
    .replace(/^-+|-+$/g, '') // 4. 先頭・末尾のハイフンを削除
    .toLowerCase(); // 5. 小文字化

  // 変換結果が空文字列になった場合はフォールバック値を返す
  return slug || fallback;
};

module.exports = slugify;