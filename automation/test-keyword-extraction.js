#!/usr/bin/env node
/**
 * @fileoverview キーワード抽出機能のテストスクリプト
 * `extractSearchKeywords` 関数が、様々な動画タイトルと説明文に対して
 * 意図通りに動作するかを確認します。
 *
 * 実行方法:
 * `export OPENAI_API_KEY=sk-your-key`
 * `node automation/test-keyword-extraction.js`
 */

const { extractSearchKeywords } = require('./lib/extractKeywords');

// テスト対象となる動画タイトルと説明文のリスト
const testCases = [
  {
    title: 'Sherlock Dash AlphaとSherlock Think Alphaをテストしましょう！',
    description: 'https://www.twitch.tv/technavi_tooru https://x.com/technavi_tooru',
  },
  {
    title: 'ChatGPT Plusの新機能を試してみた！これはすごい',
    description: '今回はChatGPT Plusの最新機能について解説します',
  },
  {
    title: 'Gemini 2.0がついにリリース！性能を徹底比較してみた結果',
    description: 'GoogleのGemini 2.0がリリースされました。従来モデルとの比較を行います。',
  },
];

/**
 * メインのテスト処理
 */
const main = async () => {
  // 環境変数からOpenAI APIキーを取得
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('環境変数 OPENAI_API_KEY が設定されていません。');
    process.exit(1);
  }

  console.log('=== キーワード抽出テスト ===\n');

  // 各テストケースをループして実行
  for (const [index, testCase] of testCases.entries()) {
    console.log(`--- ケース ${index + 1} ---`);
    console.log(`元のタイトル: ${testCase.title}`);
    try {
      // キーワード抽出関数を呼び出し
      const keywords = await extractSearchKeywords(apiKey, testCase.title, testCase.description);
      console.log(`  -> 抽出キーワード: "${keywords}"`);
      console.log(`     文字数: ${keywords.length}文字\n`);
    } catch (error) {
      console.error(`     エラー: ${error.message}\n`);
    }
  }
};

// テストを実行
main().catch(console.error);