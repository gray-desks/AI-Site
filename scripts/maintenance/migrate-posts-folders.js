#!/usr/bin/env node
/**
 * @fileoverview posts/ 配下を年/月ディレクトリに再配置し、posts.jsonのURLを更新するスクリプト
 *
 * 既存のフラットな `posts/<slug>.html` を `posts/YYYY/MM/<slug>.html` に移動します。
 * あわせて HTML 内の相対パス（href/src="../..."）をディレクトリ深さに合わせて調整します。
 */

const fs = require('fs/promises');
const path = require('path');
const { readJson, writeJson, ensureDir } = require('../../automation/lib/io');
const { injectCommonComponents } = require('../../automation/publisher/ssg');

const root = path.resolve(__dirname, '..', '..');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const postsDir = path.join(root, 'posts');
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');

const fileExists = async (p) => {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
};

/**
 * 日付情報から YYYY / MM を抽出する。
 * date/publishedAt に無効値しかない場合は slug や url から推測。
 */
const extractDateParts = (post = {}) => {
    const pick = (value) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return {
            year: String(parsed.getUTCFullYear()),
            month: String(parsed.getUTCMonth() + 1).padStart(2, '0'),
        };
    };

    const fromDate = pick(post.date) || pick(post.publishedAt);
    if (fromDate) return fromDate;

    const guessFromString = (value) => {
        if (!value) return null;
        const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
        if (match) return { year: match[1], month: match[2] };
        return null;
    };

    return (
        guessFromString(post.slug) ||
        guessFromString(post.url) || {
            year: 'unknown',
            month: '01',
        }
    );
};

/**
 * posts配下での新しい相対パスを生成する。
 */
const buildNewRelativePath = (post) => {
    const { year, month } = extractDateParts(post);
    const fileName =
        path.posix.basename(post.url || '') ||
        (post.slug ? `${post.slug}.html` : 'draft.html');
    const normalizedFile = fileName.endsWith('.html') ? fileName : `${fileName}.html`;
    return path.posix.join('posts', year, month, normalizedFile);
};

/**
 * href/src="../" のような相対パスを、深さに応じて置き換える。
 */
const rewriteAssetBase = (html, relativePath) => {
    const depth = Math.max(1, relativePath.split('/').length - 1);
    const newBase = '../'.repeat(depth);
    return html.replace(/(?<=\b(?:href|src|content)=["'])(\.\.\/)+/g, newBase);
};

const migrate = async () => {
    console.log('[migrate-posts-folders] 開始');

    const posts = readJson(postsJsonPath, []);
    if (!Array.isArray(posts) || posts.length === 0) {
        console.log('[migrate-posts-folders] data/posts.json に記事がありません。');
        return;
    }

    const topicHistory = readJson(topicHistoryPath, []);
    const updatedHistory = Array.isArray(topicHistory) ? [...topicHistory] : [];

    let moved = 0;
    let rewritten = 0;
    let missing = 0;

    const migratedPosts = [];

    for (const post of posts) {
        const currentUrl = post.url || '';
        const newRelative = buildNewRelativePath(post);
        migratedPosts.push({
            ...post,
            url: newRelative,
        });

        const sourcePath = path.join(root, currentUrl || path.posix.join('posts', `${post.slug}.html`));
        const destPath = path.join(root, newRelative);

        if (path.resolve(sourcePath) === path.resolve(destPath) && (await fileExists(destPath))) {
            // 同じ場所に既に存在する場合はベースパスと共通コンポーネントを調整
            const content = await fs.readFile(destPath, 'utf-8');
            const adjusted = rewriteAssetBase(content, newRelative);
            const injected = injectCommonComponents(adjusted, newRelative);
            if (injected !== content) {
                await fs.writeFile(destPath, injected, 'utf-8');
                rewritten += 1;
            }
            continue;
        }

        if (!(await fileExists(sourcePath))) {
            console.warn(`[migrate-posts-folders] ⚠️ ファイルが見つかりません: ${currentUrl}`);
            missing += 1;
            continue;
        }

        const content = await fs.readFile(sourcePath, 'utf-8');
        const adjusted = rewriteAssetBase(content, newRelative);
        const injected = injectCommonComponents(adjusted, newRelative);

        await ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, injected, 'utf-8');
        rewritten += injected === content ? 0 : 1;

        if (path.resolve(sourcePath) !== path.resolve(destPath)) {
            await fs.unlink(sourcePath);
            moved += 1;
        }

        // topic-history の draftUrl を更新（可能な場合のみ）
        if (Array.isArray(updatedHistory) && currentUrl) {
            updatedHistory.forEach((entry) => {
                if (entry?.draftUrl === currentUrl) {
                    entry.draftUrl = newRelative;
                }
            });
        }
    }

    writeJson(postsJsonPath, migratedPosts);
    if (Array.isArray(updatedHistory)) {
        writeJson(topicHistoryPath, updatedHistory);
    }

    console.log(
        `[migrate-posts-folders] 完了: 移動 ${moved}件 / ベース書き換え ${rewritten}件 / 行方不明 ${missing}件`
    );
};

migrate().catch((error) => {
    console.error('[migrate-posts-folders] 失敗:', error);
    process.exit(1);
});
