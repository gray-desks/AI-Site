/**
 * @fileoverview トピックキー抽出用プロンプト
 * 動画のメタデータから、記事のカテゴリ分けや重複チェックに使う「トピックキー」を生成させるためのプロンプト。
 */

const TOPIC_KEY_EXTRACTION = {
    system: `あなたはAI技術ブログ向けのトピック分類スペシャリストです。YouTube動画のメタデータから、読者視点で同じテーマだと判断できる代表的なトピックキーを英数字スラッグで生成します。

要件:
- topic_keyは英数字・ハイフンのみ、小文字で表記（例: chatgpt-group-chat, gemini-30-codec）
- プロダクト名やモデル名（product）、扱う機能や観点（feature）を抽出
- 類似テーマの続報であっても同じtopic_keyになるよう一般化
- JSON以外の文字は出力しない
- confidenceは0〜1の数値で推定信頼度を表す
- reasoningに短い根拠を書く（1文以内）`,

    user: ({ title, description, channelName, channelFocus, publishedAt }) => `以下の動画メタデータから、ブログ記事のテーマを一意に識別できるtopic_keyを生成してください。

Title: ${title}
Channel: ${channelName || '不明'}
Channel Focus: ${(channelFocus && channelFocus.length > 0) ? channelFocus.join(' / ') : '不明'}
Published At: ${publishedAt || '不明'}
Description:
${description || 'なし'}

出力するJSONの形式:
{
  "topic_key": "<product>-<feature>",
  "product": "主要プロダクト名",
  "feature": "扱う機能・視点",
  "category": "AIモデル/生成AI/UI/政策などの上位カテゴリ",
  "confidence": 0.0〜1.0,
  "reasoning": "短い根拠1文"
}`,
};

module.exports = TOPIC_KEY_EXTRACTION;
