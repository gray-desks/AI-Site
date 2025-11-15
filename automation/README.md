# Automation Overview

GitHub Actions から `automation/pipeline/index.js` を呼び出し、以下の3ステージを順番に実行します。ローカル環境にはAPIキーを置かず、GitHub Secrets 上の `OPENAI_API_KEY` をワークフローに注入して実行する前提です。

1. **collector** (`automation/collector/index.js`)  
   - `data/sources.json` に登録された YouTube `channelId` をもとに、YouTube Data API v3 の `search` エンドポイントから直近7日以内の動画を取得します。  
   - 候補は `data/candidates.json` に保存され、1チャンネルあたり最大2件をキューします。  
   - 実行には `YOUTUBE_API_KEY` が必要で、GitHub Secrets から注入します。

2. **generator** (`automation/generator/index.js`)  
   - `data/candidates.json` から `status: "pending"` のものを選び、過去5日間に同一トピック（タイトルの slug 化）で記事化していないかを `data/topic-history.json` と `data/posts.json` でチェック。  
   - 重複していれば `status: "skipped"` / `skipReason: "duplicate-topic"` に更新し、他の候補に回します。  
   - 重複していなければ OpenAI (model: `gpt-4o-mini`) に動画情報を渡す前に、Google Custom Search API (`GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`) でリアルタイムの上位記事を取得。結果をプロンプトへ差し込み、SEO観点の bullet 付き JSON を生成させ、`posts/generated-drafts/` にHTMLを出力します。検索APIのシークレットが設定されていない場合は、このステップをスキップし、これまで通りLLMの推論のみでSEOメモを作成します。

3. **publisher** (`automation/publisher/index.js`)  
   - generator が返した記事メタを `data/posts.json` に反映し、最新順に並べ替えます。  
   - Collector / Generator のサマリーを `automation/output/pipeline-status.json` として保存し、静的サイトから参照できるようにします。

## 仕組みのポイント

- `data/topic-history.json` で直近に扱ったトピックを管理し、5日以内に同じ slug の記事を生成しないようにしています。YouTube で同テーマが頻出しても、最終アウトプットの重複を防げます。  
- `data/candidates.json` は collector により自動追加されますが、必要であれば手動で `status` や `notes` を編集して優先順位を調整できます。  
- 失敗時は各ステージが詳細なメッセージを投げるので、`automation/output/pipeline-status.json` を見ると原因を追跡できます。

## 必要なシークレット

| 名前 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | generator で記事テキストを生成するための OpenAI API キー |
| `GOOGLE_SEARCH_API_KEY` | Google Custom Search JSON API キー（リアルタイム検索用、任意だが推奨） |
| `GOOGLE_SEARCH_CX` | Custom Search Engine ID。上記APIキーとペアで指定 |
| `YOUTUBE_API_KEY` | collector が YouTube Data API v3 を呼び出すために使用 |
