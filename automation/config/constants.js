/**
 * @fileoverview 定数管理
 * プロジェクト全体で使用する定数を一元管理します。
 * 各パイプラインステージの挙動や、APIのレート制限などをここで設定します。
 */

// --- Collectorステージ関連 ---
const COLLECTOR = {
  // 1つのYouTubeチャンネルから一度に取得する最大動画数
  MAX_PER_CHANNEL: 2,
  // 何日前までの動画を収集対象とするか
  VIDEO_LOOKBACK_DAYS: 7,
  // YouTube APIで1ページあたりに取得する動画数
  SEARCH_PAGE_SIZE: 10,
  // 処理済み（generated, skipped, failed）の候補を何日後にクリーンアップするか
  CLEANUP_PROCESSED_DAYS: 14,
  // 未処理（collected/researched）の候補の最大保持数。これを超えると古いものから削除される。
  MAX_PENDING_CANDIDATES: 30,
};

// --- Researcherステージ関連 ---
const RESEARCHER = {
  // Google検索で参考にする上位記事の数
  GOOGLE_TOP_LIMIT: 3,
  // 記事コンテンツ取得時のタイムアウト（ミリ秒）
  ARTICLE_FETCH_TIMEOUT_MS: 15000,
  // 記事コンテンツの最大文字数（これを超えると切り捨て）
  ARTICLE_TEXT_MAX_LENGTH: 20000,
  // 生成する要約の最小文字数
  SUMMARY_MIN_LENGTH: 500,
  // 生成する要約の最大文字数
  SUMMARY_MAX_LENGTH: 800,
  // 記事コンテンツ取得時のユーザーエージェント
  USER_AGENT: 'AIInfoBlogCollector/1.0 (+https://github.com/gray-desk/AI-information-blog)',
};

// --- Generatorステージ関連 ---
const GENERATOR = {
  // 同じトピックの記事を生成しない期間（日数）
  DEDUPE_WINDOW_DAYS: 5,
};

// --- APIレート制限 ---
// 各API呼び出しの間に設ける待機時間（ミリ秒）
const RATE_LIMITS = {
  // キーワード抽出API呼び出し後の待機時間
  KEYWORD_EXTRACTION_WAIT_MS: 500,
  // Google検索API呼び出し後の待機時間
  GOOGLE_SEARCH_WAIT_MS: 500,
  // 候補1件あたりの処理（Researcher）後の待機時間
  CANDIDATE_PROCESSING_WAIT_MS: 1000,
  // 検索結果の各記事要約API呼び出し後の待機時間
  SEARCH_RESULT_WAIT_MS: 500,
};

// --- 検証関連 ---
const VALIDATION = {
  // 孤立した記事ファイル（posts.jsonに未登録）のチェックを有効にするか
  ORPHAN_POST_CHECK_ENABLED: true,
  // 孤立記事チェックで無視するファイルリスト
  ORPHAN_POST_IGNORE: ['article-template.html'],
};

module.exports = {
  COLLECTOR,
  RESEARCHER,
  GENERATOR,
  RATE_LIMITS,
  VALIDATION,
};