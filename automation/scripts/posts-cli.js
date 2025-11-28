#!/usr/bin/env node
/**
 * @fileoverview 投稿管理を簡単にするための軽量CLI
 * - 最新記事やドラフトの一覧表示
 * - posts.json / posts/ の整合性チェック（孤立ファイル検出）
 * - candidates.json のステータス簡易サマリー
 *
 * 使い方:
 *   npm run posts -- list      # 最新の記事を表示（デフォルト）
 *   npm run posts -- drafts    # ドラフトだけ表示
 *   npm run posts -- status    # 投稿と候補の件数を確認
 *   npm run posts -- orphans   # posts/ にあるが posts.json 未登録のファイルを検出
 */

const path = require('path');
const minimist = require('minimist');
const { readJson } = require('../lib/io');
const { findOrphanPosts } = require('../lib/postValidation');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const postsPath = path.join(root, 'data', 'posts.json');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const postsDir = path.join(root, 'posts');

/**
 * 日付文字列をパースしてタイムスタンプ（ミリ秒）を返します。
 * @param {string} value - パースする日付文字列
 * @param {string} fallbackDate - valueのパースに失敗した場合に使う'YYYY-MM-DD'
 * @returns {number} タイムスタンプ（ミリ秒）。失敗時は0。
 */
