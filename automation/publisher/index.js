#!/usr/bin/env node
/**
 * @fileoverview Publisher: 記事公開ステージ
 * - Generatorステージの出力（生成された記事データ）を受け取ります。
 * - 記事のHTMLファイルを `posts/` ディレクトリに書き込みます。
 * - 記事のメタデータを `data/posts.json` に追加・更新します。
 * - パイプライン全体の実行結果を `automation/output/pipeline-status.json` に保存します。
 * - パイプラインのいずれかのステージでエラーが発生した場合、失敗ステータスを記録します。
 */

const fs = require('fs');
const path = require('path');
const { readJson, writeJson, ensureDir } = require('../lib/io');
const { VALIDATION } = require('../config/constants');
const { findOrphanPosts } = require('../lib/postValidation');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const postsDir = path.join(root, 'posts');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const statusPath = path.join(root, 'automation', 'output', 'pipeline-status.json');

/**
 * 日付文字列をパースしてタイムスタンプ（ミリ秒）を返します。
 * パースに失敗した場合はフォールバック値を試みます。
 * @param {string} value - パースする日付文字列 (e.g., ISO 8601)
 * @param {string} fallbackDate - valueのパースに失敗した場合に使用する日付 (e.g., 'YYYY-MM-DD')
 * @returns {number} タイムスタンプ（ミリ秒）、または0
 */
