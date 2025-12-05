# 開発日報：サイト全体のMarkdown運用移行とビルドシステム構築

**日付**: 2025-12-05
**担当**: Antigravity

## 1. 概要
本日は、ブログ記事の管理運用をHTMLベースからMarkdownベースへ完全に移行する作業を実施しました。
これにより、記事の執筆・管理（`content/posts`）と、Web表示用のHTML生成（`posts/`）が明確に分離され、手動運用・自動生成運用の双方が統一されたワークフローで処理されるようになりました。

## 2. 実施内容

### 2.1. 既存記事のMarkdown移行
- **移行スクリプトの作成と実行**: `data/posts.json` に登録されている全HTML記事から本文とメタデータを抽出し、Markdown形式 (`.md`) に変換しました。
- **データ整合性の確保**:
  - ファイル名を `YYYY-MM-DD-slug.md` 形式に統一。
  - 重複ファイルや、ソースが存在しない「幽霊記事」データのクレンジングを実施。
  - 移行完了後、一時的な移行用スクリプトは削除済み。

### 2.2. ビルドシステムの構築
- **共通テンプレートの作成**: `templates/article.html` を新規作成。これまで記事ごとに複製されていたHTML構造を一元化しました。
- **ビルドスクリプトの実装**: `scripts/build_articles.js` を作成。
  - 機能: `content/posts/*.md` を読み込み → Frontmatter解析 → HTML変換 → テンプレート埋め込み → `posts/` 配下へ出力 → `data/posts.json` 更新。
- **npmスクリプト追加**: `npm run build:posts` コマンドで一括ビルドが可能になりました。

### 2.3. 自動生成パイプラインの改修
- **Generatorステージ (`automation/generator`)**:
  - 記事生成ロジックをHTML生成からMarkdown生成に変更。
  - `markdownRenderer.js` サービスを追加し、YAML Frontmatter付きのMarkdownを出力するように改修。
- **Publisherステージ (`automation/publisher`)**:
  - 生成されたMarkdownを `content/posts/` に保存する処理を追加。
  - 保存後、自動的に `npm run build:posts` をトリガーし、HTML生成と `posts.json` 更新を行うフローに変更。

## 3. 技術的な変更点

### ディレクトリ構成の変更
```
.
├── content/
│   └── posts/       # [NEW] 記事の「原稿」置き場 (.md)。ここを編集する。
├── posts/           # [UPDATE] 公開用HTML置き場。自動生成されるため手動編集禁止。
├── templates/
│   └── article.html # [NEW] 記事の共通HTMLテンプレート。
└── scripts/
    └── build_articles.js # [NEW] ビルド用スクリプト。
```

### 運用フローの変更
**【変更前】**
- 手動: HTMLファイルをコピーして作成・編集し、`posts.json` を手動更新。
- 自動: AIがHTMLを生成し、`posts.json` を更新。

**【変更後】**
- **統一フロー**:
  1. `content/posts/` にMarkdownファイルを作成・編集（手動 or AI）。
  2. `npm run build:posts` を実行（AIの場合は自動実行）。
  3. `posts/` のHTMLと `data/posts.json` が自動更新され、サイトに反映。

## 4. 今後の課題・備考
- **テンプレート修正**: デザインを変更したい場合は、個別のHTMLファイルではなく `templates/article.html` を編集して再ビルドしてください。
- **画像管理**: 記事内の画像パスは、Markdown内でも相対パスや絶対パスで記述可能です。現在は `assets/img/` 配下を参照する形が標準です。
