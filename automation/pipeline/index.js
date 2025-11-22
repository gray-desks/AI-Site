#!/usr/bin/env node
/**
 * @fileoverview パイプラインオーケストレーター
 * キーワードベースの記事生成パイプライン
 *
 * 処理フロー:
 * 1. Collector: YouTube Data APIから候補動画を収集・保存し、検索キーワードキューを更新
 * 2. キーワード選定: 保存済みキーワードを読み込み、既存記事と重複しないものを1件消費
 * 3. Researcher: Google検索による調査（検索1回、要約3件）
 * 4. Generator: 記事を生成
 * 5. Publisher: 生成された記事をサイトに公開
 *
 * 重要な設計方針:
 * - 各ステージは1回のみ実行されます。リトライや再試行はしません。
 * - エラーが発生した場合は、フォールバック値を使用するか、gracefulに失敗します。
 * - 無限ループを防ぐため、どのステージでも再検索や再生成は行いません。
 */

const path = require('path');
const fs = require('fs');
const { parseArgs } = require('util');
const { readJson, writeJson } = require('../lib/io');
const { runCollector } = require('../collector');
const { runResearcher } = require('../researcher');
const { runGenerator } = require('../generator');
const { runPublisher, recordFailureStatus } = require('../publisher');
const slugify = require('../lib/slugify');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const keywordsPath = path.join(root, 'data', 'keywords.json');
const postsDir = path.join(root, 'posts');

/**
 * 既存記事のスラグ一覧を取得します。
 * postsディレクトリ内のファイル名から日付プレフィックスを除去してスラグ化します。
 */
const getExistingArticleSlugs = () => {
  if (!fs.existsSync(postsDir)) return new Set();
  const files = fs.readdirSync(postsDir, { withFileTypes: true });
  const slugs = files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html') && entry.name !== 'article-template.html')
    .map((entry) => entry.name.replace(/\.html$/, ''))
    .map((name) => name.replace(/^\d{4}-\d{2}-\d{2}-/, ''))
    .map((name) => slugify(name, 'article'));
  return new Set(slugs);
};

/**
 * 2つの文字列の類似度（0.0〜1.0）を計算します。
 * Levenshtein距離に基づき、文字列の近さを判定します。
 * @param {string} s1
 * @param {string} s2
 * @returns {number} 類似度 (0.0: 全く異なる, 1.0: 完全一致)
 */
const calculateSimilarity = (s1, s2) => {
  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);
  if (maxLen === 0) return 1.0;

  const matrix = [];
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  return 1.0 - distance / maxLen;
};

/**
 * keywords.json から検索キーワードを1件取り出し、既存記事と重複しないものだけを残します。
 * 取り出したキーワードはキューから削除され、以後再利用されません。
 * 重複判定には完全一致に加え、スラグの類似度（Levenshtein距離）も使用します。
 * @returns {{ keyword: string, remaining: number }} 取り出したキーワードと残キュー数
 */
const consumeKeyword = () => {
  let queue = readJson(keywordsPath, []);
  if (!Array.isArray(queue)) queue = [];

  const existingSlugs = getExistingArticleSlugs();
  const seenSlugs = new Set();
  const normalizedQueue = [];

  // キュー内の重複を排除しつつ正規化
  for (const entry of queue) {
    if (!entry || typeof entry !== 'string') continue;
    const slug = slugify(entry, 'keyword');
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    normalizedQueue.push({ value: entry, slug });
  }

  let picked = null;
  const remainingQueue = [];

  for (const item of normalizedQueue) {
    // 既存記事との重複チェック（完全一致 + 類似度）
    const isDuplicate = Array.from(existingSlugs).some((existing) => {
      // 1. 完全一致
      if (existing === item.slug) return true;

      // 2. 類似度チェック (閾値 0.8)
      // 短すぎるスラグは誤判定のリスクがあるため、ある程度の長さがある場合のみチェック
      if (item.slug.length > 5 && existing.length > 5) {
        return calculateSimilarity(item.slug, existing) > 0.8;
      }
      return false;
    });

    if (!isDuplicate && !picked) {
      picked = item.value;
      continue;
    }

    // 既存記事と重複しないものだけをキューに残す
    if (!isDuplicate) {
      remainingQueue.push(item.value);
    } else {
      console.log(`[pipeline] Skipped duplicate keyword: "${item.value}" (slug: ${item.slug})`);
    }
  }

  if (!picked) {
    throw new Error('keywords.json に有効なキーワードがありません（既存記事と重複を除外後に空になりました）。');
  }

  writeJson(keywordsPath, remainingQueue);
  return { keyword: picked, remaining: remainingQueue.length };
};

