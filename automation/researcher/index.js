#!/usr/bin/env node
/**
 * @fileoverview Researcher: キーワードベースのGoogle検索・要約ツール
 * - 指定されたキーワードからLLMを使って多角的な検索クエリを生成します。
 * - 複数のクエリでGoogle検索を並列実行し、結果を統合・重複排除します。
 * - 求人サイトやセミナー情報などのノイズを強力にフィルタリングします。
 * - 上位の記事を取得し、OpenAI APIで要約します。
 */

const path = require('path');
const { ensureDir, writeJson } = require('../lib/io');
const { searchTopArticles } = require('../lib/googleSearch');
const { RESEARCHER, RATE_LIMITS } = require('../config/constants');
const { QUERY_GENERATION } = require('../config/models');
const QUERY_GENERATION_PROMPT = require('../prompts/queryGeneration');
const { callOpenAI, parseJsonContent } = require('../lib/openai');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker } = require('../lib/metrics');
const { summarizeSearchResult } = require('./services/summaryBuilder');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, 'automation', 'output', 'researcher');

// --- 定数設定 ---
const { GOOGLE_TOP_LIMIT, MIN_SUMMARIES, SEARCH_FRESHNESS_DAYS, SUMMARY_MIN_LENGTH } = RESEARCHER;
const logger = createLogger('researcher');
const metricsTracker = createMetricsTracker('researcher');

/**
 * 指定されたミリ秒だけ処理を待機します。
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google検索結果から除外するドメインのリスト
const BLOCKED_DOMAINS = [
  // SNS
  'x.com', 'twitter.com', 't.co', 'facebook.com', 'instagram.com', 'tiktok.com',
  'youtube.com', 'youtu.be', 'm.youtube.com', 'reddit.com', 'pinterest.com',
  // ニュース・まとめ・Q&A
  'b.hatena.ne.jp', 'forest.watch.impress.co.jp', 'itmedia.co.jp', 'news.mynavi.jp', 'wired.jp',
  'yahoo.co.jp', 'news.yahoo.co.jp', 'chiebukuro.yahoo.co.jp', 'quora.jp',
  // 求人・フリーランス案件・セミナー
  'techplay.jp', 'connpass.com', 'levtech.jp', 'techbiz.com', 'freelance-start.com',
  'midworks.com', 'geechs-job.com', 'pe-bank.jp', 'wantedly.com', 'green-japan.com',
  'doda.jp', 'rikunabi.com', 'mynavi.jp', 'en-japan.com', 'type.jp',
  'crowdworks.jp', 'lancers.jp', 'coconala.com',
  'udemy.com', 'coursera.org',
];

// 除外キーワード（タイトルに含まれていたらスキップ）
const BLOCKED_KEYWORDS = [
  '求人', '採用', '募集', '未経験', '年収', '案件', 'フリーランス',
  'セミナー', 'イベント', '勉強会', 'ウェビナー',
  'コース', '講座', 'レッスン',
];

/**
 * URLが除外対象のドメインに一致するか判定します。
 */
const shouldSkipResult = (url) => {
  if (!url) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
    );
  } catch {
    return true;
  }
};

/**
 * タイトルに除外キーワードが含まれているか判定します。
 * ただし、元の検索キーワードにその単語が含まれている場合は除外しません。
 */
const hasBlockedKeyword = (title, searchKeyword) => {
  if (!title) return false;
  const lowerTitle = title.toLowerCase();
  const lowerKeyword = (searchKeyword || '').toLowerCase();

  return BLOCKED_KEYWORDS.some((blocked) => {
    // 検索キーワード自体にその単語が含まれているならOK（例：「AI セミナー」で検索した場合）
    if (lowerKeyword.includes(blocked)) return false;
    return lowerTitle.includes(blocked);
  });
};

/**
 * Google検索結果から公開日時を推定し、新鮮さをチェックします。
 */
