# generator

- collectorが抽出したキーワードを入力に受け取り、LLMや検索APIで補完情報を集めます。
- `automation/templates/article.md` を参考にHTMLを組み立て、`automation/publisher` に渡すレスポンスへ直に埋め込みます。
- Publisherが受け取ったHTMLを `posts/<slug>.html` へ書き出すため、generator 側でのドラフト保存や手動レビューなしに即公開されます。
