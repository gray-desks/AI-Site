/**
 * @fileoverview トピックキー抽出モジュール
 * OpenAI APIを使用して、動画のメタデータから記事のトピックを識別するための一意なキー（トピックキー）を生成します。
 *
 * トピックキーは、同じテーマの続報記事などを同一トピックとしてグルーピングするために使用されます。
 * これにより、類似記事の重複生成を防ぎます。
 * 例: "chatgpt-group-chat", "gemini-30-codec"
 */

const slugify = require('./slugify');
const { TOPIC_KEY_EXTRACTION } = require('../config/models');
const PROMPTS = require('../config/prompts');
const { callOpenAI, extractContent } = require('./openai');

/**
 * JSON文字列を安全にパースします。
 * OpenAIのレスポンスには、JSONの前後に余分なテキストが含まれることがあるため、
 * まずそのままパースを試み、失敗した場合は文字列中からJSON部分 `{...}` を抽出して再試行します。
 * @param {string} value - パース対象の文字列
 * @returns {object|null} パースされたJSONオブジェクト。失敗した場合はnullを返します。
 */
const safeJsonParse = (value) => {
  if (!value) return null;
  try {
    // まずはそのままパースを試みる
    return JSON.parse(value);
  } catch (error) {
    // パースに失敗した場合、正規表現でJSONオブジェクト部分を抽出
    const match = value.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        // 抽出した部分を再度パース
        return JSON.parse(match[0]);
      } catch (innerError) {
        // 再試行にも失敗した場合はnullを返す
        console.error('Failed to parse extracted JSON:', innerError);
        return null;
      }
    }
    console.error('Failed to parse JSON and no JSON object found in string:', error);
    return null;
  }
};

/**
 * テキスト値をサニタイズ（無害化）します。
 * nullやundefinedを空文字列に変換し、前後の空白をトリムします。
 * @param {*} value - サニタイズする値
 * @returns {string} クリーンアップされた文字列
 */
const sanitizeText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

/**
 * OpenAIからのレスポンスペイロードを正規化し、一貫した形式のオブジェクトに変換します。
 * モデルの出力するキー名が揺れる（例: `product` vs `product_name`）可能性があるため、ここで吸収します。
 * @param {object} payload - OpenAIから返されたパース済みのJSONオブジェクト
 * @param {string} fallbackTitle - `topic_key`が生成できなかった場合のフォールバックとして使う動画タイトル
 * @returns {object} 正規化されたトピックキー情報
 */
const normalizeTopicPayload = (payload, fallbackTitle) => {
  // キー名の揺れを吸収しつつ、各フィールドをサニタイズ
  const product = sanitizeText(payload?.product || payload?.product_name);
  const feature = sanitizeText(payload?.feature || payload?.capability);
  const category = sanitizeText(payload?.category);
  const confidence = Number.isFinite(Number(payload?.confidence))
    ? Number(payload.confidence)
    : null;
  const reasoning = sanitizeText(payload?.reasoning);

  // `topic_key`が直接指定されていない場合、productとfeatureから組み立てる
  const fallbackBase = [product, feature].filter(Boolean).join('-') || sanitizeText(payload?.topic_key);
  const slugSource = sanitizeText(payload?.topic_key || fallbackBase);
  
  // 最終的なtopicKeyをslugifyで生成
  const topicKey = slugify(slugSource || fallbackTitle, 'ai-topic');

  return {
    topicKey,
    rawTopicKey: slugSource || fallbackBase || fallbackTitle,
    product: product || null,
    feature: feature || null,
    category: category || null,
    confidence,
    reasoning: reasoning || null,
  };
};

/**
 * 動画メタデータからトピックキー情報を非同期で生成します。
 * OpenAI APIを呼び出し、動画のタイトル、説明、チャンネル情報などから、
 * 同じテーマを識別できる一意なトピックキーと関連情報を抽出します。
 *
 * @param {string} apiKey - OpenAI APIキー
 * @param {object} [video={}] - 動画メタデータ
 * @param {string} video.title - 動画タイトル（必須）
 * @param {string} [video.description] - 動画説明
 * @param {string} [video.publishedAt] - 公開日時
 * @param {object} [source={}] - ソース（チャンネル）情報
 * @param {string} [source.name] - チャンネル名
 * @param {Array<string>} [source.focus] - チャンネルの専門分野
 * @returns {Promise<object>} 生成されたトピックキー情報を含むオブジェクト
 *
 * @example
 * const result = await deriveTopicKey(apiKey, { title: 'ChatGPT Group Chat' }, { name: 'Tech News' });
 * // result might be:
 * // {
 * //   topicKey: 'chatgpt-group-chat',
 * //   raw: 'chatgpt-group-chat',
 * //   product: 'ChatGPT',
 * //   feature: 'Group Chat',
 * //   category: '生成AI',
 * //   confidence: 0.9,
 * //   reasoning: '...',
 * //   method: 'openai',
 * //   payload: { ... }
 * // }
 */
const deriveTopicKey = async (apiKey, video = {}, source = {}) => {
  if (!video?.title) {
    throw new Error('動画タイトルが未指定のためtopic_keyを生成できません');
  }

  // OpenAI APIに渡すメッセージをプロンプトから生成
  const messages = [
    {
      role: 'system',
      content: PROMPTS.TOPIC_KEY_EXTRACTION.system,
    },
    {
      role: 'user',
      content: PROMPTS.TOPIC_KEY_EXTRACTION.user({
        title: video.title,
        description: video.description || '',
        channelName: source?.name || video.channelTitle || '',
        channelFocus: source?.focus || [],
        publishedAt: video.publishedAt || '',
      }),
    },
  ];

  // OpenAI APIを呼び出し（フォールバックモデル付き）
  // 注意: この処理は1回のみ実行されます。リトライはしません。
  const completion = await callOpenAI({
    apiKey,
    messages,
    model: TOPIC_KEY_EXTRACTION.model,
    fallbackModel: TOPIC_KEY_EXTRACTION.fallbackModel,
    temperature: TOPIC_KEY_EXTRACTION.temperature,
    maxTokens: TOPIC_KEY_EXTRACTION.max_tokens,
    responseFormat: TOPIC_KEY_EXTRACTION.response_format,
  });

  // レスポンスからコンテンツを抽出し、安全にJSONパース
  const content = extractContent(completion);
  const parsed = safeJsonParse(content);
  if (!parsed) {
    throw new Error(`topic_keyレスポンスの解析に失敗しました。Content: "${content}"`);
  }

  // パースしたJSONを正規化
  const normalized = normalizeTopicPayload(parsed, video.title);
  
  // 最終的な結果オブジェクトを構築して返す
  return {
    topicKey: normalized.topicKey,
    raw: normalized.rawTopicKey,
    product: normalized.product,
    feature: normalized.feature,
    category: normalized.category,
    confidence: normalized.confidence,
    reasoning: normalized.reasoning,
    method: 'openai', // 生成方法を記録
    payload: parsed, // デバッグ用に元のAPIレスポンスも保持
  };
};

module.exports = {
  deriveTopicKey,
};