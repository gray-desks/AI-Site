# Engineering Guidelines

このプロジェクトの技術スタック、ディレクトリ構造、コーディング規約を定義します。

## 1. Tech Stack
-   **Runtime**: Node.js
-   **Server**: Express (Local Development only)
-   **Build System**: Custom Scripts (Node.js + marked)
-   **Frontend**:
    -   HTML5 (Semantic)
    -   Vanilla CSS (No frameworks like Tailwind unless specified)
    -   Vanilla JavaScript (ES6+)
-   **Data Source**: Markdown files (`content/posts/`) + JSON (`data/posts.json`)

## 2. Directory Structure
-   `content/posts/`: **Source of Truth**. 記事のMarkdown原稿。
-   `posts/`: **Generated Output**. 公開用HTML（手動編集禁止）。
-   `data/`: データファイル (`posts.json`, `tags.json` 等)。
-   `scripts/`: 開発・運用ツール。
    -   `build/`: ビルドスクリプト (`articles.js`)
    -   `dev/`: 開発サーバー (`server.js`)
    -   `cli/`: CLIツール (`posts.js`)
    -   `maintenance/`: 保守用 (`fix_tags.js` 等)
-   `automation/`: AI自動化パイプライン。
-   `assets/`: 静的リソース (CSS, JS, Images)。
-   `templates/`: HTMLテンプレート。

## 3. Coding Standards
### JavaScript (Node.js Scripts)
-   **Module System**: CommonJS (`require/module.exports`) を使用。
-   **Async/Await**: 非同期処理は `Promise` チェーンではなく `async/await` を使用する。
-   **Path Handling**: ファイルパスは必ず `path.join` や `path.resolve` を使い、`__dirname` を起点にする（OS間の差異を吸収するため）。
-   **Error Handling**: `try-catch` ブロックを使用し、エラー時は適切なログを出力してプロセスを終了させる（`process.exit(1)`）。

### Frontend (Client-side JS)
-   **Compatibility**: モダンブラウザ（Chrome, Safari, Edge, Firefox）の最新版をターゲットにする。
-   **Performance**: 重い処理は避け、DOM操作は最小限にする。
-   **Local Only**: `admin.js` のような管理機能は `localhost` 以外では動作しないようにガードを入れる。

## 4. Workflow
-   **Build**: `npm run build:posts` でMarkdownからHTMLを生成。
-   **Dev**: `npm run dev` でローカルサーバーを起動。
-   **Deploy**: 生成された静的ファイル (`posts/`, `assets/`, `index.html` 等) をデプロイする（具体的なデプロイ先は別途定義）。
