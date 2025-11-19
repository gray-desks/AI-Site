/**
 * @fileoverview 候補リポジトリ
 * 記事の候補データ（`data/candidates.json`）の読み書きを抽象化するモジュール。
 * ファイルI/Oを直接触らずに、候補データの操作（読み込み、書き込み、検索、更新）を行えるようにします。
 */

const path = require('path');
const { readJson, writeJson, ensureDir } = require('./io');

// プロジェクトのルートディレクトリを取得
const root = path.resolve(__dirname, '..', '..');
// 候補データファイルのパス
const candidatesPath = path.join(root, 'data', 'candidates.json');

/**
 * `data/candidates.json` からすべての候補を読み込みます。
 * ファイルが存在しない場合は空の配列を返します。
 * @returns {Array<object>} 候補の配列
 */
const readCandidates = () => readJson(candidatesPath, []);

/**
 * 候補の配列を `data/candidates.json` に書き込みます。
 * @param {Array<object>} candidates - 書き込む候補の配列
 * @returns {Array<object>} 書き込んだ候補の配列
 */
const writeCandidates = (candidates) => {
  // ディレクトリが存在しない場合に作成
  ensureDir(path.dirname(candidatesPath));
  writeJson(candidatesPath, candidates);
  return candidates;
};

/**
 * 指定されたステータスを持つ候補を検索します。
 * @param {string} status - 検索するステータス (e.g., 'collected', 'researched')
 * @returns {Array<object>} 指定されたステータスを持つ候補の配列
 */
const findByStatus = (status) => {
  if (!status) return [];
  return readCandidates().filter((candidate) => candidate.status === status);
};

/**
 * 指定されたIDの候補を更新します。
 * @param {string} id - 更新する候補のID
 * @param {object|Function} updater - 更新内容を含むオブジェクト、または現在の候補を引数に取り更新後の候補を返す関数
 * @returns {{updated: object|null, candidates: Array<object>}} 更新後の候補と全候補リスト
 */
const updateCandidate = (id, updater) => {
  const candidates = readCandidates();
  const index = candidates.findIndex((candidate) => candidate.id === id);
  // 候補が見つからない場合は何もせず返す
  if (index === -1) {
    return { updated: null, candidates };
  }
  const current = candidates[index];
  // updaterが関数かオブジェクトかで処理を分岐
  const next =
    typeof updater === 'function'
      ? updater(current)
      : {
          ...current,
          ...updater,
        };
  candidates[index] = next;
  // 更新後の全候補リストをファイルに書き込む
  writeCandidates(candidates);
  return { updated: next, candidates };
};

/**
 * 新しい候補をリストに追加します。
 * @param {object} candidate - 追加する候補オブジェクト
 * @returns {object} 追加された候補オブジェクト
 */
const appendCandidate = (candidate) => {
  const candidates = readCandidates();
  candidates.push(candidate);
  writeCandidates(candidates);
  return candidate;
};

module.exports = {
  candidatesPath,
  readCandidates,
  writeCandidates,
  findByStatus,
  updateCandidate,
  appendCandidate,
};