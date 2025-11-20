/**
 * @fileoverview OpenAI API ユーティリティ
 * OpenAI APIのChat Completionsエンドポイントを呼び出すためのラッパー関数を提供します。
 * APIリクエストの構築やエラーハンドリングを抽象化します。
 */

const { OPENAI_API_URL } = require('../config/models');

/**
 * OpenAIのChat Completions APIを呼び出します。
 * フォールバックモデルが指定されている場合、主モデルが失敗した際に自動的にフォールバックします。
 *
 * @param {object} options - API呼び出しのオプション
 * @param {string} options.apiKey - OpenAI APIキー
 * @param {Array<object>} options.messages - APIに渡すメッセージの配列
 * @param {string} options.model - 使用するモデル名 (e.g., 'gpt-4o')
 * @param {string} [options.fallbackModel] - 主モデルが失敗した際に使用するフォールバックモデル (オプション)
 * @param {number} options.temperature - 生成の多様性を制御する温度 (0.0 - 2.0)
 * @param {number} [options.maxTokens] - 生成するトークンの最大数 (オプション)
 * @param {object} [options.responseFormat] - レスポンス形式を指定するオブジェクト (e.g., { type: 'json_object' }) (オプション)
 * @returns {Promise<object>} OpenAI APIからのレスポンスJSON
 * @throws {Error} APIキーやメッセージが不正な場合、またはAPI呼び出しに失敗した場合にエラーをスローします。
 */
const callOpenAI = async (options) => {
  const { apiKey, messages, model, fallbackModel, temperature, maxTokens, responseFormat } = options;

  // APIキーの存在チェック
  if (!apiKey) {
    throw new Error('OpenAI APIキーが設定されていません。');
  }

  // messages配列の妥当性チェック
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('APIに渡すmessages配列が空または不正です。');
  }

  // 内部ヘルパー関数: 実際のAPI呼び出しを実行
  const executeRequest = async (modelToUse) => {
    // APIに送信するペイロードを構築
    const payload = {
      model: modelToUse,
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
      let errorDetail = errorText;

      // エラーレスポンスをパースして詳細情報を抽出
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorDetail = errorJson.error.message;
        }
      } catch {
        // JSONパースに失敗した場合は元のテキストを使用
      }

      // ステータスコード別のエラーメッセージ
      const errorMessage = response.status === 403
        ? `OpenAI API 権限エラー (403): モデル '${modelToUse}' へのアクセスが拒否されました。${errorDetail}`
        : response.status === 429
        ? `OpenAI API レート制限エラー (429): リクエスト数が多すぎます。${errorDetail}`
        : response.status === 401
        ? `OpenAI API 認証エラー (401): APIキーが無効です。${errorDetail}`
        : `OpenAI API エラー (${response.status}): ${errorDetail}`;

      const error = new Error(errorMessage);
      error.status = response.status;
      error.model = modelToUse;
      throw error;
    }

    // レスポンスボディをJSONとしてパースして返す
    return await response.json();
  };

  // 主モデルで試行
  try {
    return await executeRequest(model);
  } catch (primaryError) {
    // フォールバックモデルが指定されており、主モデルが403または404エラーの場合のみフォールバック
    if (fallbackModel && (primaryError.status === 403 || primaryError.status === 404)) {
      console.warn(`[openai] モデル '${model}' が失敗しました (${primaryError.status})。フォールバックモデル '${fallbackModel}' で再試行します。`);

      try {
        return await executeRequest(fallbackModel);
      } catch (fallbackError) {
        // フォールバックも失敗した場合は両方のエラー情報を含める
        throw new Error(
          `OpenAI API呼び出しが失敗しました。主モデル: ${primaryError.message}、フォールバックモデル: ${fallbackError.message}`
        );
      }
    }

    // フォールバックが利用できない、または他のエラーの場合は元のエラーをスロー
    throw primaryError;
  }
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