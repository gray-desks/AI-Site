#!/usr/bin/env node
/**
 * @fileoverview Collector: 記事候補の収集ステージ
 * - 登録されたYouTubeチャンネルから、YouTube Data API v3 を使って最新の動画を取得します。
 * - ブログ記事になりそうな動画を候補（candidate）として `data/candidates.json` に保存します。
 * - このステージでは、キーワード抽出やGoogle検索は行いません（Researcherステージが担当）。
 */

const path = require('path');
const fs = require('fs');
const { readJson, writeJson, ensureDir } = require('../lib/io');
const slugify = require('../lib/slugify');
const { COLLECTOR, RATE_LIMITS } = require('../config/constants');
const { YOUTUBE_API_BASE } = require('../config/models');
const { readCandidates, writeCandidates } = require('../lib/candidatesRepository');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker } = require('../lib/metrics');
const { extractSearchKeywords } = require('../lib/extractKeywords');

// --- パス設定 ---
// プロジェクトのルートディレクトリを取得
const root = path.resolve(__dirname, '..', '..');
// 監視対象のYouTubeチャンネルリストのパス
const sourcesPath = path.join(root, 'data', 'sources.json');
// 実行結果の出力先ディレクトリのパス
const outputDir = path.join(root, 'automation', 'output', 'collector');
// キーワードキュー
const keywordsPath = path.join(root, 'data', 'keywords.json');
const postsDir = path.join(root, 'posts');

// --- 定数設定 ---
const { MAX_PER_CHANNEL, VIDEO_LOOKBACK_DAYS, SEARCH_PAGE_SIZE, CLEANUP_PROCESSED_DAYS, MAX_PENDING_CANDIDATES } = COLLECTOR;
// ロガーとメトリクス追跡ツールを初期化
const logger = createLogger('collector');
const metricsTracker = createMetricsTracker('collector');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * キーワード文字列をGoogle検索向けにサニタイズします。
 *  - 余計な引用符や読点を除去
 *  - 連続スペースを1つに圧縮
 *  - 末尾の読点・省略記号を除去
 *  - 80文字にトリム
 */
const sanitizeKeyword = (value) => {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/["“”'「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[、。…]+$/g, '')
    .trim()
    .slice(0, 80);
};

/**
 * YouTube動画タイトル/説明からGoogle検索向けのクエリを生成します。
 * OpenAIが使えない・失敗した場合はタイトルをサニタイズして返します。
 */
const buildSearchKeyword = async (video, openaiApiKey) => {
  const base = sanitizeKeyword(video?.title || '');
  if (!base) return '';

  if (!openaiApiKey) {
    metricsTracker.increment('keywords.extraction.skipped');
    return base;
  }

  const stopTimer = metricsTracker.startTimer('keywords.extraction.timeMs');

  try {
    const extracted = await extractSearchKeywords(
      openaiApiKey,
      video.title,
      video.description || '',
    );
    const cleaned = sanitizeKeyword(extracted);
    const elapsed = stopTimer();

    if (cleaned) {
      metricsTracker.increment('keywords.extraction.success');
      logger.info(`[keyword] 抽出: "${cleaned}" <= ${base} (${elapsed}ms)`);
      await sleep(RATE_LIMITS.KEYWORD_EXTRACTION_WAIT_MS);
      return cleaned;
    }

    metricsTracker.increment('keywords.extraction.empty');
    logger.warn(`[keyword] 抽出結果が空のためタイトルを使用: "${base}"`);
  } catch (error) {
    const elapsed = stopTimer();
    metricsTracker.increment('keywords.extraction.failure');
    logger.warn(`[keyword] 抽出失敗 (${elapsed}ms): ${error.message} / fallback: "${base}"`);
  }

  await sleep(RATE_LIMITS.KEYWORD_EXTRACTION_WAIT_MS);
  return base;
};

/**
 * チャンネルIDからYouTubeチャンネルのURLを生成します。
 * @param {string} channelId - YouTubeチャンネルID
 * @returns {string|null} チャンネルURLまたはnull
 */
const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : null;

/**
 * 既存記事のスラグ一覧を取得します。
 * ファイル名の日付プレフィックスを除去してスラグ化します。
 */
const getExistingArticleSlugs = () => {
  if (!fs.existsSync(postsDir)) return new Set();
  const files = fs.readdirSync(postsDir, { withFileTypes: true });
  const slugs = files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html') && entry.name !== 'article-template.html')
    .map((entry) => entry.name.replace(/\.html$/, ''))
    .map((name) => name.replace(/^\d{4}-\d{2}-\d{2}-/, ''))
    .map((name) => slugify(name, 'article'))
    .filter(Boolean);
  return new Set(slugs);
};

/**
 * 収集したキーワードをキューに追加し、重複や既存記事と被るものを除外します。
 * @param {Array<string>} keywords - 追加するキーワード配列
 * @returns {{added: number, total: number}} 追加数とキュー全体の件数
 */
const enqueueKeywords = (keywords) => {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    const existingQueue = readJson(keywordsPath, []);
    return { added: 0, total: Array.isArray(existingQueue) ? existingQueue.length : 0 };
  }

  let queue = readJson(keywordsPath, []);
  if (!Array.isArray(queue)) queue = [];

  const existingSlugs = new Set(queue.map((k) => slugify(k, 'keyword')));
  const articleSlugs = getExistingArticleSlugs();
  let added = 0;

  for (const keyword of keywords) {
    if (!keyword || typeof keyword !== 'string') continue;
    const slug = slugify(keyword, 'keyword');
    if (!slug || existingSlugs.has(slug) || articleSlugs.has(slug)) continue;
    queue.push(keyword);
    existingSlugs.add(slug);
    added += 1;
  }

  writeJson(keywordsPath, queue);
  return { added, total: queue.length };
};

