/**
 * @fileoverview モデル設定
 * このプロジェクトで使用する外部APIのエンドポイントや、
 * OpenAI APIのモデルとパラメータを一元管理します。
 */

// OpenAI APIのエンドポイントURL
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// YouTube Data APIのエンドポイントURL
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// --- 各タスクで使用するOpenAIモデルの設定 ---

// キーワード抽出用モデル
const KEYWORD_EXTRACTION = {
  // 使用するモデルID
  model: 'gpt-4o-mini',
  // 生成されるテキストの多様性 (0に近いほど決定的)
  temperature: 0.3,
  // 生成されるトークンの最大数
  max_tokens: 100,
};

// トピックキー抽出用モデル
const TOPIC_KEY_EXTRACTION = {
  model: 'gpt-4o-mini',
  temperature: 0.2,
  max_tokens: 200,
  // レスポンス形式をJSONに指定
  response_format: { type: 'json_object' },
};

// 検索結果の要約生成用モデル
const SUMMARY_GENERATION = {
  model: 'gpt-4o',
  temperature: 0.3,
  max_tokens: 800,
};

// 記事本文の生成用モデル
const ARTICLE_GENERATION = {
  model: 'gpt-4o',
  temperature: 0.4,
  // レスポンス形式をJSONに指定
  response_format: { type: 'json_object' },
};

module.exports = {
  OPENAI_API_URL,
  YOUTUBE_API_BASE,
  KEYWORD_EXTRACTION,
  TOPIC_KEY_EXTRACTION,
  SUMMARY_GENERATION,
  ARTICLE_GENERATION,
};