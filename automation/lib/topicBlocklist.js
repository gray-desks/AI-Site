/**
 * @fileoverview トピックキーのブロックリスト管理
 * 重複と判定したトピックを記録し、後続のパイプラインで再利用しないようにする。
 */

const path = require('path');
const { readJson, writeJson, ensureDir } = require('./io');

const root = path.resolve(__dirname, '..', '..');
const blocklistPath = path.join(root, 'data', 'topic-blocklist.json');

/**
 * ブロックリストを読み込む
 * @returns {Array<object>}
 */
const readBlocklist = () => readJson(blocklistPath, []);

/**
 * ブロックリストを書き込む
 * @param {Array<object>} entries
 * @returns {Array<object>}
 */
const writeBlocklist = (entries) => {
  ensureDir(path.dirname(blocklistPath));
  writeJson(blocklistPath, entries);
  return entries;
};

/**
 * 指定トピックキーがブロック済みかを判定する
 * @param {string} topicKey
 * @returns {boolean}
 */
const isTopicBlocked = (topicKey) => {
  if (!topicKey) return false;
  return readBlocklist().some((entry) => entry.topicKey === topicKey);
};

/**
 * トピックキーをブロックリストに追加または更新する
 * @param {string} topicKey
 * @param {object} meta
 * @returns {object} 追加または更新されたエントリ
 */
const blockTopic = (topicKey, meta = {}) => {
  if (!topicKey) return null;
  const now = new Date().toISOString();
  const current = readBlocklist().filter((entry) => entry.topicKey !== topicKey);
  const entry = {
    topicKey,
    reason: meta.reason || 'duplicate-topic',
    sourceName: meta.sourceName || null,
    videoTitle: meta.videoTitle || null,
    blockedAt: meta.blockedAt || now,
  };
  current.push(entry);
  writeBlocklist(current);
  return entry;
};

module.exports = {
  readBlocklist,
  writeBlocklist,
  isTopicBlocked,
  blockTopic,
  blocklistPath,
};