/**
 * 動画の公開日時が指定された期間内（VIDEO_LOOKBACK_DAYS）であるか判定します。
 * @param {string} publishedAt - 動画の公開日時 (ISO 8601形式)
 * @returns {boolean} 期間内であればtrue
 */
const withinWindow = (publishedAt) => {
  if (!publishedAt) return false;
  const publishedTime = new Date(publishedAt).getTime();
  // 日付が無効な場合はfalseを返す
  if (Number.isNaN(publishedTime)) return false;
  // 現在時刻と公開日時の差分（ミリ秒）を計算
  const ageMs = Date.now() - publishedTime;
  // 検索対象期間をミリ秒に変換
  const windowMs = VIDEO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  // 差分が期間内であればtrueを返す
  return ageMs <= windowMs;
};

/**
 * `sources.json` から読み込んだソース情報の形式を正規化します。
 * @param {object} source - ソース情報
 * @returns {object} 正規化されたソース情報
 */
const normalizeSource = (source) => {
  const channelId = source.channelId || null;
  // URLが未定義の場合、チャンネルIDからURLを生成
  const baseUrl = source.url || createChannelUrl(channelId);
  return {
    platform: source.platform || 'YouTube',
    name: source.name || 'Unknown Channel',
    channelId,
    url: baseUrl || createChannelUrl(channelId),
    focus: Array.isArray(source.focus) ? source.focus : [],
  };
};

/**
 * YouTube APIのレスポンスから動画情報を抽出し、必要な形式に変換します。
 * @param {object} item - YouTube APIの検索結果アイテム
 * @returns {object|null} 変換後の動画情報またはnull
 */
