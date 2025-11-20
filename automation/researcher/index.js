#!/usr/bin/env node
/**
 * @fileoverview Researcher: 記事候補の調査ステージ
 * - `data/candidates.json` から `status='collected'` の候補を処理します。
 * - OpenAI API を利用して、動画のタイトルと説明から検索キーワードを抽出します。
 * - Google Search API を使って関連記事を検索し、その内容を要約します。
 * - 調査結果で候補情報を更新し、ステータスを `researched` に変更します。
 *
 * 重要な設計方針:
 * - 各処理（キーワード抽出、Google検索、要約生成）は1回のみ実行されます。
 * - 失敗時はフォールバック値を使用し、リトライや再試行はしません。
 * - 無限ループを防ぐため、再検索や再抽出は行いません。
 */

const path = require('path');
const { writeJson, ensureDir } = require('../lib/io');
const { extractSearchKeywords } = require('../lib/extractKeywords');
const { searchTopArticles } = require('../lib/googleSearch');
const slugify = require('../lib/slugify');
const { RESEARCHER, RATE_LIMITS } = require('../config/constants');
const { deriveTopicKey } = require('../lib/topicKey');
const { readCandidates, writeCandidates } = require('../lib/candidatesRepository');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker, average } = require('../lib/metrics');
const { summarizeSearchResult } = require('./services/summaryBuilder');

// --- パス設定 ---
// プロジェクトのルートディレクトリを取得
const root = path.resolve(__dirname, '..', '..');
// 実行結果の出力先ディレクトリのパス
const outputDir = path.join(root, 'automation', 'output', 'researcher');

// --- 定数設定 ---
const { GOOGLE_TOP_LIMIT } = RESEARCHER;
// ロガーとメトリクス追跡ツールを初期化
const logger = createLogger('researcher');
const metricsTracker = createMetricsTracker('researcher');

/**
 * 指定されたミリ秒だけ処理を待機します。APIのレート制限を回避するために使用します。
 * @param {number} ms - 待機する時間（ミリ秒）
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google検索結果から除外するドメインのリスト（主にSNSなど）
// 注意: これらのドメインは検索結果から取得されますが、後処理でフィルタリングされます
const BLOCKED_DOMAINS = [
  'x.com',
  'twitter.com',
  't.co',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'm.youtube.com',
  'reddit.com',
  'pinterest.com',
];

/**
 * URLが除外対象のドメインに一致するか判定します。
 * @param {string} url - 判定するURL
 * @returns {boolean} 除外対象であればtrue
 */
const shouldSkipResult = (url) => {
  if (!url) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // 除外リストのドメインと後方一致するかチェック
    return BLOCKED_DOMAINS.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
    );
  } catch {
    return true; // URLのパースに失敗した場合も除外
  }
};

/**
 * Googleで検索し、上位記事の要約を生成します。
 * 注意: この関数は1回のみ呼び出されます。再試行やループはしません。
 *
 * @param {string} query - 検索クエリ
 * @param {string} googleApiKey - Google Search APIキー
 * @param {string} googleCx - Googleカスタム検索エンジンID
 * @param {string} openaiApiKey - OpenAI APIキー
 * @returns {Promise<Array<object>>} 要約情報の配列
 */