const isFreshEnough = (item) => {
  const freshnessDays = SEARCH_FRESHNESS_DAYS || 0;
  if (!freshnessDays || freshnessDays <= 0) return true;
  const cutoff = Date.now() - freshnessDays * 24 * 60 * 60 * 1000;

  const metaTags = item?.pagemap?.metatags;
  if (Array.isArray(metaTags) && metaTags.length > 0) {
    const meta = metaTags[0] || {};
    const candidates = [
      meta['article:published_time'],
      meta['og:updated_time'],
      meta['date'],
      meta['last-modified'],
    ].filter(Boolean);
    for (const value of candidates) {
      const parsed = new Date(value).getTime();
      if (!Number.isNaN(parsed)) {
        return parsed >= cutoff;
      }
    }
  }
  return true;
};

/**
 * LLMを使って検索クエリを生成します。
 */
const generateSearchQueries = async (keyword, apiKey) => {
  try {
    const messages = [
      { role: 'system', content: QUERY_GENERATION_PROMPT.system },
      { role: 'user', content: QUERY_GENERATION_PROMPT.user(keyword) },
    ];

    const completion = await callOpenAI({
      apiKey,
      messages,
      model: QUERY_GENERATION.model,
      fallbackModel: QUERY_GENERATION.fallbackModel,
      temperature: QUERY_GENERATION.temperature,
      responseFormat: QUERY_GENERATION.response_format,
    });

    const result = parseJsonContent(completion?.choices?.[0]?.message?.content);
    let queries = result?.queries || [];

    // 元のキーワードも必ず含める
    if (!queries.includes(keyword)) {
      queries.unshift(keyword);
    }

    // ノイズ除去キーワードを付与
    const negatives = '-求人 -採用 -募集 -セミナー -イベント -まとめ';
    return queries.map(q => `${q} ${negatives}`);

  } catch (error) {
    logger.warn(`[クエリ生成失敗] ${error.message} -> フォールバッククエリを使用`);
    return [`${keyword} 技術 解説 -求人 -セミナー`, `${keyword} 使い方 -求人 -セミナー`];
  }
};

/**
 * 複数のクエリでGoogle検索を実行し、結果を統合します。
 */
const performMultiQuerySearch = async (queries, googleApiKey, googleCx) => {
  const allResults = [];
  const seenUrls = new Set();

  // 並列実行（レート制限に注意しつつ）
  for (const query of queries) {
    try {
      logger.info(`[Google検索] クエリ実行: "${query}"`);
      const res = await searchTopArticles({
        apiKey: googleApiKey,
        cx: googleCx,
        query,
        num: 5, // 各クエリで5件取得
      });

      const items = Array.isArray(res.items) ? res.items : [];
      for (const item of items) {
        if (!seenUrls.has(item.link)) {
          seenUrls.add(item.link);
          allResults.push(item);
        }
      }
      await sleep(1000); // API制限回避のウェイト
    } catch (error) {
      logger.warn(`[Google検索エラー] クエリ: "${query}" -> ${error.message}`);
    }
  }

  return allResults;
};

/**
 * 検索結果を取得・フィルタリング・要約します。
 */
