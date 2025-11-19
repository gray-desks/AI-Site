/**
 * @fileoverview タグトークン正規化ユーティリティ
 * タグやキーワードなどの文字列（トークン）を、比較や検索に適した一貫した形式に正規化する機能を提供します。
 */

/**
 * タグやキーワードとして使われる文字列を正規化（ノーマライズ）します。
 * これにより、大文字・小文字の違い、全角・半角の違い、連続するスペースなどを無視して、
 * 同じ意味を持つトークンを同一のものとして扱うことができます。
 *
 * 処理フロー:
 * 1. 文字列に変換: 入力値を安全に文字列に変換します。
 * 2. Unicode正規化 (NFKC): 全角の英数字やスペースを半角に変換し、互換文字を統一します。
 * 3. トリム: 文字列の前後の余分な空白を削除します。
 * 4. 小文字化: 全ての文字を小文字に統一します。
 * 5. スペースの統一: 連続する空白文字（スペース、タブなど）を単一の半角スペースに置換します。
 *
 * @param {*} value - 正規化する値。
 * @returns {string} 正規化された文字列。入力がnullまたはundefinedの場合は空文字列を返します。
 *
 * @example
 * normalizeTagToken('  ChatGPT  ') // => 'chatgpt'
 * normalizeTagToken('ＡＩ　モデル') // => 'ai モデル'
 * normalizeTagToken('Gemini-1.5') // => 'gemini-1.5'
 */
const normalizeTagToken = (value) => {
  if (value === null || value === undefined) return '';
  
  return String(value)
    .normalize('NFKC')       // 1. Unicode正規化
    .trim()                  // 2. 前後の空白を削除
    .toLowerCase()           // 3. 小文字化
    .replace(/\s+/g, ' ');   // 4. 連続する空白を単一スペースに統一
};

module.exports = {
  normalizeTagToken,
};