const fetchSearchSummaries = async (query, googleApiKey, googleCx, openaiApiKey) => {
  if (!query || !googleApiKey || !googleCx) return [];
  try {
    const desiredCount = Math.max(1, GOOGLE_TOP_LIMIT); // 取得したい記事の数
    // SNSなどを除外することを考慮し、多めにリクエスト (最大10件)
    // 注意: Google Custom Search APIはドメイン除外パラメータのサポートが限定的なため、
    // 取得後にフィルタリングを行います
    const requestCount = Math.min(desiredCount * 3, 10);

    // Google検索を実行（1回のみ、リトライなし）
    const res = await searchTopArticles({
      apiKey: googleApiKey,
      cx: googleCx,
      query,
      num: requestCount,
    });
    const items = Array.isArray(res.items) ? res.items : [];

    logger.info(`Google検索結果: ${items.length}件取得`);

    // 除外ドメインに一致しないものをフィルタリング
    let skippedCount = 0;
    const filteredItems = items.filter((item) => {
      const skip = shouldSkipResult(item.link);
      if (skip) {
        skippedCount++;
        if (item?.link) {
          logger.info(`  [スキップ] SNS/除外ドメイン: ${item.link}`);
        }
      }
      return !skip;
    });

    if (skippedCount > 0) {
      logger.info(`除外ドメインのフィルタリング: ${skippedCount}件スキップ、${filteredItems.length}件残存`);
    }

    // フィルタ後の結果が多ければ上限数に、少なければ元の結果から上限数に絞る
    const limitedItems = filteredItems.length > 0
      ? filteredItems.slice(0, desiredCount)
      : items.slice(0, desiredCount);
      
    const summaries = [];
    // 各検索結果をループして要約を作成
    for (const [index, item] of limitedItems.entries()) {
      try {
        // OpenAI APIを使って検索結果を要約
        const summaryEntry = await summarizeSearchResult(item, index, openaiApiKey);
        summaries.push(summaryEntry);
        logger.info(
          `要約完了 (${index + 1}/${limitedItems.length}): ${summaryEntry.title} - ${summaryEntry.summary.length}文字`,
        );
      } catch (error) {
        logger.warn(
          `Google検索結果の要約作成に失敗 (${item?.link || 'unknown'}): ${error.message}`,
        );
        // 要約に失敗した場合は、スニペットをフォールバックとして使用
        summaries.push({
          title: item.title || `検索結果${index + 1}`,
          url: item.link,
          snippet: item.snippet || '',
          summary: item.snippet || '',
        });
      }
      // APIレート制限対策として待機
      await sleep(RATE_LIMITS.SEARCH_RESULT_WAIT_MS);
    }
    return summaries;
  } catch (error) {
    logger.warn(`Google Search API 呼び出しに失敗: ${error.message}`);
    return []; // エラーが発生した場合は空の配列を返す
  }
};

/**
 * Researcherステージのメイン処理
 */
