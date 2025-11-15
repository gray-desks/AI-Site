# AGENTS

このリポジトリは「AI情報ブログ」の自動記事生成パイプライン（collector → generator → publisher）と静的サイト一式を管理しています。以降の作業を行うエージェントは、プロジェクトの現状をふまえて以下を厳守してください。

## 共通ルール
- すべての説明・コミットメッセージ・レビューは日本語で行う。
- OpenAI / Google Search などのシークレットはローカルに置かず、GitHub Secrets を利用する前提で記述やコマンドを提案する。
- 変更対象は原則 `automation/`、`data/`、`posts/`、`index.html` などリポジトリ内のファイルのみ。既存の未コミット変更には触れない。
- 自動生成物（`posts/generated-drafts/` 内のHTMLや `automation/output/pipeline-status.json`）を手動で書き換える場合は理由を記述し、極力再現手順を残す。

## 役割ごとの方針

### 1. Collectorサポート
- ソースは `data/sources.json` を単一の真実源とする。YouTubeチャネルを追加する際は必ず `channelId` を記載する（ハンドルだけでは動作しない）。
- `automation/collector/index.js` の仕様：YouTube Data API v3 を使って直近7日以内の動画のみ `data/candidates.json` に保存。調整時はフィルタ日数、1チャンネルあたり件数 (`MAX_PER_CHANNEL`) を確認。
- APIキーは `YOUTUBE_API_KEY` を GitHub Secrets から受け取る。欠落時は collector が即座にエラーを投げる。

### 2. Generatorサポート
- 対象候補は `data/candidates.json` の `status: "pending"`。重複判定は `data/topic-history.json` と `data/posts.json` を組み合わせる実装になっている。
- `automation/generator/index.js` は OpenAI `gpt-4o-mini` を使い、必要に応じて Google Custom Search (`GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_CX`) から得た順位情報をプロンプトに挿入する。検索キーが無い場合のフォールバック文面が欠けていないかを確認する。
- 生成HTMLは `posts/generated-drafts/` に保存。テンプレートは `automation/templates/` 下にあるため、大きなレイアウト変更時はテンプレート→HTML→`index.html`/`about.html` の整合性を取る。

### 3. Publisherサポート
- `automation/publisher/index.js` は generator の出力を `data/posts.json` に反映し、日付降順で整列する。フィールド追加時は `posts/` 内の実ページと `index.html` のレンダリングに影響するので schema を必ず更新。
- パイプラインサマリーは `automation/output/pipeline-status.json` に保存し、静的サイトが直接読み出す。キー名の変更は `index.html` 側のフェッチ処理も要修正。
- GitHub Actions（`.github/workflows/content-pipeline.yml`）では `node automation/pipeline/index.js` を実行して自動コミットする。手動テスト時も同コマンドで再現し、生成物は `git status` で確認。

## 手動オペレーションチェックリスト
- Collector/Ganenerator/Publisherのエラーは `automation/output/pipeline-status.json` で確認し、必要に応じてログ出力を強化する。
- 記事公開内容は `posts/` と `data/posts.json` の差分を突き合わせ、Slug 重複や投稿日欠落がないかを確認。
- `index.html` と `about.html` はプレーンHTML構成のため、ビルドステップ無しでブラウザ確認する。Tailwind等のバンドラは使っていない。

## 参考コマンド
- パイプラインのローカル実行: `node automation/pipeline/index.js`
- collectorのみ実行: `node automation/collector/index.js`
- generatorのみ実行: `node automation/generator/index.js`
- publisherのみ実行: `node automation/publisher/index.js`

## その他
- ブランチポリシーやデプロイ戦略に変更があれば、このファイルを更新して最新手順に同期させる。
- 記事本文は SEO 向けの bullet リストを含む JSON を元にHTML化している。構造を変更した際は必ず `automation/templates/` と `posts/generated-drafts/` の整合を確認。