const parseDateValue = (value, fallbackDate) => {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  if (fallbackDate) {
    const parsed = new Date(`${fallbackDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
};

/**
 * YYYY-MM-DD 形式に揃えた日付文字列を返します。
 * @param {object} post - 記事オブジェクト
 * @returns {string} フォーマット済み日付
 */
const formatDate = (post) => {
  const ts = parseDateValue(post?.publishedAt, post?.date);
  if (!ts) return '----/--/--';
  const d = new Date(ts);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}/${mm}/${dd}`;
};

/**
 * 配列をステータス別に集計します。
 * @param {Array<object>} items - 対象配列
 * @param {string} fallback - ステータス未設定時のフォールバック
 * @returns {Record<string, number>} 集計結果
 */
const countByStatus = (items, fallback = 'unknown') =>
  items.reduce((acc, item) => {
    const status = item?.status || fallback;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

/**
 * posts.json を読み込み、整形済み配列を返します。
 */
const loadPosts = () => {
  const posts = readJson(postsPath, []);
  if (!Array.isArray(posts)) return [];
  return posts
    .filter(Boolean)
    .map((post) => ({
      ...post,
      status: post.status || 'published',
    }));
};

/**
 * candidates.json を読み込みます。
 */
const loadCandidates = () => {
  const candidates = readJson(candidatesPath, []);
  return Array.isArray(candidates) ? candidates.filter(Boolean) : [];
};

/**
 * 記事を新しい順にソートします。
 */
const sortPosts = (posts) =>
  [...posts].sort((a, b) => {
    const bTime = parseDateValue(b?.publishedAt, b?.date);
    const aTime = parseDateValue(a?.publishedAt, a?.date);
    if (bTime !== aTime) return bTime - aTime;
    return (b?.slug || b?.url || '').localeCompare(a?.slug || a?.url || '', undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });

/**
 * 一覧表示用の1行文字列を生成します。
 */
const formatPostLine = (post, index) => {
  const prefix = String(index + 1).padStart(2, '0');
  const date = formatDate(post);
  const status = (post.status || 'published').padEnd(9, ' ');
  const slug = post.slug || post.url || '';
  const title = (post.title || '').replace(/\s+/g, ' ').trim();
  const short = title.length > 70 ? `${title.slice(0, 67)}...` : title;
  const tagSummary = Array.isArray(post.tags) && post.tags.length > 0
    ? ` [${post.tags.slice(0, 3).map((tag) => (tag.slug || tag)).join(', ')}${post.tags.length > 3 ? ', ...' : ''}]`
    : '';
  return `${prefix} ${date} [${status}] ${slug} — ${short}${tagSummary}`;
};

/**
 * 最新の記事を一覧表示します。
 */
const handleList = (argv) => {
  const posts = sortPosts(loadPosts());
  const limit = Math.max(1, Number(argv.limit || argv.n || 10));
  const statusFilter = argv.status ? String(argv.status).toLowerCase() : null;
  const filtered = statusFilter
    ? posts.filter((post) => (post.status || '').toLowerCase() === statusFilter)
    : posts;

  if (filtered.length === 0) {
    console.log('[posts-cli] 表示できる記事がありません。');
    return;
  }

  console.log(`[posts-cli] 最新 ${Math.min(limit, filtered.length)} 件を表示中 (${filtered.length} 件中)`);
  filtered.slice(0, limit).forEach((post, idx) => {
    console.log(formatPostLine(post, idx));
  });
};

/**
 * ドラフトのみを表示します。
 */
const handleDrafts = (argv) => {
  const posts = sortPosts(loadPosts()).filter((post) => (post.status || '').toLowerCase() !== 'published');
  if (posts.length === 0) {
    console.log('[posts-cli] ドラフトはありません。');
    return;
  }
  const limit = Math.max(1, Number(argv.limit || argv.n || 20));
  console.log(`[posts-cli] ドラフト一覧 (${posts.length} 件) / limit ${limit}`);
  posts.slice(0, limit).forEach((post, idx) => {
    console.log(formatPostLine(post, idx));
  });
};

/**
 * 投稿と候補の件数サマリーを表示します。
 */
const handleStatus = () => {
  const posts = loadPosts();
  const candidates = loadCandidates();
  const latestPost = sortPosts(posts)[0];
  const postStats = countByStatus(posts, 'unknown');
  const candidateStats = countByStatus(candidates, 'unspecified');

  console.log('=== 投稿サマリー ===');
  console.log(`- data/posts.json: ${posts.length}件`);
  Object.entries(postStats)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .forEach(([status, count]) => console.log(`  • ${status}: ${count}`));
  if (latestPost) {
    console.log(`- 最新: ${formatDate(latestPost)} ${latestPost.slug || ''} — ${latestPost.title || ''}`);
  }
  console.log(`- 記事ディレクトリ: ${postsDir}`);

  console.log('\n=== 候補サマリー (data/candidates.json) ===');
  console.log(`- 合計: ${candidates.length}件`);
  Object.entries(candidateStats)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .forEach(([status, count]) => console.log(`  • ${status}: ${count}`));
};

/**
 * posts/ にあるが posts.json に未登録のファイルを検出します。
 */
const handleOrphans = async () => {
  const orphans = await findOrphanPosts();
  if (!Array.isArray(orphans) || orphans.length === 0) {
    console.log('[posts-cli] 孤立記事はありません。');
    return;
  }
  console.log('[posts-cli] data/posts.json 未登録のファイルを検出しました:');
  orphans.forEach((entry, idx) => {
    console.log(`- ${idx + 1}. ${entry.url}`);
  });
};

/**
 * ヘルプを表示します。
 */
const printHelp = () => {
  console.log(`
Usage: npm run posts -- <command> [options]

Commands:
  list           最新記事を一覧表示（デフォルト）
  drafts         status !== 'published' の記事を一覧表示
  status         投稿/候補の件数サマリーを表示
  orphans        posts/ にあるが posts.json に未登録のファイルを検出

Options:
  -n, --limit    表示件数（list/drafts） default: 10
  --status       listコマンドで特定ステータスのみに絞り込み
  -h, --help     このヘルプを表示
`);
};

/**
 * エントリーポイント
 */
const main = async () => {
  const argv = minimist(process.argv.slice(2), {
    alias: { n: 'limit', h: 'help' },
    string: ['status'],
    default: { limit: 10 },
  });

  const command = argv._[0] || 'list';
  if (argv.help || command === 'help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'list':
      handleList(argv);
      break;
    case 'drafts':
      handleDrafts(argv);
      break;
    case 'status':
      handleStatus();
      break;
    case 'orphans':
      await handleOrphans();
      break;
    default:
      console.log(`[posts-cli] 未対応のコマンドです: ${command}\n`);
      printHelp();
  }
};

main().catch((error) => {
  console.error('[posts-cli] エラーが発生しました:', error.message);
  process.exit(1);
});