const fetchSearchSummaries = async (keyword, googleApiKey, googleCx, openaiApiKey) => {
  if (!keyword || !googleApiKey || !googleCx) return [];

  try {
    // 1. クエリ生成
    const queries = await generateSearchQueries(keyword, openaiApiKey);
    logger.info(`[クエリ生成] ${queries.length}件: ${JSON.stringify(queries)}`);

    // 2. 検索実行
    let items = await performMultiQuerySearch(queries, googleApiKey, googleCx);
    logger.info(`[Google検索] 結果総数: ${items.length}件`);

    // 3. フィルタリング
    const beforeFilter = items.length;
    items = items.filter((item) => {
      if (!isFreshEnough(item)) return false;
      if (shouldSkipResult(item.link)) return false;
      if (hasBlockedKeyword(item.title, keyword)) return false;
      return true;
    });
    logger.info(`[フィルタリング] ${beforeFilter} -> ${items.length}件 (除外: ${beforeFilter - items.length}件)`);

    // 4. 要約生成（最大5件まで）
    const targetItems = items.slice(0, 5);
    logger.info(`[処理対象] 上位${targetItems.length}件を要約します`);

    const summaries = [];
    for (const [index, item] of targetItems.entries()) {
      try {
        logger.info(`[要約] (${index + 1}/${targetItems.length}) ${item.title}`);
        const summaryEntry = await summarizeSearchResult(item, index, openaiApiKey);

        // 品質の低い要約（スニペットのみなど）は、他に候補があれば除外したいが、
        // 候補が少ない場合は採用する。ここではとりあえず全て追加し、後で選別も可能。
        if (summaryEntry.quality === 'high' || summaries.length < MIN_SUMMARIES) {
          summaries.push(summaryEntry);
        }
      } catch (error) {
        logger.warn(`[要約失敗] ${item.link}: ${error.message}`);
      }
      await sleep(RATE_LIMITS.SEARCH_RESULT_WAIT_MS);
    }

    return summaries;

  } catch (error) {
    logger.warn(`[Researcherエラー] ${error.message}`);
    return [];
  }
};

/**
 * Researcherのメイン処理
 */
const runResearcher = async ({ keyword }) => {
  if (!keyword) throw new Error('keyword パラメータは必須です。');

  logger.info('=== Researcher 開始 ===');
  logger.info(`検索キーワード: "${keyword}"`);

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;

  if (!openaiApiKey || !googleApiKey || !googleCx) {
    throw new Error('必要なAPIキー環境変数が設定されていません。');
  }

  const stopTimer = metricsTracker.startTimer('googleSearch.timeMs');
  let summaries = [];

  try {
    summaries = await fetchSearchSummaries(keyword, googleApiKey, googleCx, openaiApiKey);
    const elapsed = stopTimer();
    metricsTracker.increment('googleSearch.success');
    metricsTracker.increment('googleSearch.totalResults', summaries.length);
    logger.info(`[Google検索] 完了: ${summaries.length}件の要約を取得 (${elapsed}ms)`);
  } catch (error) {
    const elapsed = stopTimer();
    metricsTracker.increment('googleSearch.failure');
    logger.error(`[Google検索] 失敗 (${elapsed}ms): ${error.message}`);
  }

  // 成果物の保存
  ensureDir(outputDir);
  const timestamp = new Date().toISOString();
  const outputData = {
    timestamp,
    keyword,
    summariesCount: summaries.length,
    summaries,
    metrics: metricsTracker.summary(),
  };

  const outputPath = path.join(outputDir, `researcher-${timestamp.split('T')[0]}.json`);
  writeJson(outputPath, outputData);
  logger.info(`成果物を保存: ${outputPath}`);

  return { keyword, summaries };
};

// スクリプト直接実行
if (require.main === module) {
  const { parseArgs } = require('util');
  const options = { keyword: { type: 'string', short: 'k' } };
  let keyword;
  try {
    const parsed = parseArgs({ options, strict: false });
    keyword = parsed.values.keyword;
  } catch (e) { /* ignore */ }

  // フォールバック
  if (!keyword) {
    const argv = process.argv.slice(2);
    const idx = argv.findIndex(a => a === '--keyword' || a === '-k');
    if (idx !== -1) keyword = argv[idx + 1];
    else if (argv[0] && !argv[0].startsWith('-')) keyword = argv[0];
  }

  if (!keyword) {
    console.error('使用方法: node researcher/index.js --keyword "検索キーワード"');
    process.exit(1);
  }

  runResearcher({ keyword })
    .then((result) => console.log('Researcher finished:', JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error('Researcher failed:', error);
      process.exit(1);
    });
}

module.exports = { runResearcher };
