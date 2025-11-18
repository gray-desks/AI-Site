# Automation Overview

GitHub Actions から `automation/pipeline/index.js` を呼び出し、以下の4ステージを順番に実行します。ローカル環境には各種APIキーを置かず、GitHub Secrets から注入する前提です。

1. **collector** (`automation/collector/index.js`)  
   - `data/sources.json` に登録された YouTube `channelId` をもとに YouTube Data API v3 の `search` エンドポイントから直近7日以内の動画を取得します。  
   - 候補は `data/candidates.json` に `status: "collected"` で保存され、1チャンネルあたり最大2件をキューします。  
   - 実行には `YOUTUBE_API_KEY` が必要です。

2. **researcher** (`automation/researcher/index.js`)  
   - `status: "collected"` の候補を対象に、OpenAI で検索キーワード抽出 → Google Custom Search API で上位記事取得 → 記事本文の要約（OpenAI + 文字数フォールバック）の流れを実行します。  
   - 成功した候補は `status: "researched"` となり、`searchQuery` や `searchSummaries` を付与します。  
   - 実行には `OPENAI_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` が必要です。

3. **generator** (`automation/generator/index.js`)  
   - `data/candidates.json` から `status: "researched"` のものを選び、過去5日間に同一トピックが `data/topic-history.json` / `data/posts.json` に存在しないかをチェックします。  
   - 重複なら `status: "skipped"` / `skipReason: "duplicate-topic"` を付与。新規トピックなら OpenAI (model: `gpt-4o`) に詳細な記事生成を依頼し、完成HTMLを Publisher に渡します。Google検索が空でも動画メタデータのみで生成を試みます。

4. **publisher** (`automation/publisher/index.js`)  
   - generator から受け取った記事HTMLを `posts/<slug>.html` に書き出し、`data/posts.json` を日付降順で更新します。  
   - Collector/Researcher/Generator のサマリーを `automation/output/pipeline-status.json` に保存し、静的サイトから参照できるようにします。

## 仕組みのポイント

- `data/topic-history.json` で直近5日間に扱ったトピックを管理し、重複生成を防ぎます。YouTube 側で同テーマが頻出しても、Generator は `status: "researched"` の候補から重複を除外します。  
- `data/candidates.json` は collector により自動追加されます。必要に応じて `status` や `notes` を手動で調整しても構いませんが、Researcher → Generator の順序で状態遷移させることが前提です。  
- ステージ毎のメトリクスは `automation/output/pipeline-status.json` に集約され、失敗時のトラブルシューティングにも利用します。

## 記事ビジュアル（ヒーロー/カード画像）

- `assets/img/articles/index.json` に 16:9 比率のテンプレート画像（55種）を定義し、`key`・`src`・`alt`・`topics` などのメタデータを持たせています。SVG 本体も同ディレクトリ配下に配置します。  
- generator は記事タグ・`topicKey`・ソースの focus などをトークン化してマニフェストの `topics` と突き合わせ、決定的に1枚を自動割り当てします。選択結果は `candidate.image` / `candidate.imageKey`、`generatorResult.postEntry.image` に格納されます。  
- publisher は渡された `image` 情報をそのまま `data/posts.json` に保存し、`index.html` のカード一覧と `posts/<slug>.html` のヒーローセクションが同じビジュアルを参照します。  
- 手動で差し替える場合は `data/candidates.json` の対象候補に `image` / `imageKey` を上書きするか、`data/posts.json` を直接編集してください。再利用したい画像はマニフェストに追加した上で `topics` を設定すると自動割当の候補に含まれます。

## 必要なシークレット

| 名前 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | generator で記事テキストを生成するための OpenAI API キー |
| `GOOGLE_SEARCH_API_KEY` | Google Custom Search JSON API キー（リアルタイム検索用、任意だが推奨） |
| `GOOGLE_SEARCH_CX` | Custom Search Engine ID。上記APIキーとペアで指定 |
| `YOUTUBE_API_KEY` | collector が YouTube Data API v3 を呼び出すために使用 |
