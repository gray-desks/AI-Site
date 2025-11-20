#!/usr/bin/env node
/**
 * @fileoverview パイプラインオーケストレーター
 * Collector -> Researcher -> Generator -> Publisher の各ステージを順次実行します。
 *
 * 各ステージの役割:
 * 1. Collector: YouTube動画情報を収集 (候補ステータス: collected)
 * 2. Researcher: キーワード抽出とGoogle検索による調査 (候補ステータス: researched)
 * 3. Generator: 記事を生成 (候補ステータス: generated)
 * 4. Publisher: 生成された記事をサイトに公開 (候補ステータス: published)
 *
 * 重要な設計方針:
 * - 各ステージは1回のみ実行されます。リトライや再試行はしません。
 * - エラーが発生した場合は、フォールバック値を使用するか、gracefulに失敗します。
 * - 無限ループを防ぐため、どのステージでも再検索や再生成は行いません。
 */

const { runCollector } = require('../collector');
const { runResearcher } = require('../researcher');
const { runGenerator } = require('../generator');
const { runPublisher, recordFailureStatus } = require('../publisher');

/**
 * メインのパイプライン処理
 */
const main = async () => {
  console.log('[pipeline] 自動記事生成パイプラインを起動します。');
  console.log('[pipeline] 4ステージ構成: Collector → Researcher → Generator → Publisher\n');

  // 各ステージの結果を格納する変数
  let collectorResult = null;
  let researcherResult = null;
  let generatorResult = null;

  try {
    // Stage 1: Collector (YouTube動画取得)
    console.log('[pipeline] === Stage 1/4: Collector ===');
    collectorResult = await runCollector();
    console.log('[pipeline] Collector 完了:', {
      newCandidates: collectorResult.newCandidates,
      totalCandidates: collectorResult.totalCandidates,
    });

    // Stage 2: Researcher (キーワード抽出 + Google検索)
    console.log('\n[pipeline] === Stage 2/4: Researcher ===');
    researcherResult = await runResearcher();
    console.log('[pipeline] Researcher 完了:', {
      processed: researcherResult.processed,
      succeeded: researcherResult.succeeded,
      failed: researcherResult.failed,
    });

    // Researcherで処理された候補がない場合は、後続のステージをスキップ
    if (researcherResult.succeeded === 0) {
      console.log('\n[pipeline] リサーチ済み候補が0件のため、GeneratorとPublisherをスキップします。');
      generatorResult = {
        generated: false,
        reason: 'no-researched-candidates',
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

    // Stage 3: Generator (記事生成)
    console.log('\n[pipeline] === Stage 3/4: Generator ===');
    generatorResult = await runGenerator();
    console.log('[pipeline] Generator 完了:', {
      generated: generatorResult.generated,
      reason: generatorResult.reason || 'success',
    });

    // Stage 4: Publisher (公開)
    console.log('\n[pipeline] === Stage 4/4: Publisher ===');
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
