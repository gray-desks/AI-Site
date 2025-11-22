/**
 * @fileoverview キーワード抽出モジュール
 * OpenAI APIを使用して、YouTube動画のタイトルと説明文から
 * Google検索に適した簡潔なキーワードを抽出します。
 */

const { KEYWORD_EXTRACTION } = require('../config/models');
const KEYWORD_EXTRACTION_PROMPT = require('../prompts/keywordExtraction');
const { callOpenAI, extractContent } = require('./openai');

/**
 * 動画タイトルと説明文からGoogle検索用のキーワードを抽出します。
 * @param {string} apiKey - OpenAI APIキー
 * @param {string} title - YouTube動画のタイトル
 * @param {string} [description=''] - YouTube動画の説明文
 * @returns {Promise<string>} 抽出されたキーワード
 * @throws {Error} タイトルが指定されていない場合にエラーをスローします。
 */
const extractSearchKeywords = async (apiKey, title, description = '') => {
  if (!title) {
    throw new Error('キーワード抽出にはタイトルが必須です。');
  }

  // OpenAI APIに渡すメッセージを作成
  const messages = [
    {
      role: 'system',
      // システムプロンプトでAIの役割と要件を定義
      content: KEYWORD_EXTRACTION_PROMPT.system,
    },
    {
      role: 'user',
      // ユーザープロンプトで実際の動画情報を渡す
      content: KEYWORD_EXTRACTION_PROMPT.user(title, description),
    },
  ];

  // OpenAI APIを呼び出し（フォールバックモデル付き）
  // 注意: この処理は1回のみ実行されます。リトライはしません。
  const completion = await callOpenAI({
    apiKey,
    messages,
    model: KEYWORD_EXTRACTION.model,
    fallbackModel: KEYWORD_EXTRACTION.fallbackModel,
    temperature: KEYWORD_EXTRACTION.temperature,
    maxTokens: KEYWORD_EXTRACTION.max_tokens,
  });

  // APIレスポンスから抽出されたキーワード（テキストコンテンツ）を返す
  return extractContent(completion);
};

module.exports = {
  extractSearchKeywords,
};