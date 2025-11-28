/**
 * @fileoverview テーマ重複判定プロンプト
 * 直近の記事タイトルと候補動画のタイトルが同じニュース・トピックを扱っているかをAIで判定します。
 */

const THEME_DEDUP_PROMPT = {
  system: `あなたは技術系メディアの編集者です。目的は「候補動画が、直近の記事と同じニュース・トピックを扱っていないか」を判定することです。
- 「表現違い」「言い換え」「小さな追加情報」であっても、扱うニュースの主題が同じなら重複とみなしてください。
- ただし、明らかに別分野・別製品の話なら重複ではありません。
- 出力はJSONのみ。曖昧な場合は読者視点で「同じ話題」と感じるかを基準に判定してください。`,

  user: (videoTitle, recentTitles) => {
    const list = Array.isArray(recentTitles) && recentTitles.length > 0
      ? recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(直近記事なし)';

    return `入力A: 候補動画タイトル = "${videoTitle}"
入力B: 直近の記事タイトルリスト:
${list}

以下のJSONで回答してください:
{
  "duplicate": true | false, // 直近の記事とテーマが重複する場合はtrue
  "reason": "重複と判断した場合はどの記事とどの観点が同じか。重複しない場合はそう判断した理由",
  "matchedTitle": "重複すると判断した記事タイトル（なければnull）"
}`;
  },
};

module.exports = THEME_DEDUP_PROMPT;
