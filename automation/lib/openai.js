/**
 * @fileoverview OpenAI API ユーティリティ
 * OpenAI APIのChat Completionsエンドポイントを呼び出すためのラッパー関数を提供します。
 * APIリクエストの構築やエラーハンドリングを抽象化します。
 */

const { OPENAI_API_URL } = require('../config/models');

/**
 * OpenAIのChat Completions APIを呼び出します。
 * @param {object} options - API呼び出しのオプション
 * @param {string} options.apiKey - OpenAI APIキー
 * @param {Array<object>} options.messages - APIに渡すメッセージの配列
 * @param {string} options.model - 使用するモデル名 (e.g., 'gpt-4o')
 * @param {number} options.temperature - 生成の多様性を制御する温度 (0.0 - 2.0)
 * @param {number} [options.maxTokens] - 生成するトークンの最大数 (オプション)
 * @param {object} [options.responseFormat] - レスポンス形式を指定するオブジェクト (e.g., { type: 'json_object' }) (オプション)
 * @returns {Promise<object>} OpenAI APIからのレスポンスJSON
 * @throws {Error} APIキーやメッセージが不正な場合、またはAPI呼び出しに失敗した場合にエラーをスローします。
 */
const callOpenAI = async (options) => {
  const { apiKey, messages, model, temperature, maxTokens, responseFormat } = options;

  // APIキーの存在チェック
  if (!apiKey) {
    throw new Error('OpenAI APIキーが設定されていません。');
  }

  // messages配列の妥当性チェック
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('APIに渡すmessages配列が空または不正です。');
  }

  // APIに送信するペイロードを構築
  const payload = {
    model,
    temperature,
    messages,
  };

  // オプションのパラメータを追加
  if (maxTokens) {
    payload.max_tokens = maxTokens;
  }
  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  // fetch APIを使用してOpenAI APIにリクエストを送信
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  // レスポンスが正常でない場合はエラーをスロー
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  // レスポンスボディをJSONとしてパースして返す
  const completion = await response.json();
  return completion;
};

/**
 * OpenAI APIのレスポンスオブジェクトから、生成されたテキストコンテンツを抽出します。
 * @param {object} completion - `callOpenAI`から返されるレスポンスオブジェクト
 * @returns {string} 抽出されたテキストコンテンツ
 * @throws {Error} レスポンスの構造が予期しない形式の場合にエラーをスローします。
 */
const extractContent = (completion) => {
  // レスポンスのネストされた構造からcontentプロパティを取得
  const content = completion?.choices?.[0]?.message?.content;

  if (typeof content !== 'string') {
    console.error('Invalid completion object:', JSON.stringify(completion, null, 2));
    throw new Error('OpenAIレスポンスに有効なcontentが含まれていません。');
  }

  // 前後の空白を削除して返す
  return content.trim();
};

module.exports = {
  callOpenAI,
  extractContent,
};