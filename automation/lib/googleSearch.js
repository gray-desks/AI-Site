/**
 * @fileoverview Google Custom Search API ラッパー
 * 指定したキーワードで日本語の記事を検索し、上位の結果を取得するためのモジュールです。
 */

// Google Custom Search APIのデフォルトエンドポイント
const DEFAULT_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

/**
 * APIレスポンスから必要な情報（タイトル、URLなど）を抽出・整形します。
 * @param {object} payload - Google Custom Search APIのレスポンスJSON
 * @param {number} [limit=3] - 取得する最大件数
 * @returns {Array<object>} 抽出された検索結果の配列
 */
const extractItems = (payload, limit = 3) => {
  if (!payload?.items) return [];
  // 指定された件数に絞り込み、必要なフィールドだけを抽出
  return payload.items.slice(0, limit).map((item) => ({
    title: item.title,           // 記事タイトル
    link: item.link,             // 記事URL
    snippet: item.snippet,       // 記事の要約（スニペット）
    displayLink: item.displayLink, // 表示用ドメイン
  }));
};

/**
 * Google Custom Search APIを呼び出して、指定されたクエリで記事を検索します。
 * @param {object} options - 検索オプション
 * @param {string} options.apiKey - Google APIキー
 * @param {string} options.cx - カスタム検索エンジンID
 * @param {string} options.query - 検索クエリ
 * @param {number} [options.num=3] - 取得する結果数（最大10件）
 * @param {string} [options.dateRestrict='d7'] - 期間フィルタ（例: d7=過去7日, m1=過去1か月）
 * @returns {Promise<{items: Array<object>, fromCache: boolean}>} 検索結果の配列
 * @throws {Error} API呼び出しに失敗した場合にエラーをスローします。
 */
const searchTopArticles = async ({ apiKey, cx, query, num = 3, dateRestrict = 'd7' }) => {
  // 必須パラメータのチェック
  if (!apiKey || !cx || !query) {
    console.warn('Google Search APIの必須パラメータ（apiKey, cx, query）が不足しています。');
    return { items: [], fromCache: false };
  }

  // APIリクエストURLを構築
  const url = new URL(DEFAULT_ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(num, 10))); // 取得件数は最大10件
  url.searchParams.set('lr', 'lang_ja'); // 検索結果を日本語に限定
  url.searchParams.set('sort', 'date'); // 新しい順を優先
  if (dateRestrict) {
    url.searchParams.set('dateRestrict', dateRestrict); // 期間フィルタ（デフォルト: 過去7日）
  }

  // APIを呼び出し
  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Search API error: ${response.status} ${text}`);
  }

  const json = await response.json();
  
  // 結果を整形して返す
  return {
    items: extractItems(json, num),
    fromCache: false, // キャッシュ機能は現在実装されていない
  };
};

module.exports = {
  searchTopArticles,
};
