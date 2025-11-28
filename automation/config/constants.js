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
  VIDEO_LOOKBACK_DAYS: 1,
  // YouTube APIで1ページあたりに取得する動画数
  SEARCH_PAGE_SIZE: 10,
  // 処理済み（generated, skipped, failed）の候補を何日後にクリーンアップするか
  CLEANUP_PROCESSED_DAYS: 14,
  // 未処理（collected/researched）の候補の最大保持数。これを超えると古いものから削除される。
  MAX_PENDING_CANDIDATES: 30,
  // この件数以上の未処理候補がある場合はCollectorをスキップしてAPIコストを抑える
  SKIP_IF_ACTIVE_CANDIDATES: 20,
};

// --- Researcherステージ関連 ---
const RESEARCHER = {
  // テーマ重複判定に使う直近記事の件数
  RECENT_POST_LIMIT: 10,
  // プロンプトに含める字幕テキストの最大文字数（長すぎる場合はトリム）
  TRANSCRIPT_MAX_LENGTH: 9000,
  // 字幕がこの文字数未満しか取得できない場合は不十分としてスキップ
  TRANSCRIPT_MIN_CHARS: 300,
  // --- Legacy (Google検索ベースの実装との互換用) ---
  GOOGLE_TOP_LIMIT: 5,
  MIN_SUMMARIES: 2,
  ARTICLE_FETCH_TIMEOUT_MS: 15000,
  ARTICLE_TEXT_MAX_LENGTH: 20000,
  SUMMARY_MIN_LENGTH: 500,
  SUMMARY_MAX_LENGTH: 800,
  USER_AGENT: 'AIInfoBlogCollector/1.0 (+https://github.com/gray-desk/AI-information-blog)',
  SEARCH_FRESHNESS_DAYS: 7,
};

// --- Generatorステージ関連 ---
const GENERATOR = {
  // 同じトピックの記事を生成しない期間（日数）
  DEDUPE_WINDOW_DAYS: 5,
};

// --- APIレート制限 ---
// 各API呼び出しの間に設ける待機時間（ミリ秒）
const RATE_LIMITS = {
  // 候補1件あたりの処理後の待機時間
  CANDIDATE_PROCESSING_WAIT_MS: 500,
  // テーマ重複チェックを連続で行う際の待機時間
  THEME_DEDUP_WAIT_MS: 300,
};

// --- 検証関連 ---
const VALIDATION = {
  // 孤立した記事ファイル（posts.jsonに未登録）のチェックを有効にするか
  ORPHAN_POST_CHECK_ENABLED: true,
  // 孤立記事チェックで無視するファイルリスト
  ORPHAN_POST_IGNORE: ['article-template.html'],
};

// --- サイト設定 ---
const SITE_CONFIG = {
  // サイトのベースURL（sitemap.xml生成に使用）
  // TODO: 実際の公開URLに変更してください
  BASE_URL: 'https://yamazaki2357.github.io/AI-Site',
};

module.exports = {
  COLLECTOR,
  RESEARCHER,
  GENERATOR,
  RATE_LIMITS,
  VALIDATION,
  SITE_CONFIG,
};
