/**
 * @fileoverview ロギングユーティリティ
 * スコープ（コンテキスト）付きのログ出力を提供します。
 * 各モジュールで専用のロガーインスタンスを作成して使用することで、
 * ログの発生源が分かりやすくなります。
 * 例: `[Collector] 新規候補を追加しました`
 */

/**
 * ログメッセージにスコープ（プレフィックス）を追加してフォーマットします。
 * @param {string} scope - ログのスコープ（例: "Collector", "Generator"）
 * @param {string|*} message - ログメッセージ
 * @returns {string} フォーマットされたメッセージ
 */
const formatMessage = (scope, message) => {
  // メッセージが文字列の場合、スコープを付けて返す
  if (typeof message === 'string') {
    return scope ? `[${scope}] ${message}` : message;
  }
  // メッセージがオブジェクトなどの場合、スコープのみを返す
  return scope ? `[${scope}]` : '';
};

/**
 * 指定されたスコープを持つロガーインスタンスを作成します。
 * @param {string} scope - このロガーインスタンスのスコープ名
 * @returns {{info: Function, warn: Function, error: Function, debug: Function, success: Function}} ログメソッドを持つオブジェクト
 */
const createLogger = (scope) => {
  /**
   * 指定されたconsoleメソッド（log, warnなど）でログ出力する高階関数を生成します。
   * @param {string} method - consoleのメソッド名（'log', 'warn', 'error', 'debug'）
   * @returns {Function} ログ出力関数
   */
  const logWith = (method) => (message, ...rest) => {
    const prefix = formatMessage(scope, message);
    // メッセージが文字列の場合、プレフィックスと残りの引数をconsoleに出力
    if (typeof message === 'string') {
      console[method](prefix, ...rest);
    } else {
      // メッセージがオブジェクトなどの場合、プレフィックス、メッセージオブジェクト、残りの引数を出力
      console[method](prefix, message, ...rest);
    }
  };

  // 各ログレベルに対応するメソッドを持つロガーオブジェクトを返す
  return {
    info: logWith('log'),    // 通常の情報
    warn: logWith('warn'),   // 警告
    error: logWith('error'), // エラー
    debug: logWith('debug'), // デバッグ情報
    success: logWith('log'), // 成功メッセージ（infoと同じだが、意図を明確にするために用意）
  };
};

module.exports = {
  createLogger,
};