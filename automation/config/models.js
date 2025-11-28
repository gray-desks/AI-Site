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

// テーマ重複判定用モデル（軽量・低コスト）
const THEME_DEDUPLICATION = {
  model: 'gpt-4o-mini',
  fallbackModel: 'gpt-3.5-turbo',
  temperature: 0.2,
  response_format: { type: 'json_object' },
};

// 記事本文の生成用モデル
const ARTICLE_GENERATION = {
  model: 'gpt-4o',
  fallbackModel: 'gpt-3.5-turbo',
  temperature: 0.4,
  // レスポンス形式をJSONに指定
  response_format: { type: 'json_object' },
};

module.exports = {
  OPENAI_API_URL,
  YOUTUBE_API_BASE,
  THEME_DEDUPLICATION,
  ARTICLE_GENERATION,
};