const parseDateValue = (value, fallbackDate) => {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  if (fallbackDate) {
    // 'YYYY-MM-DD' 形式をUTCとして解釈
    const parsed = new Date(`${fallbackDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
};

/**
 * 記事リスト（posts.jsonの内容）に新しい記事エントリを追加または更新します。
 * @param {Array<object>} posts - 現在の記事リスト
 * @param {object} newEntry - 追加する新しい記事エントリ
 * @returns {Array<object>} 更新された記事リスト
 */
const updatePosts = (posts, newEntry) => {
  const list = Array.isArray(posts) ? [...posts] : [];
  if (!newEntry) return list;

  // 新しいエントリに公開日時がなければ現在時刻を設定
  const normalizedEntry = {
    ...newEntry,
    publishedAt: newEntry.publishedAt || new Date().toISOString(),
  };

  // 同じURLのエントリがあれば削除し、新しいエントリを追加
  const filtered = list.filter((post) => post.url !== normalizedEntry.url);
  filtered.push(normalizedEntry);

  // 記事リストをソートする
  filtered.sort((a, b) => {
    // 1. publishedAt (新しい順)
    const bTime = parseDateValue(b.publishedAt, b.date);
    const aTime = parseDateValue(a.publishedAt, a.date);
    if (bTime !== aTime) return bTime - aTime;

    // 2. date (新しい順)
    const bDate = new Date(b.date);
    const aDate = new Date(a.date);
    if (!Number.isNaN(bDate) && !Number.isNaN(aDate) && bDate.getTime() !== aDate.getTime()) {
      return bDate - aDate;
    }

    // 3. slug/url (辞書順)
    return (b.slug || b.url || '').localeCompare(a.slug || a.url || '', undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
  return filtered;
};

/**
 * パイプラインの実行ステータスをJSONファイルに書き込みます。
 * @param {object} payload - 書き込むステータス情報
 * @returns {object} 書き込んだペイロード
 */
const writeStatusSnapshot = (payload) => {
  ensureDir(path.dirname(statusPath));
  writeJson(statusPath, payload);
  console.log('[publisher] pipeline-status.json を更新しました。');
  return payload;
};

/**
 * パイプラインが失敗した際のステータスを記録します。
 * @param {Error} error - 発生したエラーオブジェクト
 * @param {object} context - パイプラインの各ステージの結果
 * @returns {object} 書き込んだステータス情報
 */
const recordFailureStatus = (error, context = {}) => {
  const payload = {
    status: 'failure',
    generatedFile: null,
    executedAt: new Date().toISOString(),
    error: {
      message: error.message,
      // スタックトレースは簡略化して保存
      stack: (error.stack || '').split('\n').slice(0, 8).join('\n'),
    },
    ...context,
  };
  return writeStatusSnapshot(payload);
};

/**
 * Publisherステージのメイン処理
 * @param {object} pipelineResults - 各ステージの結果
 * @param {object} pipelineResults.collectorResult - Collectorステージの結果
 * @param {object} pipelineResults.researcherResult - Researcherステージの結果
 * @param {object} pipelineResults.generatorResult - Generatorステージの結果
 * @returns {Promise<object>} 最終的なパイプラインステータス
 */
const runPublisher = async ({ collectorResult, researcherResult, generatorResult }) => {
  console.log('[publisher] ステージ開始: 記事ファイルとサマリーを更新します。');
  ensureDir(postsDir);

  const posts = readJson(postsJsonPath, []);
  let updatedPosts = posts;
  let generatedFilePath = null;
  let postsChanged = false;

  // Generatorが記事を生成した場合のみ処理を実行
  if (generatorResult?.generated && generatorResult.article?.htmlContent) {
    const article = generatorResult.article;
    const relativePath =
      article.relativePath || path.posix.join('posts', `${article.slug ?? 'draft'}.html`);
    const absolutePath = path.join(root, relativePath);
    ensureDir(path.dirname(absolutePath));

    const nextHtml = article.htmlContent;
    // 既存ファイルがあれば読み込み、内容が変更されているか確認
    const currentHtml = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null;
    if (currentHtml !== nextHtml) {
      fs.writeFileSync(absolutePath, nextHtml);
      console.log(`[publisher] 記事ファイルを書き込みました: ${relativePath}`);
    } else {
      console.log(`[publisher] 既存コンテンツと同一のため書き込みをスキップ: ${relativePath}`);
    }

    generatedFilePath = relativePath;
    
    // posts.jsonに保存するエントリを作成
    const basePostEntry =
      generatorResult.postEntry || {
        title: article.title,
        date: article.date,
        summary: article.summary ?? '',
        tags: Array.isArray(article.tags) ? article.tags : [],
      };
    const finalizedPostEntry = {
      ...basePostEntry,
      url: relativePath,
      slug: basePostEntry.slug || article.slug,
      image: basePostEntry.image || article.image || null,
    };

    // posts.jsonを更新
    updatedPosts = updatePosts(posts, finalizedPostEntry);
    postsChanged = JSON.stringify(updatedPosts) !== JSON.stringify(posts);
    if (postsChanged) {
      writeJson(postsJsonPath, updatedPosts);
      console.log(`[publisher] data/posts.json を更新しました（${updatedPosts.length}件）。`);
    } else {
      console.log('[publisher] data/posts.json に変化はありませんでした。');
    }
  } else {
    console.log('[publisher] generator出力が無いため、記事作成とposts.json更新をスキップします。');
  }

  // --- バリデーション ---
  const validationWarnings = [];
  // posts.jsonに登録されていない孤立した記事ファイルがないかチェック
  if (VALIDATION?.ORPHAN_POST_CHECK_ENABLED) {
    try {
      const orphanPosts = await findOrphanPosts();
      if (orphanPosts.length > 0) {
        const missing = orphanPosts.map((entry) => entry.url);
        validationWarnings.push({
          type: 'orphan-posts',
          message: 'posts/ ディレクトリ内に data/posts.json へ登録されていない記事があります。',
          files: missing,
        });
        console.warn(
          '[publisher] ⚠️  data/posts.json 未登録の記事ファイルを検出しました:',
          missing.join(', '),
        );
      }
    } catch (error) {
      validationWarnings.push({
        type: 'orphan-posts',
        message: `孤立記事チェックに失敗しました: ${error.message}`,
      });
      console.warn('[publisher] ⚠️  孤立記事チェックに失敗しました:', error.message);
    }
  }

  // 最終的なパイプラインステータスを作成
  const status = {
    status: generatedFilePath ? 'success' : 'skipped',
    generatedFile: generatedFilePath,
    executedAt: new Date().toISOString(),
    collector: collectorResult ?? null,
    researcher: researcherResult ?? null,
    generator: generatorResult ?? null,
    publisher: {
      addedPost: postsChanged,
      totalPosts: updatedPosts.length,
      outputFile: generatedFilePath,
    },
  };
  if (validationWarnings.length > 0) {
    status.validation = {
      warnings: validationWarnings,
    };
  }

  // ステータスをファイルに書き込んで返す
  return writeStatusSnapshot(status);
};

// スクリプトが直接実行された場合にrunPublisherを実行
if (require.main === module) {
  runPublisher({})
    .then((status) => {
      console.log('Publisher finished:', status);
    })
    .catch((error) => {
      console.error('Publisher failed:', error);
      recordFailureStatus(error);
      process.exit(1);
    });
}

module.exports = {
  runPublisher,
  recordFailureStatus,
};