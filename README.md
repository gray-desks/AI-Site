# AI情報ブログ (AI Info Blog)

最新のAI情報を自動収集・分析し、発信するブログサイトです。
Node.jsによる自動化パイプラインと、静的HTMLによる高速なフロントエンドを組み合わせています。

## 🚀 プロジェクトの概要

このプロジェクトは、以下の2つの主要なコンポーネントで構成されています。

1.  **Backend (Automation Pipeline)**
    *   **役割**: 情報収集、記事生成、サイト構築
    *   **技術**: Node.js, OpenAI API, Google Custom Search API, YouTube Data API, Cheerio, Sharp
    *   **場所**: `automation/` ディレクトリ

2.  **Frontend (Static Site)**
    *   **役割**: ユーザーへの情報表示
    *   **技術**: HTML5, CSS3 (Vanilla), JavaScript (Vanilla + Barba.js + Lenis)
    *   **場所**: ルートディレクトリ (`index.html`, `assets/` など)

## 🛠 セットアップ

### 前提条件
*   Node.js (v18以上推奨)
*   npm

### インストール
```bash
npm install
```

### 環境変数の設定
`.env` ファイルを作成し、以下のAPIキーを設定してください。

```env
OPENAI_API_KEY=your_openai_api_key
GOOGLE_SEARCH_API_KEY=your_google_search_api_key
GOOGLE_SEARCH_CX=your_google_search_cx
YOUTUBE_API_KEY=your_youtube_api_key
```

## 🏃‍♂️ 実行方法

### パイプラインの実行 (全自動)
キーワードを指定して、調査・執筆・公開までを一括で行います。

```bash
npm run pipeline -- --keyword="生成AI"
```

### 個別のステージ実行
開発やデバッグのために、各工程を個別に実行することも可能です。

*   **調査 (Researcher)**: `npm run research -- --keyword="生成AI"`
*   **執筆 (Generator)**: `npm run generate`
*   **公開 (Publisher)**: `npm run publish`

## 📁 ディレクトリ構造

```
.
├── assets/             # フロントエンドの静的リソース (CSS, JS, 画像)
│   ├── css/            # CSSファイル (SMACSS構成)
│   ├── js/             # JavaScriptファイル
│   └── img/            # 画像ファイル
├── automation/         # 自動化パイプラインのソースコード
│   ├── config/         # 設定ファイル (定数、プロンプト)
│   ├── lib/            # 共通ユーティリティ
│   ├── pipeline/       # パイプライン制御
│   ├── researcher/     # 情報収集エージェント
│   ├── generator/      # 記事執筆エージェント
│   ├── publisher/      # サイト構築エージェント
│   └── templates/      # 記事生成用HTMLテンプレート
├── data/               # 生成されたデータ (JSON)
├── posts/              # 生成された記事HTMLファイル
├── index.html          # トップページ
└── package.json        # プロジェクト設定
```

## 📖 開発ガイド

詳細な開発フローや貢献方法については、[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 📄 ライセンス
ISC
