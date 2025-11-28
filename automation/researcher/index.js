#!/usr/bin/env node
/**
 * @fileoverview Researcher: YouTube動画ベースのネタ選定＆リサーチ
 * - 登録済みチャンネルの未処理動画を公開日時順に横断取得
 * - Video ID重複を1次フィルタとしてスキップ
 * - 直近記事タイトルを使ったAIテーマ重複判定を実施（2次フィルタ）
 * - 字幕を取得し、Generatorがそのまま記事化に使える形で返却
 */

const path = require('path');
const { ensureDir, writeJson, readJson } = require('../lib/io');
const { readCandidates, writeCandidates } = require('../lib/candidatesRepository');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker } = require('../lib/metrics');
const { RESEARCHER, RATE_LIMITS } = require('../config/constants');
const { THEME_DEDUPLICATION } = require('../config/models');
const THEME_DEDUP_PROMPT = require('../prompts/themeDeduplication');
const { callOpenAI } = require('../lib/openai');
const { fetchTranscriptText } = require('./services/transcriptFetcher');
const { readProcessedVideos } = require('../lib/processedVideos');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, 'automation', 'output', 'researcher');
const postsJsonPath = path.join(root, 'data', 'posts.json');

// --- 初期化 ---
const logger = createLogger('researcher');
const metricsTracker = createMetricsTracker('researcher');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 直近の記事タイトルを降順で取得します。
 * @param {number} limit
 * @returns {Array<string>}
 */
const getRecentPostTitles = (limit) => {
  const posts = readJson(postsJsonPath, []);
  if (!Array.isArray(posts) || posts.length === 0) return [];
  const sorted = [...posts].sort(
    (a, b) => new Date(b.publishedAt || b.date || 0) - new Date(a.publishedAt || a.date || 0),
  );
  return sorted.slice(0, limit).map((p) => p.title).filter(Boolean);
};

/**
 * candidates.jsonから処理対象の候補を抽出し、新しい順に並べます。
 * @param {Set<string>} processedIds
 * @returns {Array<object>}
 */
const getEligibleCandidates = (processedIds) => {
  const candidates = readCandidates();
  if (!Array.isArray(candidates)) return [];

  const eligible = candidates.filter(
    (item) => item.status === 'collected' && item.video?.id && !processedIds.has(item.video.id),
  );

  return eligible.sort(
    (a, b) =>
      new Date(b.video?.publishedAt || b.createdAt || 0) - new Date(a.video?.publishedAt || a.createdAt || 0),
  );
};

/**
 * candidates.json内の特定候補を更新します。
 * @param {string} id
 * @param {Function|object} updater
 * @returns {{nextCandidates: Array<object>, updated: object|null}}
 */
const updateCandidate = (id, updater) => {
  const candidates = readCandidates();
  const next = candidates.map((item) => {
    if (item.id !== id) return item;
    const patch = typeof updater === 'function' ? updater(item) : { ...updater };
    return { ...item, ...patch };
  });
  writeCandidates(next);
  const updated = next.find((item) => item.id === id) || null;
  return { nextCandidates: next, updated };
};

/**
 * AIでテーマ重複を判定します。
 * @param {string} videoTitle
 * @param {Array<string>} recentTitles
 * @param {string} apiKey
 * @returns {Promise<{duplicate: boolean, reason: string, matchedTitle: string|null, raw: object|null}>}
 */
const judgeThemeDuplicate = async (videoTitle, recentTitles, apiKey) => {
  if (!videoTitle) {
    return { duplicate: false, reason: 'タイトルなし', matchedTitle: null, raw: null };
  }
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。');
  }
  if (!Array.isArray(recentTitles) || recentTitles.length === 0) {
    return { duplicate: false, reason: '直近記事なし', matchedTitle: null, raw: null };
  }

  try {
    const messages = [
      { role: 'system', content: THEME_DEDUP_PROMPT.system },
      { role: 'user', content: THEME_DEDUP_PROMPT.user(videoTitle, recentTitles) },
    ];
    const completion = await callOpenAI({
      apiKey,
      messages,
      model: THEME_DEDUPLICATION.model,
      fallbackModel: THEME_DEDUPLICATION.fallbackModel,
      temperature: THEME_DEDUPLICATION.temperature,
      responseFormat: THEME_DEDUPLICATION.response_format,
    });
    const content = completion?.choices?.[0]?.message?.content;
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    const duplicate = parsed?.duplicate === true;
    const reason = parsed?.reason || (duplicate ? '重複と判定' : '非重複と判定');
    const matchedTitle = parsed?.matchedTitle || null;
    return { duplicate, reason, matchedTitle, raw: parsed };
  } catch (error) {
    logger.warn(`[theme-check] 判定に失敗しました（保守的に重複扱い）: ${error.message}`);
    return { duplicate: true, reason: `判定失敗: ${error.message}`, matchedTitle: null, raw: null };
  }
};

/**
 * 字幕テキストをプロンプト向けに整形・トリムします。
 * @param {string|null} transcript
 * @returns {string|null}
 */