/**
 * メインのパイプライン処理
 */
const main = async () => {
  // CLI引数のパース
  const options = {
    keyword: {
      type: 'string',
      short: 'k',
    },
    stages: {
      type: 'string',
      short: 's',
    },
  };

  let args;
  try {
    const parsed = parseArgs({ options, strict: false });
    args = parsed.values;
  } catch (e) {
    // Node.jsのバージョンによっては parseArgs が利用できない場合や
    // オプションが異なる場合のフォールバック (簡易実装)
    args = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--keyword' || argv[i] === '-k') args.keyword = argv[i + 1];
      if (argv[i] === '--stages' || argv[i] === '-s') args.stages = argv[i + 1];
    }
  }

  console.log('[pipeline] 自動記事生成パイプラインを起動します。');
  console.log('[pipeline] 処理フロー: Collector → Keyword Selection → Researcher → Generator → Publisher\n');

  // 各ステージの結果を格納する変数
  let collectorResult = null;
  let researcherResult = null;
  let generatorResult = null;
  let keyword = null;

  try {
    // Stage 1: Collector
    console.log('\n[pipeline] === Stage 1/5: Collector ===');
    collectorResult = await runCollector();
    console.log('[pipeline] Collector 完了:', {
      newCandidates: collectorResult.newCandidates,
      totalCandidates: collectorResult.totalCandidates,
      keywordsAdded: collectorResult.keywordsAdded ?? 0,
      keywordQueueSize: collectorResult.keywordQueueSize ?? 'unknown',
    });

    // Stage 2: キーワード選定
    console.log('\n[pipeline] === Stage 2/5: Keyword Selection ===');
    if (args.keyword) {
      keyword = args.keyword;
      console.log(`[pipeline] CLI引数からキーワードを使用: "${keyword}"`);
    } else {
      const { keyword: picked, remaining } = consumeKeyword();
      keyword = picked;
      console.log(`[pipeline] keywords.jsonからキーワードを使用: "${keyword}" (残り ${remaining} 件)`);
    }

    // Stage 3: Researcher (キーワードでGoogle検索)
    console.log('\n[pipeline] === Stage 3/5: Researcher ===');
    researcherResult = await runResearcher({ keyword });
    console.log('[pipeline] Researcher 完了:', {
      keyword: researcherResult.keyword,
      summariesCount: researcherResult.summaries.length,
    });

    // Researcherで要約が取得できなかった場合は、後続のステージをスキップ
    if (researcherResult.summaries.length === 0) {
      console.log('\n[pipeline] 要約が0件のため、GeneratorとPublisherをスキップします。');
      generatorResult = {
        generated: false,
        reason: 'no-summaries',
      };
      // Publisherを呼び出して最終的なステータスを記録
      const status = await runPublisher({
        collectorResult,
        researcherResult,
        generatorResult,
      });
      console.log('\n[pipeline] Pipeline completed (skipped).');
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    // Stage 4: Generator (記事生成)
    console.log('\n[pipeline] === Stage 4/5: Generator ===');
    generatorResult = await runGenerator(researcherResult);
    console.log('[pipeline] Generator 完了:', {
      generated: generatorResult.generated,
      reason: generatorResult.reason || 'success',
    });

    // Stage 5: Publisher (公開)
    console.log('\n[pipeline] === Stage 5/5: Publisher ===');
    const status = await runPublisher({
      collectorResult,
      researcherResult,
      generatorResult,
    });

    console.log('\n[pipeline] Pipeline completed successfully.');
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    // パイプラインのいずれかのステージでエラーが発生した場合
    console.error('\n[pipeline] ⚠️  パイプライン内でエラーが発生しました。');
    console.error(`[pipeline] エラー詳細: ${error.message}`);
    // 失敗ステータスを記録
    recordFailureStatus(error, {
      collector: collectorResult,
      researcher: researcherResult,
      generator: generatorResult,
    });
    throw error; // エラーを再スローしてプロセスを異常終了させる
  }
};

// スクリプトが直接実行された場合にmain関数を呼び出す
main().catch((error) => {
  console.error('Pipeline failed:', error);
  process.exit(1);
});
