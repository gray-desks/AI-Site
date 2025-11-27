#!/usr/bin/env node
/**
 * @fileoverview パイプラインオーケストレーター
 * キーワードベースの記事生成パイプライン（1ジョブで最大N本まで連続生成）
 *
 * 処理フロー:
 * 1. Collector: キーワードキューが閾値未満の場合のみYouTube Data APIで新規候補を収集
 * 2. キーワード選定: 保存済みキーワードを読み込み、既存記事と重複しないものを取り出す（不足時は終了）
 * 3. Researcher: Google検索1回で要約を取得。要約0件ならキーワードをリキューして次へ
 * 4. Generator: 記事を生成。生成失敗時はキーワードをリキューして次へ
 * 5. Publisher: 生成された記事をサイトに公開（各試行で更新）
 *
 * 実行回数:
 * - 1ジョブ内で最大 targetArticles 本までループします（デフォルト2本。環境変数 ARTICLES_PER_RUN または --count で変更可）
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
const { KEYWORDS, RESEARCHER } = require('../config/constants');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const keywordsPath = path.join(root, 'data', 'keywords.json');
const postsDir = path.join(root, 'posts');

/**
 * キーワードキューのサイズを取得します。
 */
const getKeywordQueueSize = () => {
  const queue = readJson(keywordsPath, []);
  return Array.isArray(queue) ? queue.length : 0;
};

/**
 * Google検索用にキーワードをサニタイズ・短縮します。
 * - 余計な引用符や読点を除去
 * - 連続スペースを1つに圧縮
 * - 末尾の読点・省略記号を除去
 * - 最大80文字に制限
 */