const mapSnippetToVideo = (item) => {
  const snippet = item.snippet;
  const videoId = item.id?.videoId;
  // スニペットまたはvideoIdが存在しない場合はnullを返す
  if (!snippet || !videoId) return null;
  return {
    id: videoId,
    title: snippet.title ?? 'Untitled',
    description: snippet.description ?? '',
    // 利用可能な最大解像度のサムネイルURLを取得
    thumbnail:
      snippet.thumbnails?.maxres?.url ||
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      null,
    publishedAt: snippet.publishedAt,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
};

/**
 * 指定されたチャンネルIDの最新動画をYouTube Data APIで取得します。
 * @param {string} channelId - YouTubeチャンネルID
 * @param {string} apiKey - YouTube Data APIキー
 * @returns {Promise<Array|null>} 動画情報の配列、またはAPI制限の場合はnull
 */
const fetchChannelVideos = async (channelId, apiKey) => {
  // 検索対象とする最も古い日時を計算 (ISO 8601形式)
  const publishedAfter = new Date(Date.now() - VIDEO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('.')[0] + 'Z';
  // APIリクエストのパラメータを設定
  const params = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    channelId,
    order: 'date',
    type: 'video',
    maxResults: `${SEARCH_PAGE_SIZE}`,
    publishedAfter,
  });
  // YouTube Data APIにリクエストを送信
  const response = await fetch(`${YOUTUBE_API_BASE}/search?${params.toString()}`);
  if (!response.ok) {
    const errorText = await response.text();
    let quotaExceeded = false;
    let errorMessage = errorText.slice(0, 200);
    try {
      const errorPayload = JSON.parse(errorText);
      errorMessage = errorPayload?.error?.message || errorMessage;
      const reasons = errorPayload?.error?.errors;
      // エラー理由が 'quotaExceeded' かどうかを判定
      quotaExceeded = Array.isArray(reasons) && reasons.some((entry) => entry.reason === 'quotaExceeded');
    } catch {
      // JSONパースエラーは無視し、テキストをそのまま使用
    }
    // APIの利用割り当てを超過した場合は警告を出し、nullを返す
    if (response.status === 403 && quotaExceeded) {
      logger.warn(`quota exceeded: スキップします (channel=${channelId})`);
      return null;
    }
    // その他のAPIエラーの場合は例外をスロー
    throw new Error(`YouTube API error ${response.status}: ${errorMessage}`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];
  // 取得した動画情報を整形して返す
  return items
    .map((item) => mapSnippetToVideo(item))
    .filter((video) => Boolean(video)); // 不正なデータをフィルタリング
};

/**
 * Collectorステージのメイン処理
 */
const runCollector = async () => {
  logger.info('ステージ開始: YouTube Data APIで最新動画を取得します。');

  // 環境変数からYouTube APIキーを取得
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    logger.warn('OPENAI_API_KEY が設定されていないため、検索キーワード最適化をスキップしタイトルを使用します。');
  }

  // 監視対象のソースと既存の候補リストを読み込み
  const sources = readJson(sourcesPath, []);
  const existingCandidates = readCandidates();

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('data/sources.json に監視対象が設定されていません。');
  }

  let updatedCandidates = [...existingCandidates];
  const errors = [];
  let newCandidatesCount = 0;
  const newKeywords = [];

  // 各ソース（チャンネル）に対して処理を実行
  for (const [index, source] of sources.entries()) {
    const normalizedSource = normalizeSource(source);
    logger.info(`(${index + 1}/${sources.length}) ${normalizedSource.name} の最新動画を取得します`);

    if (!normalizedSource.channelId) {
      logger.warn(`${normalizedSource.name}: channelId が設定されていないためスキップします。`);
      errors.push({
        source: normalizedSource.name,
        message: 'channelId is missing',
      });
      continue;
    }

    try {
      // チャンネルの動画を取得
      const videos = await fetchChannelVideos(normalizedSource.channelId, apiKey);
      // API制限などでスキップされた場合
      if (!Array.isArray(videos)) {
        logger.warn(`${normalizedSource.name}: YouTube API制限によりこのチャンネルの処理をスキップしました。`);
        continue;
      }
      // 期間内でフィルタリングし、新しい順にソート
      const freshVideos = videos
        .filter((video) => withinWindow(video.publishedAt))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      logger.info(
        `${normalizedSource.name}: API取得 ${videos.length}件 / フィルタ後 ${freshVideos.length}件`,
      );

      metricsTracker.increment('videos.total', freshVideos.length);

      let addedForChannel = 0;
      for (const video of freshVideos) {
        // 1チャンネルあたりの最大追加数を超えたらループを抜ける
        if (addedForChannel >= MAX_PER_CHANNEL) break;
        const candidateId = `yt-${video.id}`;
        // 既に候補リストに存在するかチェック
        const alreadyExists = updatedCandidates.some((candidate) => candidate.id === candidateId);

        if (alreadyExists) {
          metricsTracker.increment('videos.duplicates');
          continue; // 存在する場合はスキップ
        }

        const now = new Date().toISOString();
        // 動画タイトルからトピックキーを生成
        const topicKey = slugify(video.title);

        // 新しい候補オブジェクトを作成
        updatedCandidates.push({
          id: candidateId,
          source: normalizedSource,
          video: {
            id: video.id,
            title: video.title,
            url: video.url,
            description: video.description,
            thumbnail: video.thumbnail,
            publishedAt: video.publishedAt,
          },
          status: 'collected', // ステータスを 'collected' に設定
          createdAt: now,
          updatedAt: now,
          topicKey,
          notes: `YouTube Data API: ${normalizedSource.name} の最新動画`,
        });

        newCandidatesCount += 1;
        addedForChannel += 1;
        metricsTracker.increment('videos.new');

        logger.info(
          `新規候補を追加: ${normalizedSource.name} / ${video.title} (candidateId: ${candidateId})`,
        );

        // 検索キーワード候補としてGoogle検索最適化済みのクエリを追加（後で重複除外）
        const searchKeyword = await buildSearchKeyword(video, openaiApiKey);
        if (searchKeyword) {
          newKeywords.push(searchKeyword);
        }
      }

      if (addedForChannel === 0) {
        logger.info(`${normalizedSource.name}: 新規候補はありませんでした。`);
      }
    } catch (error) {
      logger.warn(`${normalizedSource.name} でエラー: ${error.message}`);
      errors.push({
        source: normalizedSource.name,
        message: error.message,
      });
    }
  }

  // 候補リストを動画の公開日時順（降順）にソート
  updatedCandidates.sort((a, b) => {
    const aTime = new Date(a.video?.publishedAt || 0).getTime();
    const bTime = new Date(b.video?.publishedAt || 0).getTime();
    return bTime - aTime;
  });

  // --- クリーンアップ処理 ---
  // 1. 古い処理済み候補を削除
  const now = Date.now();
  // 削除対象となる日時の閾値を計算
  const cleanupCutoff = now - CLEANUP_PROCESSED_DAYS * 24 * 60 * 60 * 1000;
  const beforeCleanup = updatedCandidates.length;

  updatedCandidates = updatedCandidates.filter((candidate) => {
    // 'collected' または 'researched' 状態の候補は常に保持
    if (candidate.status === 'collected' || candidate.status === 'researched') {
      return true;
    }
    // それ以外のステータスの候補は、最終更新日時が指定期間内であれば保持
    const updatedTime = new Date(candidate.updatedAt || candidate.createdAt).getTime();
    return !Number.isNaN(updatedTime) && updatedTime >= cleanupCutoff;
  });

  const cleanedCount = beforeCleanup - updatedCandidates.length;
  if (cleanedCount > 0) {
    logger.info(`処理済み候補を${cleanedCount}件削除しました（${CLEANUP_PROCESSED_DAYS}日以上経過）。`);
  }

  // 2. 未処理（collected + researched）の候補が多すぎる場合に古いものから削除
  const activeCandidates = updatedCandidates.filter((c) =>
    c.status === 'collected' || c.status === 'researched'
  );
  const processedCandidates = updatedCandidates.filter((c) =>
    c.status !== 'collected' && c.status !== 'researched'
  );

  // アクティブな候補が上限を超えている場合
  if (activeCandidates.length > MAX_PENDING_CANDIDATES) {
    const beforeLimit = activeCandidates.length;
    // 作成日時が新しい順にソートし、上限数までを保持
    const limitedActive = activeCandidates
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, MAX_PENDING_CANDIDATES);
    // 処理済み候補と制限後のアクティブ候補を結合
    updatedCandidates = [...processedCandidates, ...limitedActive];
    // 再度、動画の公開日時でソート
    updatedCandidates.sort((a, b) => {
      const aTime = new Date(a.video?.publishedAt || 0).getTime();
      const bTime = new Date(b.video?.publishedAt || 0).getTime();
      return bTime - aTime;
    });
    const limitedCount = beforeLimit - limitedActive.length;
    logger.info(`active候補を${limitedCount}件削除しました（上限${MAX_PENDING_CANDIDATES}件を超過）。`);
  }

  // 更新された候補リストをファイルに書き込み
  writeCandidates(updatedCandidates);

  // --- 成果物の保存 ---
  ensureDir(outputDir); // 出力ディレクトリがなければ作成
  const timestamp = new Date().toISOString();
  // メトリクスのサマリーを作成
  const metricsSummary = {
    totalVideosFound: metricsTracker.getCounter('videos.total'),
    newVideosAdded: metricsTracker.getCounter('videos.new'),
    duplicatesSkipped: metricsTracker.getCounter('videos.duplicates'),
  };

  // キーワードキューを更新（新規候補の動画タイトルを利用）
  const keywordQueueResult = enqueueKeywords(newKeywords);
  logger.info(
    `[keyword-queue] 新規${keywordQueueResult.added}件を追加 / キュー総数 ${keywordQueueResult.total}件`,
  );

  // 出力データを作成
  const outputData = {
    timestamp,
    checkedSources: sources.length,
    newCandidates: newCandidatesCount,
    totalCandidates: updatedCandidates.length,
    metrics: metricsSummary,
    errors,
    keywordQueue: {
      added: keywordQueueResult.added,
      total: keywordQueueResult.total,
    },
    // 直近1時間で追加された新規動画のリスト
    newVideos: updatedCandidates
      .filter((c) => c.status === 'collected' && new Date(c.createdAt).getTime() > Date.now() - 3600000) 
      .map((c) => ({
        id: c.id,
        videoTitle: c.video.title,
        videoUrl: c.video.url,
        source: c.source.name,
        publishedAt: c.video.publishedAt,
      })),
  };

  // 成果物をJSONファイルとして保存
  const outputPath = path.join(outputDir, `collector-${timestamp.split('T')[0]}.json`);
  writeJson(outputPath, outputData);
  logger.info(`成果物を保存しました: ${outputPath}`);

  // --- メトリクスサマリーの表示 ---
  logger.info('\n=== Collector メトリクスサマリー ===');
  logger.info(`チェックしたソース: ${sources.length}件`);
  logger.info(`発見した動画: ${metricsSummary.totalVideosFound}件`);
  logger.info(`新規追加: ${metricsSummary.newVideosAdded}件`);
  logger.info(`重複スキップ: ${metricsSummary.duplicatesSkipped}件`);
  logger.info(`総候補数: ${updatedCandidates.length}件`);

  if (errors.length > 0) {
    logger.warn(`\n⚠️  警告: ${errors.length}件のソースでエラーが発生しました`);
    errors.forEach((err) => {
      logger.warn(`  - ${err.source}: ${err.message}`);
    });
  }

  if (newCandidatesCount === 0) {
    logger.info('\n今回は新規候補がありませんでした。');
  }

  logger.success(`\n完了: 新規${newCandidatesCount}件 / 総候補${updatedCandidates.length}件`);

  // パイプラインの次のステージに渡す結果オブジェクト
  return {
    source: 'YouTube',
    checkedSources: sources.length,
    newCandidates: newCandidatesCount,
    totalCandidates: updatedCandidates.length,
    keywordsAdded: keywordQueueResult.added,
    keywordQueueSize: keywordQueueResult.total,
    errors,
    metrics: metricsSummary,
  };
};

// スクリプトが直接実行された場合にrunCollectorを実行
if (require.main === module) {
  runCollector()
    .then((result) => {
      logger.info('Collector finished:', result);
    })
    .catch((error) => {
      logger.error('Collector failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runCollector,
};
