/**
 * @fileoverview ファイルI/Oユーティリティ
 * JSONファイルの読み書きやディレクトリ作成など、基本的なファイル操作を抽象化するヘルパー関数を提供します。
 */

const fs = require('fs');

/**
 * JSONファイルを同期的に読み込み、パースして返します。
 * ファイルが存在しない場合やJSONのパースに失敗した場合は、指定されたフォールバック値を返します。
 * @param {string} filePath - 読み込むJSONファイルのパス
 * @param {*} fallback - 読み込みやパースに失敗した場合に返すデフォルト値
 * @returns {*} パースされたJSONオブジェクト、またはフォールバック値
 */
const readJson = (filePath, fallback) => {
  try {
    // ファイルが存在しない場合はフォールバック値を返す
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    // パースエラーなど、その他のエラーが発生した場合もフォールバック値を返す
    console.error(`Error reading or parsing JSON file at ${filePath}:`, error);
    return fallback;
  }
};

/**
 * データをJSON形式に変換し、ファイルに同期的に書き込みます。
 * 人間が読みやすいように、2スペースのインデントで整形されます。
 * @param {string} filePath - 書き込み先のファイルパス
 * @param {*} data - 書き込むデータ（JSONシリアライズ可能なオブジェクト）
 */
const writeJson = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing JSON file to ${filePath}:`, error);
  }
};

/**
 * 指定されたディレクトリパスが存在しない場合に、再帰的に作成します。
 * `mkdir -p` コマンドと同様の動作をします。
 * @param {string} dir - 作成するディレクトリのパス
 */
const ensureDir = (dir) => {
  try {
    // recursive: true オプションにより、親ディレクトリもまとめて作成
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(`Error creating directory at ${dir}:`, error);
  }
};

module.exports = {
  readJson,
  writeJson,
  ensureDir,
};