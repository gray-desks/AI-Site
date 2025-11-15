#!/usr/bin/env node
/**
 * Collector
 * - Fetches latest YouTube videos from registered sources via YouTube Data API v3.
 * - Stores blog-worthy candidates into data/candidates.json for generator stage.
 */

const path = require('path');
const { readJson, writeJson, ensureDir } = require('../lib/io');
const slugify = require('../lib/slugify');

const root = path.resolve(__dirname, '..', '..');
const sourcesPath = path.join(root, 'data', 'sources.json');
const candidatesPath = path.join(root, 'data', 'candidates.json');

const MAX_PER_CHANNEL = 2;
const VIDEO_LOOKBACK_DAYS = 7;
const SEARCH_PAGE_SIZE = 10;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : null;

const withinWindow = (publishedAt) => {
  if (!publishedAt) return false;
  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) return false;
  const ageMs = Date.now() - publishedTime;
  const windowMs = VIDEO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return ageMs <= windowMs;
};

const normalizeSource = (source) => {
  const channelId = source.channelId || null;
  const baseUrl = source.url || createChannelUrl(channelId);
  return {
    platform: source.platform || 'YouTube',
    name: source.name || 'Unknown Channel',
    channelId,
    url: baseUrl || createChannelUrl(channelId),
    focus: Array.isArray(source.focus) ? source.focus : [],
  };
};

const mapSnippetToVideo = (item) => {
  const snippet = item.snippet;
  const videoId = item.id?.videoId;
  if (!snippet || !videoId) return null;
  return {
    id: videoId,
    title: snippet.title ?? 'Untitled',
    description: snippet.description ?? '',
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

const fetchChannelVideos = async (channelId, apiKey) => {
  const publishedAfter = new Date(Date.now() - VIDEO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('.')[0] + 'Z';
  const params = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    channelId,
    order: 'date',
    type: 'video',
    maxResults: `${SEARCH_PAGE_SIZE}`,
    publishedAfter,
  });
  const response = await fetch(`${YOUTUBE_API_BASE}/search?${params.toString()}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`YouTube API error ${response.status}: ${errorText.slice(0, 200)}`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items
    .map((item) => mapSnippetToVideo(item))
    .filter((video) => Boolean(video));
};

const runCollector = async () => {
  console.log('[collector] ステージ開始: YouTube Data APIで最新動画を取得します。');
  ensureDir(path.dirname(candidatesPath));

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const sources = readJson(sourcesPath, []);
  const existingCandidates = readJson(candidatesPath, []);

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('data/sources.json に監視対象が設定されていません。');
  }

  const updatedCandidates = [...existingCandidates];
  const summaryItems = [];
  const errors = [];
  let newCandidatesCount = 0;

  for (const [index, source] of sources.entries()) {
    const normalizedSource = normalizeSource(source);
    console.log(
      `[collector] (${index + 1}/${sources.length}) ${normalizedSource.name} の最新動画を取得します`,
    );

    if (!normalizedSource.channelId) {
      console.warn(
        `[collector] ${normalizedSource.name}: channelId が設定されていないためスキップします。`,
      );
      errors.push({
        source: normalizedSource.name,
        message: 'channelId is missing',
      });
      continue;
    }

    try {
      const videos = await fetchChannelVideos(normalizedSource.channelId, apiKey);
      const freshVideos = videos
        .filter((video) => withinWindow(video.publishedAt))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      console.log(
        `[collector] ${normalizedSource.name}: API取得 ${videos.length}件 / フィルタ後 ${freshVideos.length}件`,
      );

      let addedForChannel = 0;
      for (const video of freshVideos) {
        if (addedForChannel >= MAX_PER_CHANNEL) break;
        const candidateId = `yt-${video.id}`;
        const alreadyExists = updatedCandidates.some((candidate) => candidate.id === candidateId);
        if (alreadyExists) continue;

        const now = new Date().toISOString();
        const topicKey = slugify(video.title);
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
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          topicKey,
          notes: `YouTube Data API: ${normalizedSource.name} の最新動画`,
        });

        summaryItems.push({
          title: video.title,
          description: video.description,
          url: video.url,
          thumbnail: video.thumbnail,
          publishedAt: video.publishedAt,
        });

        newCandidatesCount += 1;
        addedForChannel += 1;
        console.log(
          `[collector] 新規候補を追加: ${normalizedSource.name} / ${video.title} (candidateId: ${candidateId})`,
        );
      }

      if (addedForChannel === 0) {
        console.log(`[collector] ${normalizedSource.name}: 新規候補はありませんでした。`);
      }
    } catch (error) {
      console.warn(`[collector] ${normalizedSource.name} でエラー: ${error.message}`);
      errors.push({
        source: normalizedSource.name,
        message: error.message,
      });
    }
  }

  updatedCandidates.sort((a, b) => {
    const aTime = new Date(a.video?.publishedAt || 0).getTime();
    const bTime = new Date(b.video?.publishedAt || 0).getTime();
    return bTime - aTime;
  });

  writeJson(candidatesPath, updatedCandidates);

  if (errors.length > 0) {
    console.log(`[collector] 警告: ${errors.length}件のソースでエラーが発生しました。`);
  }

  if (summaryItems.length === 0) {
    console.log('[collector] 今回は新規候補がありませんでした。');
  }

  console.log(
    `[collector] 完了: 新規${newCandidatesCount}件 / 総候補${updatedCandidates.length}件`,
  );

  return {
    source: 'YouTube',
    items: summaryItems,
    checkedSources: sources.length,
    newCandidates: newCandidatesCount,
    totalCandidates: updatedCandidates.length,
    errors,
  };
};

if (require.main === module) {
  runCollector()
    .then((result) => {
      console.log('Collector finished:', result);
    })
    .catch((error) => {
      console.error('Collector failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runCollector,
};
