#!/usr/bin/env node
/**
 * @fileoverview タグ移行スクリプト
 * 既存の `data/posts.json` に含まれる記事の `tags` 配列（単なる文字列の配列）を、
 * `data/tags.json` で定義された統一フォーマット（slug, label, categoryなどを持つオブジェクトの配列）に変換します。
 *
 * このスクリプトは、タグのデータ構造を変更する際に一度だけ実行することを想定しています。
 */

const path = require('path');
const { readJson, writeJson } = require('../../automation/lib/io');
const slugify = require('../../automation/lib/slugify');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const postsPath = path.join(root, 'data', 'posts.json');
const tagsConfigPath = path.join(root, 'data', 'tags.json');

/**
 * タグ文字列を比較・検索用に正規化します。
 * @param {*} value - 正規化する値
 * @returns {string} 正規化された文字列
 */
const normalizeToken = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

/**
 * `tags.json` からタグの定義を読み込み、高速検索用のインデックス（Map）を構築します。
 * @param {Array<object>} config - `tags.json` の内容
 * @returns {Map<string, object>} `正規化トークン -> タグオブジェクト` のMap
 */
const buildTagIndex = (config) => {
  const index = new Map();
  const register = (token, entry) => {
    if (!token || index.has(token)) return;
    index.set(token, entry);
  };

  config.forEach((entry) => {
    if (!entry?.slug) return;
    const normalized = {
      slug: entry.slug,
      label: entry.label || entry.slug,
      category: entry.category || 'その他',
      style: entry.style || null,
    };
    register(normalizeToken(entry.slug), normalized);
    register(normalizeToken(entry.label), normalized);
    if (Array.isArray(entry.aliases)) {
      entry.aliases.forEach((alias) => register(normalizeToken(alias), normalized));
    }
  });

  return index;
};

/**
 * 文字列のタグ配列を、タグオブジェクトの配列にマッピングします。
 * @param {Array<string>} tags - 変換元のタグ文字列配列
 * @param {Map<string, object>} tagIndex - `buildTagIndex` で作成した検索用インデックス
 * @returns {Array<object>} 変換後のタグオブジェクト配列
 */
const mapTags = (tags, tagIndex) => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set(); // 重複防止用
  const normalized = [];

  tags.forEach((tag, idx) => {
    const token = normalizeToken(tag);
    if (!token) return;

    // 1. 辞書にマッチするタグを検索
    const match = tagIndex.get(token);
    if (match) {
      if (seen.has(match.slug)) return;
      seen.add(match.slug);
      normalized.push({
        slug: match.slug,
        label: match.label,
        category: match.category,
        style: match.style,
      });
      return;
    }

    // 2. 辞書にない場合は、その場でフォールバック用のタグオブジェクトを生成
    const fallbackBase = slugify(tag, 'tag');
    // スラグが重複しないように連番を付与
    const fallbackSlug =
      seen.has(fallbackBase) || fallbackBase === 'tag'
        ? `${fallbackBase}-${idx + 1}`
        : fallbackBase;
    if (seen.has(fallbackSlug)) return;
    seen.add(fallbackSlug);
    const fallbackLabel = String(tag ?? '').trim() || `タグ${idx + 1}`;
    normalized.push({
      slug: fallbackSlug,
      label: fallbackLabel,
      category: 'その他',
      style: 'accent-neutral',
    });
  });

  return normalized;
};

/**
 * メイン処理
 */
const main = () => {
  console.log('[migrate-tags] タグの移行処理を開始します...');

  // 必要なファイルを読み込み
  const posts = readJson(postsPath, []);
  const tagConfig = readJson(tagsConfigPath, []);

  // タグ検索用インデックスを構築
  const tagIndex = buildTagIndex(Array.isArray(tagConfig) ? tagConfig : []);

  if (!Array.isArray(posts) || posts.length === 0) {
    console.log('[migrate-tags] data/posts.json に変換対象の記事がありません。');
    return;
  }

  // 各記事のtags配列を新しいフォーマットに変換
  const migrated = posts.map((post) => ({
    ...post,
    tags: mapTags(post.tags, tagIndex),
  }));

  // 変換後のデータで `posts.json` を上書き
  writeJson(postsPath, migrated);
  console.log(`[migrate-tags] 完了: ${migrated.length}件の記事のタグを変換しました。`);
};

// スクリプトを実行
main();