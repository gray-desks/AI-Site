/**
 * @fileoverview テキスト処理ユーティリティ
 * HTML/XMLエンティティのデコードやテキストの整形など、基本的なテキスト操作を行う関数を提供します。
 */

// デコード対象のHTMLエンティティと対応する文字のマッピング
const entities = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

// CDATAタグを除去するための正規表現
const cdataRegex = /<!\[CDATA\[|\]\]>/g;

/**
 * 文字列内のHTMLエンティティ（&amp;, &lt;など）を通常の文字にデコードします。
 * RSSフィードやAPIレスポンスに含まれるエスケープされたHTMLを元に戻すために使用します。
 * @param {string} value - デコードする文字列。
 * @returns {string} デコードされた文字列。入力がfalsyな場合は空文字列を返します。
 */
const decodeHtmlEntities = (value) => {
  if (!value || typeof value !== 'string') return '';

  // Object.entriesとreduceを使って、より宣言的に置換処理を行う
  let decoded = Object.entries(entities).reduce(
    (acc, [entity, char]) => acc.replace(new RegExp(entity, 'g'), char),
    value
  );
  
  // CDATAタグを除去
  decoded = decoded.replace(cdataRegex, '');

  return decoded;
};

/**
 * 文字列からHTMLエンティティをデコードし、さらに前後の空白を除去して整形します。
 * @param {string} value - 処理する文字列。
 * @returns {string} クリーンアップされた文字列。
 */
const extractText = (value) => {
  if (!value || typeof value !== 'string') return '';
  return decodeHtmlEntities(value).trim();
};

module.exports = {
  decodeHtmlEntities,
  extractText,
};