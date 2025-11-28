#!/usr/bin/env node
/**
 * @fileoverview パイプラインオーケストレーター（動画ベース）
 * フロー:
 * 1. Collector: 未処理候補が閾値未満ならYouTube Data APIで最新動画を収集
 * 2. Researcher: 未処理動画から最新順で選定し、Video ID重複とAIテーマ重複をチェック、字幕を取得
 * 3. Generator: 字幕をもとに記事を生成
 * 4. Publisher: 記事を公開し、処理結果を記録
 */

const { parseArgs } = require('util');
const { runCollector } = require('../collector');
const { runResearcher } = require('../researcher');
const { runGenerator } = require('../generator');
const { runPublisher, recordFailureStatus } = require('../publisher');
const { readCandidates } = require('../lib/candidatesRepository');
const { COLLECTOR } = require('../config/constants');

/**
 * 未処理（status='collected'）の候補数を取得します。
 */
const countActiveCandidates = () => {
  const candidates = readCandidates();
  if (!Array.isArray(candidates)) return 0;
  return candidates.filter((item) => item.status === 'collected').length;
};

/**
 * Collectorの実行をスキップすべきか判定します。
 * 未処理候補が十分にある場合、APIコストを節約するためにスキップします。
 */
const shouldSkipCollector = (activeCount) => {
  const threshold = COLLECTOR?.SKIP_IF_ACTIVE_CANDIDATES || 0;
  return threshold > 0 && activeCount >= threshold;
};

/**
 * メインのパイプライン処理
 */
const main = async () => {
  // CLI引数のパース
  const options = {
    count: {
      type: 'string',
      short: 'c',
    },
  };

  let args;
  try {
    const parsed = parseArgs({ options, strict: false });
    args = parsed.values;
  } catch (e) {
    args = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--count' || argv[i] === '-c') args.count = argv[i + 1];
    }
  }

  console.log('[pipeline] 自動記事生成パイプラインを起動します。');
  console.log('[pipeline] 処理フロー: Collector → Researcher → Generator → Publisher\n');

  // 各ステージの結果
  let collectorResult = null;
  let researcherResult = null;
  let generatorResult = null;

  const targetArticles = Math.max(1, Number(args.count || process.env.ARTICLES_PER_RUN || 2));
  const maxAttempts = Math.max(targetArticles * 2, targetArticles + 1);
  let publishedCount = 0;
  let attempts = 0;
  const runStatuses = [];

  try {
    // Stage 1: Collector（未処理候補が多い場合はスキップ）
    const activeBefore = countActiveCandidates();
    if (shouldSkipCollector(activeBefore)) {
      console.log(
        `[pipeline] === Stage 1/4: Collector (skipped) ===\n` +
        `[pipeline] 未処理候補が十分あるためCollectorをスキップします (${activeBefore}件)`
      );
      collectorResult = {
        status: 'skipped',
        reason: 'active-candidates-sufficient',
        activeCandidates: activeBefore,
      };
    } else {
      console.log('\n[pipeline] === Stage 1/4: Collector ===');
      collectorResult = await runCollector();
      console.log('[pipeline] Collector 完了:', {
        newCandidates: collectorResult.newCandidates,
        totalCandidates: collectorResult.totalCandidates,
      });
    }

    while (publishedCount < targetArticles && attempts < maxAttempts) {
      attempts += 1;
      console.log(`\n[pipeline] ===== Attempt ${attempts}/${maxAttempts} =====`);

      // Stage 2: Researcher
      console.log('\n[pipeline] === Stage 2/4: Researcher ===');
      researcherResult = await runResearcher();
      if (researcherResult.status !== 'researched' || !researcherResult.candidate) {
        console.log('[pipeline] Researcherで採用候補が見つからなかったため生成をスキップします。');
        generatorResult = {
          generated: false,
          reason: 'no-researched-candidate',
        };
        const status = await runPublisher({
          collectorResult,
          researcherResult,
          generatorResult,
        });
        runStatuses.push(status);
        if (researcherResult.status === 'no-candidates') break;
        continue;
      }

      console.log('[pipeline] Researcher 完了:', {
        candidateId: researcherResult.candidate.id,
        title: researcherResult.candidate.video?.title,
      });

      // Stage 3: Generator
      console.log('\n[pipeline] === Stage 3/4: Generator ===');
      generatorResult = await runGenerator({ candidate: researcherResult.candidate });
      console.log('[pipeline] Generator 完了:', {
        generated: generatorResult.generated,
        reason: generatorResult.reason || 'success',
      });

      // Stage 4: Publisher
      console.log('\n[pipeline] === Stage 4/4: Publisher ===');
      const status = await runPublisher({
        collectorResult,
        researcherResult,
        generatorResult,
      });
      runStatuses.push(status);

      if (generatorResult.generated) {
        publishedCount += 1;
        console.log(`[pipeline] ✅ 生成完了 (${publishedCount}/${targetArticles})`);
      } else {
        console.log('[pipeline] 生成されなかったため次の候補に進みます。');
      }
    }

    console.log('\n[pipeline] Pipeline completed.');
    console.log(`[pipeline] 生成記事: ${publishedCount} / 目標 ${targetArticles} （試行 ${attempts}/${maxAttempts}）`);
    if (runStatuses.length > 0) {
      console.log(JSON.stringify(runStatuses[runStatuses.length - 1], null, 2));
    }
  } catch (error) {
    console.error('\n[pipeline] ⚠️  パイプライン内でエラーが発生しました。');
    console.error(`[pipeline] エラー詳細: ${error.message}`);
    // 失敗ステータスを記録
    recordFailureStatus(error, {
      collector: collectorResult,
      researcher: researcherResult,
      generator: generatorResult,
    });
    throw error;
  }
};

// スクリプトが直接実行された場合にmain関数を呼び出す
main().catch((error) => {
  console.error('Pipeline failed:', error);
  process.exit(1);
});
