/**
 * @fileoverview 記事要約生成サービス
 * Google検索で見つかった記事の本文を取得し、指定された文字数範囲で要約を生成します。
 *
 * 主な機能:
 * - OpenAI APIを利用した高品質な要約の生成。
 * - APIが利用できない場合や、生成された要約が短すぎる場合のフォールバック処理。
 * - 記事本文やスニペットから、指定された文字数範囲（例: 500〜800文字）に収まるように要約を構築。
 */

const { RESEARCHER } = require('../../config/constants');
const { SUMMARY_GENERATION } = require('../../config/models');
const PROMPTS = require('../../config/prompts');
const { callOpenAI, extractContent } = require('../../lib/openai');
const { fetchArticleText, isQualityContent } = require('./articleContent');

// 設定ファイルから要約の最小・最大文字数を取得
const { SUMMARY_MIN_LENGTH, SUMMARY_MAX_LENGTH } = RESEARCHER;

/**
 * OpenAI APIを使用して記事の要約を生成します。
 * @param {string} articleText - 要約対象の記事本文
 * @param {string} title - 記事のタイトル
 * @param {string} apiKey - OpenAI APIキー
 * @returns {Promise<string>} 生成された要約文字列。失敗した場合は空文字列を返します。
 */
const generateAISummary = async (articleText, title, apiKey) => {
  // 本文が短すぎる場合はAPIを呼び出さずに終了
  if (!articleText || articleText.length < 200) {
    return '';
  }

  try {
    // APIに渡すメッセージをプロンプトから構築
    const messages = [
      {
        role: 'system',
        content: PROMPTS.SUMMARY_GENERATION.system,
      },
      {
        role: 'user',
        content: PROMPTS.SUMMARY_GENERATION.user(title, articleText),
      },
    ];

    // OpenAI APIを呼び出し
    const completion = await callOpenAI({
      apiKey,
      messages,
      model: SUMMARY_GENERATION.model,
      temperature: SUMMARY_GENERATION.temperature,
      maxTokens: SUMMARY_GENERATION.max_tokens,
    });

    const summary = extractContent(completion);
    // 生成された要約が最小文字数以上であれば、それを返す
    if (summary.length >= SUMMARY_MIN_LENGTH) {
      return summary;
    }
  } catch (error) {
    console.warn(`[researcher] AI要約生成に失敗: ${error.message}`);
  }

  // 失敗した場合や要約が短すぎた場合は空文字列を返す
  return '';
};

/**
 * 指定された文字数範囲（`SUMMARY_MIN_LENGTH`〜`SUMMARY_MAX_LENGTH`）に収まるように要約を構築します。
 * 主にAIによる要約生成が失敗した場合のフォールバックとして使用されます。
 * @param {string} text - 要約の元となるテキスト（記事本文など）
 * @param {string} [fallback=''] - `text`が不十分な場合に使用するフォールバックテキスト（スニペットなど）
 * @returns {string} 構築された要約文字列
 */
const buildSummaryWithinRange = (text, fallback = '') => {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const baseText = normalize(text);
  const fallbackText = normalize(fallback);
  const source = baseText || fallbackText;
  if (!source) return '';

  // テキストを文（「。」や「.」など）で分割
  const sentences = source
    .split(/(?<=[。\.\!?？!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  let summary = '';
  // 文を一つずつ追加していき、最大文字数を超えないようにする
  for (const sentence of sentences) {
    const next = summary ? `${summary}${sentence}` : sentence;
    if (next.length > SUMMARY_MAX_LENGTH) {
      // 最大長を超える場合、現在の要約が最小長未満なら、超えた部分を切り捨てて採用
      if (summary.length < SUMMARY_MIN_LENGTH) {
        summary = next.slice(0, SUMMARY_MAX_LENGTH);
      }
      break;
    }
    summary = next;
    if (summary.length >= SUMMARY_MAX_LENGTH) break;
  }

  // ループ後も要約が空の場合、ソースの先頭から切り出す
  if (!summary) {
    summary = source.slice(0, SUMMARY_MAX_LENGTH);
  }

  // 要約が最小文字数に満たない場合、ソースから最小文字数分を切り出す
  if (summary.length < SUMMARY_MIN_LENGTH && source.length > summary.length) {
    summary = source.slice(0, Math.min(SUMMARY_MAX_LENGTH, source.length));
  }

  // それでも最小文字数に満たない場合、フォールバックテキストを連結してみる
  if (summary.length < SUMMARY_MIN_LENGTH && fallbackText && source !== fallbackText) {
    const combined = `${summary} ${fallbackText}`.trim();
    summary = combined.slice(0, Math.min(SUMMARY_MAX_LENGTH, combined.length));
  }

  // 最終的に最大文字数を超えていれば切り詰める
  if (summary.length > SUMMARY_MAX_LENGTH) {
    summary = summary.slice(0, SUMMARY_MAX_LENGTH);
  }

  return summary.trim();
};

/**
 * Google検索結果の1アイテムを要約します。
 * 1. URLから記事本文を取得
 * 2. 取得した本文の品質をチェック
 * 3. (品質が良ければ) OpenAI APIで要約を生成
 * 4. (AI要約が失敗または短すぎる場合) 本文やスニペットからフォールバック要約を生成
 *
 * @param {object} item - Google検索結果の1アイテム
 * @param {number} index - 検索結果リスト内でのインデックス
 * @param {string} apiKey - OpenAI APIキー
 * @returns {Promise<{title: string, url: string, snippet: string, summary: string, quality: 'high'|'low'}>} 要約結果オブジェクト
 */
const summarizeSearchResult = async (item, index, apiKey) => {
  const title = item.title || `検索結果${index + 1}`;
  const url = item.link;
  const snippet = item.snippet || ''; // Google検索結果のスニペット
  let bodyText = '';

  // URLがあれば記事本文を取得
  if (url) {
    bodyText = await fetchArticleText(url);
  }

  // 本文の品質が低い場合は、スニペットを要約として使い、処理を終了
  if (!isQualityContent(bodyText)) {
    console.warn(`[researcher] 低品質コンテンツのためスニペットを使用: ${url}`);
    return {
      title,
      url,
      snippet,
      summary: snippet,
      quality: 'low',
    };
  }

  let summary = '';
  // 本文が十分に長く、APIキーがあればAIによる要約を試みる
  if (bodyText && bodyText.length >= 200 && apiKey) {
    summary = await generateAISummary(bodyText, title, apiKey);
  }

  // AI要約が生成されなかった、または短すぎた場合は、フォールバック処理を実行
  if (!summary || summary.length < SUMMARY_MIN_LENGTH) {
    summary = buildSummaryWithinRange(bodyText, snippet);
  }

  return {
    title,
    url,
    snippet,
    summary,
    quality: 'high',
  };
};

module.exports = {
  generateAISummary,
  buildSummaryWithinRange,
  summarizeSearchResult,
};