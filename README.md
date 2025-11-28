# AI情報ブログ

自動化パイプラインで記事を生成・公開するブログリポジトリです。投稿まわりを見通し良くするための動線をまとめました。

## フォルダざっくり
- `posts/YYYY/MM/` 公開用HTML。パスは `data/posts.json` の `url` と対応。
- `data/posts.json` 投稿一覧・メタデータ。ステータスは `published` / `draft` など。
- `data/candidates.json` 動画候補と進捗ステータス。
- `automation/` パイプライン本体（collector/researcher/generator/publisher）。
- `automation/scripts/posts-cli.js` 投稿管理用の新しいCLI。
- `assets/` テンプレートで使う画像・JS/CSS。

## 投稿管理ショートカット
- `npm run posts -- list` : 最新投稿を表示（デフォルト10件、`-n`で件数変更、`--status draft`で絞り込み）
- `npm run posts -- drafts` : ドラフトだけ表示
- `npm run posts -- status` : 投稿と候補の件数サマリー
- `npm run posts -- orphans` : `posts/` にあるが `posts.json` 未登録のファイルを検出
- `npm run posts:migrate-folders` : 旧フラット構造を `posts/YYYY/MM/` へ移行＆相対パス調整

エイリアスも用意しました: `npm run posts:drafts` / `npm run posts:status` / `npm run posts:orphans`

## すぐ確認したいときの流れ
1. 投稿一覧を見る: `npm run posts -- list -n 5`
2. ドラフトが残っていないか: `npm run posts -- drafts`
3. 孤立ファイルがないか: `npm run posts -- orphans`
4. 候補の滞留状況を見る: `npm run posts -- status`

## パイプライン実行
- まとめて実行: `npm run pipeline`
- 個別ステージ: `npm run research` / `npm run generate` / `npm run publish`

記事を手で更新する場合は `data/posts.json` と `posts/<slug>.html` の整合性に注意しつつ、上記CLIで確認すると迷子になりにくいです。