const sanitizeKeyword = (value) => {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/["“”'「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[、。…!！?？・]+$/g, '')
    .trim()
    .slice(0, 80);
};

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
 * Collectorの実行をスキップすべきか判定します。
 * キーワードキューが十分にある場合、APIコストを節約するためにスキップします。
 */
const shouldSkipCollector = (queueSize) => {
  const threshold = KEYWORDS?.SKIP_COLLECTOR_THRESHOLD || 0;
  return threshold > 0 && queueSize >= threshold;
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

  // 上限を超えている場合は末尾から削除（最新優先）
  const limit = KEYWORDS?.QUEUE_LIMIT || 0;
  if (limit > 0 && queue.length > limit) {
    const removed = queue.length - limit;
    queue = queue.slice(0, limit);
    console.log(`[pipeline] keywords.json を上限${limit}件にトリム (${removed}件を削除)`);
    writeJson(keywordsPath, queue);
  }

  const existingSlugs = getExistingArticleSlugs();
  const seenSlugs = new Set();
  const normalizedQueue = [];

  // キュー内の重複を排除しつつ正規化
  for (const entry of queue) {
    if (!entry || typeof entry !== 'string') continue;
    const cleaned = sanitizeKeyword(entry);
    if (!cleaned) continue;
    const slug = slugify(cleaned, 'keyword');
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    normalizedQueue.push({ value: cleaned, slug });
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
 * 処理がスキップされたキーワードをキュー先頭に戻します。
 * 既存スラグと重複する場合は何もしません。
 */
const requeueKeyword = (value) => {
  const cleaned = sanitizeKeyword(value);
  if (!cleaned) return;

  let queue = readJson(keywordsPath, []);
  if (!Array.isArray(queue)) queue = [];

  const slug = slugify(cleaned, 'keyword');
  const existingSlugs = new Set(queue.map((k) => slugify(k, 'keyword')));
  if (existingSlugs.has(slug)) return;

  queue.unshift(cleaned);

  // 上限で末尾を切り詰める
  const limit = KEYWORDS?.QUEUE_LIMIT || 0;
  if (limit > 0 && queue.length > limit) {
    queue = queue.slice(0, limit);
  }

  writeJson(keywordsPath, queue);
  console.log(`[pipeline] keyword をリキュー: "${cleaned}" (総数 ${queue.length})`);
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
    count: {
      type: 'string',
      short: 'c',
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
      if (argv[i] === '--count' || argv[i] === '-c') args.count = argv[i + 1];
      if (argv[i] === '--stages' || argv[i] === '-s') args.stages = argv[i + 1];
    }
  }

  console.log('[pipeline] 自動記事生成パイプラインを起動します。');
  console.log('[pipeline] 処理フロー: Collector → Keyword Selection → Researcher → Generator → Publisher\n');

  // 各ステージの結果を格納する変数（最後の試行で使用）
  let collectorResult = null;
  let researcherResult = null;
  let generatorResult = null;
  let keywordForContext = null;

  const targetArticles = Math.max(1, Number(args.count || process.env.ARTICLES_PER_RUN || 2));
  const maxAttempts = Math.max(targetArticles * 2, targetArticles + 1);
  let publishedCount = 0;
  let attempts = 0;
  let pendingKeywordArg = args.keyword;
  const runStatuses = [];

  try {
    // Stage 1: Collector（キューが十分ならスキップ）
    const queueSizeBefore = getKeywordQueueSize();
    if (shouldSkipCollector(queueSizeBefore)) {
      console.log(
        `[pipeline] === Stage 1/5: Collector (skipped) ===\n` +
        `[pipeline] キーワードキューが十分あるためCollectorをスキップします (${queueSizeBefore}件)`
      );
      collectorResult = {
        status: 'skipped',
        reason: 'queue-sufficient',
        keywordQueueSize: queueSizeBefore,
      };
    } else {
      console.log('\n[pipeline] === Stage 1/5: Collector ===');
      collectorResult = await runCollector();
      console.log('[pipeline] Collector 完了:', {
        newCandidates: collectorResult.newCandidates,
        totalCandidates: collectorResult.totalCandidates,
        keywordsAdded: collectorResult.keywordsAdded ?? 0,
        keywordQueueSize: collectorResult.keywordQueueSize ?? 'unknown',
      });
    }

    while (publishedCount < targetArticles && attempts < maxAttempts) {
      attempts += 1;
      console.log(`\n[pipeline] ===== Attempt ${attempts}/${maxAttempts} =====`);

      // Stage 2: キーワード選定
      console.log('\n[pipeline] === Stage 2/5: Keyword Selection ===');
      keywordForContext = null;
      if (pendingKeywordArg) {
        const cleanedArg = sanitizeKeyword(pendingKeywordArg);
        pendingKeywordArg = null; // 1回のみ使用
        if (!cleanedArg) {
          throw new Error('CLI引数のキーワードが無効です。空でない文字列を指定してください。');
        }
        keywordForContext = cleanedArg;
        console.log(`[pipeline] CLI引数からキーワードを使用: "${keywordForContext}"`);
      } else {
        try {
          const { keyword: picked, remaining } = consumeKeyword();
          keywordForContext = picked;
          console.log(`[pipeline] keywords.jsonからキーワードを使用: "${keywordForContext}" (残り ${remaining} 件)`);
        } catch (err) {
          console.log(`[pipeline] キーワードキューが空です。${err.message}`);
          break;
        }
      }

      // Stage 3: Researcher (キーワードでGoogle検索)
      console.log('\n[pipeline] === Stage 3/5: Researcher ===');
      researcherResult = await runResearcher({ keyword: keywordForContext });
      console.log('[pipeline] Researcher 完了:', {
        keyword: researcherResult.keyword,
        summariesCount: researcherResult.summaries.length,
      });

      // 要約0件なら次のキーワードに回す（リキューして欠番を減らす）
      const minSummaries = RESEARCHER?.MIN_SUMMARIES || 1;
      if (researcherResult.summaries.length < minSummaries) {
        console.log('\n[pipeline] 要約が0件のため、GeneratorとPublisherをスキップします。');
        generatorResult = {
          generated: false,
          reason: 'no-summaries',
        };
        requeueKeyword(keywordForContext);
        const status = await runPublisher({
          collectorResult,
          researcherResult,
          generatorResult,
        });
        runStatuses.push(status);
        continue;
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
      runStatuses.push(status);

      if (generatorResult.generated) {
        publishedCount += 1;
        console.log(`[pipeline] ✅ 生成完了 (${publishedCount}/${targetArticles})`);
      } else if (generatorResult.reason === 'article-generation-failed') {
        // 生成失敗は再挑戦できるようにキーワードを戻す
        requeueKeyword(keywordForContext);
      } else {
        console.log('[pipeline] 生成されなかったため次のキーワードに進みます。');
      }
    }

    console.log('\n[pipeline] Pipeline completed.');
    console.log(`[pipeline] 生成記事: ${publishedCount} / 目標 ${targetArticles} （試行 ${attempts}/${maxAttempts}）`);
    if (runStatuses.length > 0) {
      console.log(JSON.stringify(runStatuses[runStatuses.length - 1], null, 2));
    }
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
