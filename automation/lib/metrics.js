/**
 * @fileoverview メトリクス追跡ユーティリティ
 * パイプラインの各ステージで処理時間やカウンター（処理件数など）を記録・集計するためのモジュールです。
 * これにより、パフォーマンスの監視や処理結果の定量的な評価が可能になります。
 */

/**
 * 数値配列の平均値を計算し、整数に丸めます。
 * @param {Array<number>} values - 数値の配列
 * @returns {number} 平均値（四捨五入）。配列が空の場合は0を返します。
 */
const average = (values) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Math.round(sum / values.length);
};

/**
 * メトリクス追跡用のインスタンスを作成します。
 * @param {string} [scope='metrics'] - このメトリクストラッカーのスコープ名（例: 'collector', 'researcher'）
 * @returns {object} メトリクスを追跡するためのメソッド群を持つオブジェクト
 */
const createMetricsTracker = (scope = 'metrics') => {
  // カウンター（処理回数など）を格納するMap
  const counters = new Map();
  // 実行時間（ミリ秒）の配列を格納するMap
  const timings = new Map();

  /**
   * 指定されたキーのカウンターをインクリメント（増加）します。
   * @param {string} key - カウンター名
   * @param {number} [amount=1] - 増加させる量
   * @returns {number} 更新後のカウンターの値
   */
  const increment = (key, amount = 1) => {
    const next = (counters.get(key) || 0) + amount;
    counters.set(key, next);
    return next;
  };

  /**
   * 指定されたキーのカウンターに値を直接セットします。
   * @param {string} key - カウンター名
   * @param {number} value - セットする値
   * @returns {number} セットした値
   */
  const set = (key, value) => {
    counters.set(key, value);
    return value;
  };

  /**
   * 指定されたキーに処理時間を記録します。
   * @param {string} key - タイマー名
   * @param {number} duration - 記録する処理時間（ミリ秒）
   * @returns {number} 記録した処理時間
   */
  const recordDuration = (key, duration) => {
    if (!timings.has(key)) {
      timings.set(key, []);
    }
    timings.get(key).push(duration);
    return duration;
  };

  /**
   * タイマーを開始し、終了時に処理時間を自動で記録する関数を返します。
   * @param {string} key - タイマー名
   * @returns {Function} 処理終了後に呼び出すことでタイマーを停止し、時間を記録する関数。記録した時間を返します。
   *
   * @example
   * const stopTimer = metricsTracker.startTimer('api-call');
   * await someApiCall();
   * const elapsedTime = stopTimer(); // 処理時間が自動的に記録される
   */
  const startTimer = (key) => {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      recordDuration(key, duration);
      return duration;
    };
  };

  /**
   * 指定されたキーのカウンターの現在値を取得します。
   * @param {string} key - カウンター名
   * @returns {number} カウンターの値（存在しない場合は0）
   */
  const getCounter = (key) => counters.get(key) || 0;

  /**
   * 指定されたキーで記録された時間の配列を取得します。
   * @param {string} key - タイマー名
   * @returns {Array<number>} 記録された時間の配列（存在しない場合は空配列）
   */
  const getTimings = (key) => timings.get(key) || [];

  /**
   * これまでに記録された全メトリクスのサマリーを生成します。
   * @returns {object} { scope, counters, timings } 形式のサマリーオブジェクト
   */
  const summary = () => {
    const timingSummary = {};
    // 各タイマーの統計情報（回数、平均、最小、最大）を計算
    timings.forEach((values, key) => {
      if (!values.length) return;
      timingSummary[key] = {
        count: values.length,
        avg: average(values),
        min: Math.min(...values),
        max: Math.max(...values),
      };
    });

    return {
      scope,
      counters: Object.fromEntries(counters), // Mapをプレーンなオブジェクトに変換
      timings: timingSummary,
    };
  };

  return {
    increment,
    set,
    startTimer,
    recordDuration,
    getCounter,
    getTimings,
    summary,
  };
};

module.exports = {
  average,
  createMetricsTracker,
};