# collector

- `sources.json` をもとに対象YouTubeチャンネルの最新動画を YouTube Data API v3 で取得します。
- `data/sources.json` には `channelId` を必須フィールドとして登録し、ハンドルやHTMLスクレイピングには依存しません。
- 実行には `YOUTUBE_API_KEY` が必要です。GitHub Secrets 経由で渡し、ローカルでは `.env` などに直接書き込まないようにしてください。
- 取得結果は `data/candidates.json` に `status: "collected"` で保存され、Researcher → Generator の順に処理されます。