const normalizeTranscript = (transcript) => {
  if (!transcript) return null;
  const compact = transcript.replace(/\s+/g, ' ').trim();
  if (compact.length < RESEARCHER.TRANSCRIPT_MIN_CHARS) return null;
  if (compact.length > RESEARCHER.TRANSCRIPT_MAX_LENGTH) {
    return `${compact.slice(0, RESEARCHER.TRANSCRIPT_MAX_LENGTH)}...`;
  }
  return compact;
};

/**
 * Researcherのメイン処理
 * @param {object} [options]
 * @param {string} [options.candidateId] - 明示的に処理したい候補ID
 * @returns {Promise<object>}
 */
const runResearcher = async ({ candidateId } = {}) => {
  logger.info('=== Researcher 開始: YouTube動画からネタを選定します ===');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。');
  }

  const recentTitles = getRecentPostTitles(RESEARCHER.RECENT_POST_LIMIT);
  const processedIds = new Set(readProcessedVideos().map((item) => item.videoId));
  const eligible = getEligibleCandidates(processedIds).filter((item) =>
    candidateId ? item.id === candidateId : true,
  );

  if (eligible.length === 0) {
    logger.info('未処理の候補動画がありません。');
    return {
      status: 'no-candidates',
      candidate: null,
      skipped: [],
      recentTitles,
    };
  }

  logger.info(`処理候補: ${eligible.length}件（最新順）。動画ID重複の一次フィルタを適用します。`);

  const skipped = [];
  let chosen = null;

  for (const [index, candidate] of eligible.entries()) {
    metricsTracker.increment('candidates.checked');
    logger.info(`(${index + 1}/${eligible.length}) ${candidate.video.title}`);

    const videoId = candidate.video?.id;
    if (!videoId) {
      skipped.push({ id: candidate.id, reason: 'video-id-missing' });
      continue;
    }

    if (processedIds.has(videoId)) {
      logger.info(`→ Video ID重複のためスキップ: ${videoId}`);
      metricsTracker.increment('candidates.skipped.videoId');
      const { updated } = updateCandidate(candidate.id, {
        status: 'skipped',
        skipReason: 'video-id-duplicate',
        updatedAt: new Date().toISOString(),
      });
      skipped.push({ id: candidate.id, reason: 'video-id-duplicate', candidate: updated });
      continue;
    }

    // --- AIテーマ重複チェック ---
    const themeCheck = await judgeThemeDuplicate(candidate.video.title, recentTitles, apiKey);
    logger.info(
      `→ テーマ重複判定: ${themeCheck.duplicate ? '重複あり' : '重複なし'} (${themeCheck.reason})`,
    );

    if (themeCheck.duplicate) {
      metricsTracker.increment('candidates.skipped.theme');
      const { updated } = updateCandidate(candidate.id, {
        status: 'skipped',
        skipReason: 'theme-duplicate',
        skipDetail: themeCheck.reason,
        updatedAt: new Date().toISOString(),
      });
      skipped.push({
        id: candidate.id,
        reason: 'theme-duplicate',
        detail: themeCheck.reason,
        matchedTitle: themeCheck.matchedTitle || null,
        candidate: updated,
      });
      await sleep(RATE_LIMITS.THEME_DEDUP_WAIT_MS);
      continue;
    }

    // --- 字幕取得 ---
    const rawTranscript = await fetchTranscriptText(videoId);
    const transcript = normalizeTranscript(rawTranscript);
    if (!transcript) {
      logger.warn('字幕が取得できないためスキップします。');
      metricsTracker.increment('candidates.skipped.transcript');
      const { updated } = updateCandidate(candidate.id, {
        status: 'skipped',
        skipReason: 'transcript-unavailable',
        updatedAt: new Date().toISOString(),
      });
      skipped.push({ id: candidate.id, reason: 'transcript-unavailable', candidate: updated });
      continue;
    }

    // 採用決定
    const now = new Date().toISOString();
    const { updated } = updateCandidate(candidate.id, {
      status: 'researched',
      transcript,
      transcriptLength: transcript.length,
      themeCheck,
      recentTitles,
      researchedAt: now,
      updatedAt: now,
    });
    chosen = updated;
    metricsTracker.increment('candidates.selected');
    break;
  }

  // 成果物の保存
  ensureDir(outputDir);
  const timestamp = new Date().toISOString();
  const outputData = {
    timestamp,
    status: chosen ? 'researched' : 'skipped-all',
    candidateId: chosen?.id || null,
    skipped,
    metrics: metricsTracker.summary(),
  };
  const outputPath = path.join(outputDir, `researcher-${timestamp.split('T')[0]}.json`);
  writeJson(outputPath, outputData);
  logger.info(`成果物を保存: ${outputPath}`);

  return {
    status: chosen ? 'researched' : 'skipped',
    candidate: chosen,
    skipped,
    recentTitles,
  };
};

// スクリプト直接実行
if (require.main === module) {
  const { parseArgs } = require('util');
  const options = { candidate: { type: 'string', short: 'c' } };
  let candidateId;
  try {
    const parsed = parseArgs({ options, strict: false });
    candidateId = parsed.values.candidate;
  } catch (e) {
    // ignore
  }

  runResearcher({ candidateId })
    .then((result) => console.log('Researcher finished:', JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error('Researcher failed:', error);
      process.exit(1);
    });
}

module.exports = { runResearcher };
