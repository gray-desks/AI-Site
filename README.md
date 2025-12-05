# AI情報ブログ

自動化パイプラインで記事を生成・公開するブログリポジトリです。
記事は **Markdown** で管理し、ビルドプロセスを通じてHTMLに変換されます。

## フォルダ構成
- `content/posts/` **記事の原稿 (Markdown)**。ここを編集します。
- `posts/YYYY/MM/` **公開用HTML**。自動生成されるため手動編集は禁止です。
- `data/` データファイル (`posts.json`, `tags.json` 等)。
- `scripts/` 開発・運用スクリプト。
  - `build/` ビルド関連 (`npm run build:posts`)
  - `dev/` 開発サーバー (`npm run dev`)
  - `cli/` CLIツール (`npm run posts`)
  - `maintenance/` メンテナンス用スクリプト
- `automation/` AI自動化パイプライン（collector/researcher/generator/publisher）。
- `templates/` 記事生成用の共通HTMLテンプレート。

## 記事の更新・作成フロー

1. **Markdownファイルの作成・編集**:
   `content/posts/` ディレクトリに `YYYY-MM-DD-slug.md` 形式でファイルを作成または編集します。
   Frontmatter（ファイルの先頭）にタイトルや日付などのメタデータを記述してください。

2. **ビルドの実行**:
   以下のコマンドを実行すると、MarkdownからHTMLが生成され、サイトに反映されます。
   ```bash
   npm run build:posts
   ```

## 投稿管理ショートカット
- `npm run posts -- list` : 最新投稿を表示
- `npm run posts -- drafts` : ドラフトだけ表示
- `npm run posts -- status` : 投稿と候補の件数サマリー
- `npm run posts -- orphans` : `posts/` にあるが `posts.json` 未登録のファイルを検出

## パイプライン実行
- まとめて実行: `npm run pipeline`
- 個別ステージ: `npm run research` / `npm run generate` / `npm run publish`

## 開発・運用ルール
詳細は `.agent/rules/` 配下のドキュメントを参照してください。
- `engineering.md`: 技術スタック・品質基準
- `operation.md`: 運用フロー・画像生成ルール
- `content-creation.md`: 記事執筆・編集ガイドライン
- `agent-behavior.md`: エージェントの行動指針
