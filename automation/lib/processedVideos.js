/**
 * @fileoverview 記事化済みの動画IDを管理するリポジトリ
 * - Researcherでの1次フィルタ（Video ID重複）と、Publisherでの記録に利用します。
 */

const path = require('path');
const { readJson, writeJson, ensureDir } = require('./io');

// プロジェクトルートを起点に保存パスを解決
const root = path.resolve(__dirname, '..', '..');
const processedVideosPath = path.join(root, 'data', 'processed-videos.json');

/**
 * 記録済みの動画リストを読み込みます。
 * @returns {Array<object>}
 */
const readProcessedVideos = () => readJson(processedVideosPath, []);

/**
 * 記録済み動画リストを書き込みます。
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
const writeProcessedVideos = (records) => {
  ensureDir(path.dirname(processedVideosPath));
  writeJson(processedVideosPath, records);
  return records;
};

/**
 * 指定したVideo IDが既に記事化済みか判定します。
 * @param {string} videoId
 * @returns {boolean}
 */
const isProcessedVideo = (videoId) => {
  if (!videoId) return false;
  const records = readProcessedVideos();
  return records.some((entry) => entry.videoId === videoId);
};

/**
 * 記事化が完了した動画を保存（既存があれば上書き）します。
 * @param {object} entry
 * @param {string} entry.videoId
 * @param {string} [entry.videoTitle]
 * @param {string} [entry.articleTitle]
 * @param {string} [entry.postUrl]
 * @param {string} [entry.sourceName]
 * @param {string} [entry.processedAt]
 * @returns {object} 追加・更新後のエントリ
 */
const upsertProcessedVideo = (entry) => {
  const now = new Date().toISOString();
  if (!entry || !entry.videoId) return null;

  const normalized = {
    videoId: entry.videoId,
    videoTitle: entry.videoTitle || '',
    articleTitle: entry.articleTitle || '',
    postUrl: entry.postUrl || '',
    sourceName: entry.sourceName || '',
    processedAt: entry.processedAt || now,
  };

  const records = readProcessedVideos();
  const filtered = records.filter((item) => item.videoId !== normalized.videoId);
  filtered.push(normalized);

  // processedAtの新しい順にソート
  filtered.sort((a, b) => new Date(b.processedAt || 0) - new Date(a.processedAt || 0));

  writeProcessedVideos(filtered);
  return normalized;
};

module.exports = {
  processedVideosPath,
  readProcessedVideos,
  writeProcessedVideos,
  isProcessedVideo,
  upsertProcessedVideo,
};