const runResearcher = async () => {
  logger.info('ステージ開始: pending候補のリサーチを実行します。');

  // 環境変数からAPIキーを取得
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;
  if (!googleApiKey || !googleCx) {
    throw new Error('GOOGLE_SEARCH_API_KEY と GOOGLE_SEARCH_CX が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readCandidates();

  // リサーチが必要な候補（status='collected'）を抽出
  const candidatesToResearch = candidates.filter((c) => c.status === 'collected');

  if (candidatesToResearch.length === 0) {
    logger.info('リサーチが必要な候補がありません（status=collected の候補が0件）。');
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      metrics: {},
    };
  }

  logger.info(`リサーチ対象: ${candidatesToResearch.length}件`);

  const errors = [];
  let successCount = 0;
  let failureCount = 0;

  // 各候補に対してリサーチ処理を実行
  for (const candidate of candidatesToResearch) {
    metricsTracker.increment('candidates.processed');
    const video = candidate.video;

    logger.info(`処理中: ${video.title}`);

    // --- 1. キーワード抽出 ---
    // 注意: この処理は1回のみ実行されます。失敗時はフォールバックを使用し、リトライはしません。
    let searchQuery = video.title; // フォールバックとして動画タイトルを使用
    let keywordExtractionMethod = 'fallback';
    const keywordStartTime = Date.now();

    try {
      logger.info(`[キーワード抽出] 開始: "${video.title.substring(0, 50)}..."`);
      // OpenAI APIを使ってキーワードを抽出（1回のみ、リトライなし）
      searchQuery = await extractSearchKeywords(
        openaiApiKey,
        video.title,
        video.description,
      );
      const keywordEndTime = Date.now();
      metricsTracker.recordDuration('keywordExtraction.timeMs', keywordEndTime - keywordStartTime);

      if (searchQuery === video.title) {
        logger.warn(`⚠️ キーワード抽出が元のタイトルと同じです: "${searchQuery}"`);
      }

      metricsTracker.increment('keywordExtraction.success');
      keywordExtractionMethod = 'openai';
      logger.info(
        `✓ [キーワード抽出] 成功: "${searchQuery}" (${keywordEndTime - keywordStartTime}ms)`,
      );
    } catch (error) {
      const keywordEndTime = Date.now();
      metricsTracker.increment('keywordExtraction.failure');
      metricsTracker.increment('keywordExtraction.fallback');

      // エラーログを1行で簡潔に表示
      logger.error(`✗ [キーワード抽出] 失敗 (${keywordEndTime - keywordStartTime}ms): ${error.message}`);
      logger.error(`  → フォールバック使用: 動画タイトルをそのまま検索クエリに使用します`);
      logger.error(`  → 対象: "${video.title.substring(0, 50)}..."`);

      searchQuery = video.title; // 失敗した場合は動画タイトルをそのまま使用
      keywordExtractionMethod = 'fallback';

      errors.push({
        candidateId: candidate.id,
        videoTitle: video.title,
        step: 'keyword-extraction',
        message: error.message,
        errorType: error.status ? `HTTP ${error.status}` : 'Unknown',
        model: error.model || 'unknown',
      });
    }

    // APIレート制限対策として待機
    await sleep(RATE_LIMITS.KEYWORD_EXTRACTION_WAIT_MS);

    // --- 2. トピックキー抽出 ---
    // フォールバック用のトピックキーを生成
    let topicKeyInfo = {
      topicKey: slugify(video.title, 'ai-topic'),
      method: 'fallback',
      raw: video.title,
    };
    try {
      // OpenAI APIを使ってトピックキーを抽出
      topicKeyInfo = await deriveTopicKey(openaiApiKey, video, candidate.source);
      const confidenceText =
        typeof topicKeyInfo.confidence === 'number'
          ? topicKeyInfo.confidence.toFixed(2)
          : 'n/a';
      logger.info(`トピックキー抽出: ${topicKeyInfo.topicKey} (confidence: ${confidenceText})`);
    } catch (error) {
      logger.warn(`トピックキー抽出に失敗: ${error.message}`);
      // 失敗した場合はフォールバック値を使用
      topicKeyInfo = {
        topicKey: slugify(video.title, 'ai-topic'),
        method: 'fallback',
        raw: video.title,
        error: error.message,
      };
    }

    // --- 3. Google検索と要約 ---
    // 注意: この処理は1回のみ実行されます。失敗時は空の配列を返し、リトライはしません。
    let searchSummaries = [];
    const stopSearchTimer = metricsTracker.startTimer('googleSearch.timeMs');

    try {
      logger.info(`[Google検索] 開始: "${searchQuery}"`);
      // 抽出したキーワードでGoogle検索し、結果を要約（1回のみ、リトライなし）
      searchSummaries = await fetchSearchSummaries(searchQuery, googleApiKey, googleCx, openaiApiKey);
      const elapsed = stopSearchTimer();

      metricsTracker.increment('googleSearch.success');
      metricsTracker.increment('googleSearch.totalResults', searchSummaries.length);
      logger.info(`✓ [Google検索] 完了: ${searchSummaries.length}件の要約を取得 (${elapsed}ms)`);
    } catch (error) {
      const elapsed = stopSearchTimer();
      metricsTracker.increment('googleSearch.failure');

      // エラーログを1行で簡潔に表示
      logger.error(`✗ [Google検索] 失敗 (${elapsed}ms): ${error.message}`);
      logger.error(`  → 検索クエリ: "${searchQuery}"`);
      logger.error(`  → 結果: 要約なしで続行します`);

      searchSummaries = []; // 失敗した場合は空の配列を設定

      errors.push({
        candidateId: candidate.id,
        videoTitle: video.title,
        step: 'google-search',
        searchQuery,
        message: error.message,
        errorType: error.status ? `HTTP ${error.status}` : 'Unknown',
      });
    }

    // --- 4. 候補情報の更新 ---
    const now = new Date().toISOString();
    // リサーチ結果を候補オブジェクトにマージ
    const updatedCandidate = {
      ...candidate,
      searchQuery: {
        original: video.title,
        extracted: searchQuery,
        method: keywordExtractionMethod,
      },
      topicKey: topicKeyInfo.topicKey,
      topicKeyMeta: {
        method: topicKeyInfo.method,
        raw: topicKeyInfo.raw || topicKeyInfo.topicKey,
        product: topicKeyInfo.product || null,
        feature: topicKeyInfo.feature || null,
        category: topicKeyInfo.category || null,
        confidence: typeof topicKeyInfo.confidence === 'number' ? topicKeyInfo.confidence : null,
        reasoning: topicKeyInfo.reasoning || null,
        error: topicKeyInfo.error || null,
      },
      searchSummaries,
      status: 'researched', // ステータスを 'researched' に更新
      researchedAt: now,
      updatedAt: now,
    };

    // candidates配列内の該当候補を更新
    const candidateIndex = candidates.findIndex((c) => c.id === candidate.id);
    if (candidateIndex !== -1) {
      candidates[candidateIndex] = updatedCandidate;
      successCount += 1;
    } else {
      failureCount += 1;
      logger.error(`⚠️ 候補が見つかりません: ${candidate.id}`);
    }

    // APIレート制限対策として待機
    await sleep(RATE_LIMITS.CANDIDATE_PROCESSING_WAIT_MS);
  }

  // 更新された候補リストをファイルに書き込み
  writeCandidates(candidates);

  // --- 成果物の保存 ---
  ensureDir(outputDir); // 出力ディレクトリがなければ作成
  const timestamp = new Date().toISOString();
  // メトリクスサマリーの計算
  const keywordDurations = metricsTracker.getTimings('keywordExtraction.timeMs');
  const googleDurations = metricsTracker.getTimings('googleSearch.timeMs');
  const avgKeywordTime = average(keywordDurations);
  const avgSearchTime = average(googleDurations);
  const totalProcessed = metricsTracker.getCounter('candidates.processed');
  const keywordSuccess = metricsTracker.getCounter('keywordExtraction.success');
  const keywordFailure = metricsTracker.getCounter('keywordExtraction.failure');
  const fallbackUsed = metricsTracker.getCounter('keywordExtraction.fallback');
  const googleSuccess = metricsTracker.getCounter('googleSearch.success');
  const googleFailure = metricsTracker.getCounter('googleSearch.failure');
  const totalSearches = googleSuccess + googleFailure;
  const totalResults = metricsTracker.getCounter('googleSearch.totalResults');
  const avgResultsPerSearch = googleSuccess > 0 ? Math.round(totalResults / googleSuccess) : 0;

  // レポート用のメトリクスオブジェクトを作成
  const metricsReport = {
    totalProcessed,
    keywordExtraction: {
      success: keywordSuccess,
      failure: keywordFailure,
      fallbackUsed,
      successRate: totalProcessed > 0 ? Math.round((keywordSuccess / totalProcessed) * 100) : 0,
    },
    googleSearch: {
      success: googleSuccess,
      failure: googleFailure,
      totalResults,
      successRate: totalSearches > 0 ? Math.round((googleSuccess / totalSearches) * 100) : 0,
      avgResultsPerSearch,
    },
    performance: {
      avgKeywordExtractionTimeMs: avgKeywordTime,
      avgGoogleSearchTimeMs: avgSearchTime,
    },
  };

  // 出力データを作成
  const outputData = {
    timestamp,
    processed: totalProcessed,
    succeeded: successCount,
    failed: failureCount,
    metrics: metricsReport,
    errors,
    // 直近1時間でリサーチされた候補のリスト
    researchedCandidates: candidates
      .filter((c) => c.status === 'researched' && c.researchedAt && new Date(c.researchedAt).getTime() > Date.now() - 3600000) 
      .map((c) => ({
        id: c.id,
        videoTitle: c.video.title,
        searchQuery: c.searchQuery,
        searchSummariesCount: c.searchSummaries?.length || 0,
        researchedAt: c.researchedAt,
      })),
  };

  // 成果物をJSONファイルとして保存
  const outputPath = path.join(outputDir, `researcher-${timestamp.split('T')[0]}.json`);
  writeJson(outputPath, outputData);
  logger.info(`成果物を保存しました: ${outputPath}`);

  // --- メトリクスサマリーの表示 ---
  logger.info('\n=== Researcher メトリクスサマリー ===');
  logger.info(`処理候補数: ${totalProcessed}件`);
  logger.info(`成功: ${successCount}件 / 失敗: ${failureCount}件`);
  logger.info(
    `キーワード抽出: 成功 ${keywordSuccess}件 / 失敗 ${keywordFailure}件 (フォールバック: ${fallbackUsed}件)`,
  );
  logger.info(
    `Google検索: 成功 ${googleSuccess}件 / 失敗 ${googleFailure}件 (平均 ${avgResultsPerSearch}件/検索)`,
  );
  logger.info(`平均処理時間: キーワード抽出 ${avgKeywordTime}ms / Google検索 ${avgSearchTime}ms`);

  if (errors.length > 0) {
    logger.warn(`\n⚠️  警告: ${errors.length}件のエラーが発生しました`);
    // エラーをステップごとに集計
    const errorsByStep = errors.reduce((acc, err) => {
      acc[err.step] = (acc[err.step] || 0) + 1;
      return acc;
    }, {});
    Object.entries(errorsByStep).forEach(([step, count]) => {
      logger.warn(`  - ${step}: ${count}件`);
    });
  }

  logger.success(`\n完了: ${successCount}件のリサーチが完了しました。`);

  // パイプラインの次のステージに渡す結果オブジェクト
  return {
    processed: totalProcessed,
    succeeded: successCount,
    failed: failureCount,
    errors,
    metrics: metricsReport,
  };
};

// スクリプトが直接実行された場合にrunResearcherを実行
if (require.main === module) {
  runResearcher()
    .then((result) => {
      logger.info('Researcher finished:', result);
    })
    .catch((error) => {
      logger.error('Researcher failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runResearcher,
};