#!/usr/bin/env node
/**
 * Generator
 * - Picks researched candidates from data/candidates.json
 * - Calls OpenAI to craft SEO-oriented article drafts
 * - Returns article HTML for publisher and records topic history for deduplication
 */

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('../lib/io');
const slugify = require('../lib/slugify');
const { GENERATOR } = require('../config/constants');
const { ARTICLE_GENERATION } = require('../config/models');
const PROMPTS = require('../config/prompts');
const { callOpenAI } = require('../lib/openai');

const root = path.resolve(__dirname, '..', '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');
const tagsConfigPath = path.join(root, 'data', 'tags.json');
const articleImagesManifestPath = path.join(root, 'assets', 'img', 'articles', 'index.json');
const articleHtmlTemplatePath = path.join(root, 'automation', 'templates', 'article.html');

const { DEDUPE_WINDOW_DAYS } = GENERATOR;

const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : '';

const resolveSourceUrl = (source) => {
  if (!source) return '';
  return source.url || createChannelUrl(source.channelId);
};

const toHtmlParagraphs = (text) => {
  if (!text) return '';
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('\n      ');
};

const formatDateParts = (value) => {
  if (!value) {
    const now = new Date();
    return {
      dotted: '',
      verbose: '',
      year: now.getFullYear(),
    };
  }
  const normalized = value.replace(/\//g, '-');
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return {
      dotted: value,
      verbose: value,
      year: now.getFullYear(),
    };
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    dotted: `${y}.${m}.${d}`,
    verbose: `${y}年${m}月${d}日`,
    year: y,
  };
};

const slugifyHeading = (heading, index = 0) => {
  const base = heading || `section-${index + 1}`;
  const slug = base
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s・、。/]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `section-${index + 1}`;
};

const normalizeTagToken = (value) => {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

const buildTagDictionary = () => {
  const raw = readJson(tagsConfigPath, []);
  const entries = Array.isArray(raw) ? raw : [];
  const index = new Map();

  const registerToken = (token, entry) => {
    if (!token || index.has(token)) return;
    index.set(token, entry);
  };

  entries.forEach((item) => {
    if (!item || !item.slug) return;
    const normalizedEntry = {
      slug: item.slug,
      label: item.label || item.slug,
      category: item.category || 'その他',
      style: item.style || null,
    };
    registerToken(normalizeTagToken(item.slug), normalizedEntry);
    registerToken(normalizeTagToken(item.label), normalizedEntry);
    if (Array.isArray(item.aliases)) {
      item.aliases.forEach((alias) => registerToken(normalizeTagToken(alias), normalizedEntry));
    }
  });

  return { entries, index };
};

const tagDictionary = buildTagDictionary();

const buildArticleImagePool = () => {
  const manifest = readJson(articleImagesManifestPath, []);
  if (!Array.isArray(manifest)) return [];
  return manifest
    .map((item, index) => {
      if (!item || !item.key || !item.src) return null;
      const topics = Array.isArray(item.topics)
        ? item.topics.map((topic) => normalizeTagToken(topic)).filter(Boolean)
        : [];
      return {
        key: item.key,
        src: item.src,
        alt: item.alt || item.label || 'AI情報ブログのビジュアル',
        label: item.label || null,
        description: item.description || null,
        category: normalizeTagToken(item.category) || null,
        topics,
        isDefault: Boolean(item.isDefault) || index === 0,
      };
    })
    .filter(Boolean);
};

const articleImagePool = buildArticleImagePool();
const defaultArticleImage = articleImagePool.find((item) => item.isDefault) || articleImagePool[0] || null;

let cachedArticleTemplate = null;
let articleTemplateLoaded = false;

const escapeRegExp = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const getArticleTemplate = () => {
  if (articleTemplateLoaded) return cachedArticleTemplate;
  try {
    cachedArticleTemplate = fs.readFileSync(articleHtmlTemplatePath, 'utf-8');
  } catch (error) {
    cachedArticleTemplate = null;
    console.warn('[generator] 記事テンプレートの読み込みに失敗しました:', error.message);
  } finally {
    articleTemplateLoaded = true;
  }
  return cachedArticleTemplate;
};

const renderArticleTemplate = (slots) => {
  const template = getArticleTemplate();
  if (!template) return null;
  return Object.entries(slots).reduce((html, [token, value]) => {
    const safeValue = value ?? '';
    const pattern = new RegExp(escapeRegExp(token), 'g');
    return html.replace(pattern, safeValue);
  }, template);
};

const deterministicPickFromPool = (pool, seed = '') => {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const normalizedSeed = seed ? seed.toString() : 'ai-info-blog';
  let hash = 0;
  for (let i = 0; i < normalizedSeed.length; i += 1) {
    hash = (hash * 31 + normalizedSeed.charCodeAt(i)) & 0xffffffff;
  }
  const index = Math.abs(hash) % pool.length;
  return pool[index];
};

const gatherImageTokens = (article, candidate) => {
  const tokens = new Set();
  const pushToken = (value) => {
    const normalized = normalizeTagToken(value);
    if (normalized) tokens.add(normalized);
  };

  if (article?.tags) {
    article.tags.forEach((tag) => {
      if (!tag) return;
      if (typeof tag === 'string') {
        pushToken(tag);
        return;
      }
      pushToken(tag.slug);
      pushToken(tag.label);
      pushToken(tag.category);
    });
  }

  if (candidate?.source?.focus) {
    candidate.source.focus.forEach(pushToken);
  }

  if (candidate?.topicKey) {
    pushToken(candidate.topicKey);
    candidate.topicKey.split(/[-_]+/).forEach(pushToken);
  }

  if (article?.slug) {
    pushToken(article.slug);
    article.slug.split(/[-_]+/).forEach(pushToken);
  }

  const injectFromTitle = (title) => {
    if (!title) return;
    title
      .split(/[\s・／/、。:+\-]+/)
      .map((token) => token.trim())
      .forEach(pushToken);
  };

  injectFromTitle(article?.title);
  injectFromTitle(candidate?.video?.title);

  return tokens;
};

const selectArticleImage = (article, candidate) => {
  if (!articleImagePool.length) return null;
  const tokens = gatherImageTokens(article, candidate);
  const matched = articleImagePool.filter((entry) => {
    if (!entry) return false;
    if (entry.topics.some((topic) => tokens.has(topic))) return true;
    if (entry.category && tokens.has(entry.category)) return true;
    return false;
  });
  const seed = candidate?.topicKey || article?.slug || article?.title || candidate?.id || 'ai-info';
  const pool = matched.length > 0 ? matched : articleImagePool;
  const picked = deterministicPickFromPool(pool, seed) || defaultArticleImage;
  if (!picked) return null;
  return {
    key: picked.key,
    src: picked.src,
    alt: picked.alt,
    label: picked.label,
    caption: picked.description || picked.label || '',
    category: picked.category,
  };
};

const mapArticleTags = (rawTags) => {
  if (!Array.isArray(rawTags) || rawTags.length === 0) return [];
  const seen = new Set();
  const tags = [];

  rawTags.forEach((tag, idx) => {
    const token = normalizeTagToken(tag);
    if (!token) return;

    const matched = tagDictionary.index.get(token);
    if (matched) {
      if (seen.has(matched.slug)) return;
      seen.add(matched.slug);
      tags.push({
        slug: matched.slug,
        label: matched.label || matched.slug,
        category: matched.category || 'その他',
        style: matched.style || null,
      });
      return;
    }

    // タグ辞書にマッチしない場合: ユニークなslugを生成
    const originalLabel = (tag ?? '').toString().trim();
    if (!originalLabel) return;

    const fallbackBase = slugify(originalLabel, 'tag');
    let fallbackSlug = fallbackBase;

    // slug重複を完全に回避: 既存のslugと衝突しないようにインデックスを付与
    if (fallbackBase === 'tag' || seen.has(fallbackBase)) {
      // 重複する場合は元のラベルを含むユニークなslugを生成
      const sanitizedLabel = originalLabel
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      fallbackSlug = sanitizedLabel || `tag-${idx + 1}`;

      // さらに重複する場合は番号を追加
      let counter = 1;
      let candidateSlug = fallbackSlug;
      while (seen.has(candidateSlug)) {
        candidateSlug = `${fallbackSlug}-${counter}`;
        counter += 1;
      }
      fallbackSlug = candidateSlug;
    }

    if (seen.has(fallbackSlug)) return;
    seen.add(fallbackSlug);

    tags.push({
      slug: fallbackSlug,
      label: originalLabel || `タグ${idx + 1}`,
      category: 'その他',
      style: 'accent-neutral',
    });
  });

  return tags;
};

const compileArticleHtml = (article, meta, options = {}) => {
  const assetBase = typeof options.assetBase === 'string' ? options.assetBase : '../';
  const normalizedAssetBase = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  const cssHref = `${normalizedAssetBase}assets/css/style.css`;
  const mainJsSrc = `${normalizedAssetBase}assets/js/main.js`;
  const articleJsSrc = `${normalizedAssetBase}assets/js/article.js`;

  const sections = Array.isArray(article.sections) ? article.sections : [];
  const tags = Array.isArray(article.tags) ? article.tags : [];

  const dateParts = formatDateParts(meta.date);
  const displayDate = dateParts.dotted || meta.date || '';
  const verboseDate = dateParts.verbose || meta.date || '';
  const heroImage = (meta && meta.image) || options.image || null;
  const heroImageSrc = heroImage?.src ? `${normalizedAssetBase}${heroImage.src}` : null;
  const socialImage = heroImageSrc || `${normalizedAssetBase}assets/img/ogp-default.svg`;

  const renderTagList = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return '';
    }
    const tagItems = items
      .map((tagItem) => {
        if (!tagItem) return '';
        if (typeof tagItem === 'string') {
          const fallbackSlug = slugify(tagItem, 'tag');
          return `<li class="tag" data-tag-slug="${fallbackSlug}">${tagItem}</li>`;
        }
        const label = tagItem.label || tagItem.slug || '';
        if (!label) return '';
        const slugAttr = tagItem.slug ? ` data-tag-slug="${tagItem.slug}"` : '';
        const categoryAttr = tagItem.category ? ` data-tag-category="${tagItem.category}"` : '';
        const styleAttr = tagItem.style ? ` data-tag-style="${tagItem.style}"` : '';
        return `<li class="tag"${slugAttr}${categoryAttr}${styleAttr}>${label}</li>`;
      })
      .filter(Boolean)
      .join('\n          ');
    if (!tagItems) return '';
    return `<ul class="article-tags">
          ${tagItems}
        </ul>`;
  };

  const tagMarkup = renderTagList(tags);

  const renderMetaGrid = () => {
    const cards = [];
    if (verboseDate || displayDate) {
      cards.push(`
          <article class="meta-card">
            <p class="meta-label">公開日</p>
            <p class="meta-value">${verboseDate || displayDate}</p>
            ${displayDate ? `<small>最終更新: ${displayDate}</small>` : ''}
          </article>`);
    }

    if (meta?.sourceName || meta?.sourceUrl) {
      const label = meta.sourceName || 'リサーチソース';
      const link = meta.sourceUrl
        ? `<a href="${meta.sourceUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label;
      cards.push(`
          <article class="meta-card">
            <p class="meta-label">リサーチソース</p>
            <p class="meta-value">${link}</p>
            ${meta.sourceUrl ? '<small>外部リンク</small>' : ''}
          </article>`);
    }

    if (meta?.videoUrl) {
      const videoLabel = meta.videoTitle || '参照動画を再生';
      cards.push(`
          <article class="meta-card">
            <p class="meta-label">参照動画</p>
            <p class="meta-value"><a href="${meta.videoUrl}" target="_blank" rel="noopener noreferrer">${videoLabel}</a></p>
            <small>YouTube</small>
          </article>`);
    }

    if (!cards.length) return '';

    return `
        <div class="article-meta-grid">
${cards.join('\n')}
        </div>`;
  };

  const metaGridMarkup = renderMetaGrid();

  const shareLinksMarkup = `
        <div class="article-share-links">
          <a class="share-link" href="#" data-share-target="x" aria-label="Xで共有">Xに共有</a>
          <a class="share-link" href="#" data-share-target="linkedin" aria-label="LinkedInで共有">LinkedIn</a>
          <button class="share-link" type="button" data-share-target="native">端末で共有</button>
          <button class="share-link copy-link" type="button" data-copy-link>リンクをコピー</button>
        </div>`;

  // 広告ブロックのテンプレート（コメントアウト状態）
  const adTopMarkup = `
      <!-- Google AdSense: 記事上広告 -->
      <!--
      <div class="inner">
        <div class="ad-container ad-article-top">
          <span class="ad-label">広告</span>
          <ins class="adsbygoogle"
               style="display:block"
               data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
               data-ad-slot="YYYYYYYYYY"
               data-ad-format="auto"
               data-full-width-responsive="true"></ins>
          <script>
            (adsbygoogle = window.adsbygoogle || []).push({});
          </script>
        </div>
      </div>
      -->
`;

  const adMiddleMarkup = `
            <!-- Google AdSense: 記事中広告 -->
            <!--
            <div class="ad-container ad-article-middle">
              <span class="ad-label">広告</span>
              <ins class="adsbygoogle"
                   style="display:block"
                   data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
                   data-ad-slot="YYYYYYYYYY"
                   data-ad-format="rectangle"></ins>
              <script>
                (adsbygoogle = window.adsbygoogle || []).push({});
              </script>
            </div>
            -->
`;

  const adBottomMarkup = `
      <!-- Google AdSense: 記事下広告 -->
      <!--
      <div class="inner">
        <div class="ad-container ad-article-bottom">
          <span class="ad-label">広告</span>
          <ins class="adsbygoogle"
               style="display:block"
               data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
               data-ad-slot="YYYYYYYYYY"
               data-ad-format="auto"
               data-full-width-responsive="true"></ins>
          <script>
            (adsbygoogle = window.adsbygoogle || []).push({});
          </script>
        </div>
      </div>
      -->
`;

  const renderSubSections = (subSections = [], parentIndex = 0) => {
    if (!Array.isArray(subSections) || subSections.length === 0) {
      return '';
    }
    return subSections
      .map((subSection, childIndex) => {
        const heading = subSection.heading || `ポイント${parentIndex + 1}-${childIndex + 1}`;
        const body = toHtmlParagraphs(subSection.body || subSection.content || '');
        if (!body) return '';
        return `
              <div class="article-subsection">
                <h3 class="subsection-heading">${heading}</h3>
                <div class="subsection-body">
                  ${body}
                </div>
              </div>`;
      })
      .filter(Boolean)
      .join('\n');
  };

  const sectionMarkup = sections
    .map((section, index) => {
      const heading = section.heading ?? `セクション${index + 1}`;
      const slug = slugifyHeading(heading, index);
      const overview = toHtmlParagraphs(section.overview || section.body || '');
      const subSections = renderSubSections(section.subSections, index);
      const overviewMarkup = overview ? `<div class="section-overview">${overview}</div>` : '';

      // 記事中広告を最初のセクションの後に挿入
      const adInsert = index === 0 ? adMiddleMarkup : '';

      return `
            <section class="article-section" id="${slug}">
              <h2 class="section-heading">${heading}</h2>
              ${overviewMarkup}
              ${subSections}
            </section>${adInsert}`;
    })
    .join('\n');

  const introMarkup = article.intro
    ? `
        <section class="article-intro-block">
          <div class="intro-content">
${toHtmlParagraphs(article.intro)}
          </div>
        </section>`
    : '';

  const conclusionMarkup = article.conclusion
    ? `
      <section class="article-conclusion inner">
        <h2 class="conclusion-heading">まとめ</h2>
        <div class="conclusion-content">
${toHtmlParagraphs(article.conclusion)}
        </div>
      </section>`
    : '';

  const summaryText = article.summary ?? '';
  const publishedTimeIso = displayDate ? `${displayDate}T00:00:00+09:00` : new Date().toISOString();

  const templateSlots = {
    '{{ASSET_BASE}}': normalizedAssetBase,
    '{{TITLE}}': article.title,
    '{{SUMMARY}}': summaryText,
    '{{SOCIAL_IMAGE}}': socialImage,
    '{{PUBLISHED_AT_ISO}}': publishedTimeIso,
    '{{DISPLAY_DATE}}': displayDate,
    '{{TAG_MARKUP}}': tagMarkup,
    '{{META_GRID}}': metaGridMarkup,
    '{{SHARE_LINKS}}': shareLinksMarkup,
    '{{AD_TOP}}': adTopMarkup,
    '{{INTRO_MARKUP}}': introMarkup,
    '{{SECTION_MARKUP}}': sectionMarkup,
    '{{AD_BOTTOM}}': adBottomMarkup,
    '{{CONCLUSION_MARKUP}}': conclusionMarkup,
  };

  const templatedHtml = renderArticleTemplate(templateSlots);
  if (templatedHtml) {
    return templatedHtml;
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} | AI情報ブログ</title>
  <meta name="description" content="${summaryText}">

  <script src="${normalizedAssetBase}assets/js/analytics.js"></script>

  <!-- Google AdSense -->
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX"
       crossorigin="anonymous"></script>

  <!-- ファビコン -->
  <link rel="icon" type="image/svg+xml" href="${normalizedAssetBase}assets/img/logo.svg">
  <link rel="apple-touch-icon" href="${normalizedAssetBase}assets/img/logo.svg">

  <!-- Open Graph / SNS共有 -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${article.title} | AI情報ブログ">
  <meta property="og:description" content="${summaryText}">
  <meta property="og:image" content="${socialImage}">
  <meta property="og:site_name" content="AI情報ブログ">
  <meta property="og:locale" content="ja_JP">
  <meta property="article:published_time" content="${publishedTimeIso}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${article.title} | AI情報ブログ">
  <meta name="twitter:description" content="${summaryText}">
  <meta name="twitter:image" content="${socialImage}">

  <link rel="stylesheet" href="${cssHref}">
</head>
<body class="article-page">
  <!-- ヘッダーはcomponents.jsで動的に挿入されます -->

  <main>
    <article class="article-detail">
      <section class="inner article-hero">
        <p class="article-eyebrow">Daily Briefing</p>
        <div class="article-hero-layout">
          <div class="article-hero-main">
            <p class="post-meta">${displayDate}</p>
            <h1>${article.title}</h1>
            <p class="article-summary">${summaryText}</p>
          </div>
        </div>

        ${tagMarkup}
      </section>

      ${adTopMarkup}

      <div class="inner article-grid">
        <div class="article-main-column">
          <article class="post-article article-content">
${introMarkup}
${sectionMarkup}
          </article>
        </div>

        <aside class="article-sidebar" aria-label="補足情報">
          <section class="article-card article-toc">
            <p class="article-card-label">目次</p>
            <ol class="toc-list" data-toc-list aria-live="polite"></ol>
          </section>
        </aside>
      </div>

      ${adBottomMarkup}

      ${conclusionMarkup}
    </article>
  </main>

  <!-- フッターはcomponents.jsで動的に挿入されます -->

  <script src="${normalizedAssetBase}assets/js/components.js"></script>
  <script src="${mainJsSrc}" defer></script>
  <script src="${articleJsSrc}" defer></script>
</body>
</html>`;
};

const parseCompletionContent = (content) => {
  if (!content) {
    throw new Error('OpenAIレスポンスにcontentが含まれていません');
  }
  if (typeof content === 'string') {
    return JSON.parse(content);
  }
  if (Array.isArray(content)) {
    const merged = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
    return JSON.parse(merged);
  }
  throw new Error('contentの形式を解析できませんでした');
};

const extractSearchQuery = (candidate) => {
  // 新しい構造: { original, extracted, method }
  if (candidate.searchQuery && typeof candidate.searchQuery === 'object') {
    return candidate.searchQuery.extracted || candidate.searchQuery.original || '';
  }
  // 旧構造: 文字列
  if (typeof candidate.searchQuery === 'string') {
    return candidate.searchQuery;
  }
  // フォールバック
  return candidate.video?.title || '';
};

const formatSearchSummaries = (summaries) => {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '検索要約が取得できていません。';
  }
  return summaries
    .map((item, index) => {
      const title = item.title || `Source ${index + 1}`;
      const url = item.url || 'URLなし';
      const summary = item.summary || item.snippet || '要約なし';
      const snippet = item.snippet ? `\nスニペット: ${item.snippet}` : '';
      return `### ソース${index + 1}\nタイトル: ${title}\nURL: ${url}\n要約: ${summary}${snippet}`;
    })
    .join('\n\n');
};

const requestArticleDraft = async (apiKey, candidate) => {
  const today = new Date().toISOString().split('T')[0];
  const searchSummary = formatSearchSummaries(candidate.searchSummaries);
  const searchQuery = extractSearchQuery(candidate);

  const messages = [
    {
      role: 'system',
      content: PROMPTS.ARTICLE_GENERATION.system,
    },
    {
      role: 'user',
      content: PROMPTS.ARTICLE_GENERATION.user(candidate, searchSummary, searchQuery, today),
    },
  ];

  const completion = await callOpenAI({
    apiKey,
    messages,
    model: ARTICLE_GENERATION.model,
    temperature: ARTICLE_GENERATION.temperature,
    responseFormat: ARTICLE_GENERATION.response_format,
  });

  const content = completion?.choices?.[0]?.message?.content;
  return parseCompletionContent(content);
};

const isDuplicateTopic = (topicKey, posts, history) => {
  const now = Date.now();
  const windowMs = DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  const inPosts = posts.some((post) => slugify(post.title) === topicKey);
  if (inPosts) return true;

  return history.some((entry) => {
    if (entry.topicKey !== topicKey) return false;
    const last = new Date(entry.lastPublishedAt || entry.firstSeen).getTime();
    return !Number.isNaN(last) && last >= cutoff;
  });
};

const updateTopicHistory = (history, topicKey, record) => {
  const filtered = history.filter((entry) => entry.topicKey !== topicKey);
  const now = new Date().toISOString();
  filtered.push({
    topicKey,
    firstSeen: record.firstSeen || now,
    lastPublishedAt: record.lastPublishedAt || now,
    sourceName: record.sourceName,
    videoTitle: record.videoTitle,
    draftUrl: record.draftUrl,
  });
  return filtered;
};

const runGenerator = async () => {
  console.log('[generator] ステージ開始: 候補の分析を実行します。');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readJson(candidatesPath, []);
  const posts = readJson(postsJsonPath, []);
  const topicHistory = readJson(topicHistoryPath, []);

  const candidate = candidates.find((item) => item.status === 'researched');
  if (!candidate) {
    console.log('[generator] researched状態の候補が存在しないため処理を終了します。');
    return {
      generated: false,
      reason: 'no-researched-candidates',
    };
  }

  console.log(
    `[generator] 対象候補: ${candidate.id} / ${candidate.source.name} / ${candidate.video?.title}`,
  );
  const sourceUrl = resolveSourceUrl(candidate.source);
  const fallbackTopicKey = slugify(candidate.video?.title);
  const topicKey = candidate.topicKey || fallbackTopicKey;
  if (candidate.topicKey) {
    console.log(`[generator] トピックキー: ${topicKey}`);
  } else {
    console.log(
      `[generator] ⚠️ topicKey未設定のため動画タイトルから生成しました: ${topicKey}`,
    );
  }
  const duplicate = isDuplicateTopic(topicKey, posts, topicHistory);
  console.log(`[generator] 重複判定: ${duplicate ? '重複あり → スキップ' : '新規トピック'}`);

  if (duplicate) {
    const now = new Date().toISOString();
    const updatedCandidates = candidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            status: 'skipped',
            skipReason: 'duplicate-topic',
            updatedAt: now,
          }
        : item,
    );
    writeJson(candidatesPath, updatedCandidates);
    return {
      generated: false,
      reason: 'duplicate-topic',
      candidateId: candidate.id,
    };
  }

  const searchSummaries = Array.isArray(candidate.searchSummaries)
    ? candidate.searchSummaries
    : [];
  if (searchSummaries.length === 0) {
    console.log(
      '[generator] ⚠️ Google検索の上位記事要約がありませんが、動画情報のみで記事生成を試みます。',
    );
  }

  const enrichedCandidate = {
    ...candidate,
    searchSummaries,
  };

  let article;
  try {
    article = await requestArticleDraft(apiKey, enrichedCandidate);
    console.log(`[generator] OpenAI応答を受信: "${article.title}"`);
  } catch (error) {
    console.error(`[generator] ⚠️ 記事生成に失敗しました: ${error.message}`);
    const now = new Date().toISOString();
    const updatedCandidates = candidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            status: 'failed',
            failReason: 'article-generation-error',
            errorMessage: error.message,
            updatedAt: now,
          }
        : item,
    );
    writeJson(candidatesPath, updatedCandidates);
    return {
      generated: false,
      reason: 'article-generation-failed',
      candidateId: candidate.id,
      error: error.message,
    };
  }

  const normalizedTags = mapArticleTags(article.tags);
  const hydratedArticle = {
    ...article,
    tags: normalizedTags,
  };
  const selectedImage = selectArticleImage(hydratedArticle, candidate);

  const today = new Date().toISOString().split('T')[0];
  const slugifiedTitle = slugify(article.title, topicKey || 'ai-topic');
  const slug = `${today}-${slugifiedTitle}`;
  const fileName = `${slug}.html`;
  const publishRelativePath = path.posix.join('posts', fileName);

  const meta = {
    date: today,
    sourceName: candidate.source.name,
    sourceUrl,
    videoUrl: candidate.video.url,
    videoTitle: candidate.video.title,
    image: selectedImage,
  };

  const publishHtml = compileArticleHtml(hydratedArticle, meta, {
    assetBase: '../',
    image: selectedImage,
  });

  const now = new Date().toISOString();

  const updatedCandidates = candidates.map((item) =>
    item.id === candidate.id
      ? {
          ...item,
          status: 'generated',
          generatedAt: now,
          updatedAt: now,
          topicKey,
          postDate: today,
          slug,
          outputFile: publishRelativePath,
          image: selectedImage || null,
          imageKey: selectedImage?.key || null,
        }
      : item,
  );
  writeJson(candidatesPath, updatedCandidates);

  const updatedHistory = updateTopicHistory(topicHistory, topicKey, {
    sourceName: candidate.source.name,
    videoTitle: candidate.video.title,
    draftUrl: publishRelativePath,
    lastPublishedAt: today,
  });
  writeJson(topicHistoryPath, updatedHistory);
  console.log('[generator] candidates と topic-history を更新しました。');

  const postEntry = {
    title: hydratedArticle.title,
    date: today,
    summary: hydratedArticle.summary ?? '',
    tags: normalizedTags,
    url: publishRelativePath,
    slug,
    publishedAt: now,
    image: selectedImage || null,
  };

  const articleData = {
    title: hydratedArticle.title,
    summary: hydratedArticle.summary ?? '',
    intro: hydratedArticle.intro ?? '',
    conclusion: hydratedArticle.conclusion ?? '',
    tags: normalizedTags,
    sections: Array.isArray(hydratedArticle.sections) ? hydratedArticle.sections : [],
    slug,
    date: today,
    htmlContent: publishHtml,
    relativePath: publishRelativePath,
    image: selectedImage || null,
    source: {
      name: candidate.source.name,
      url: sourceUrl,
    },
    video: {
      title: candidate.video.title,
      url: candidate.video.url,
    },
    searchSummaries,
  };

  console.log(
    `[generator] 記事データを返却: slug=${slug}, ファイル予定パス=${publishRelativePath}`,
  );

  return {
    generated: true,
    candidateId: candidate.id,
    postEntry,
    draftUrl: publishRelativePath,
    topicKey,
    article: articleData,
  };
};

if (require.main === module) {
  runGenerator()
    .then((result) => {
      console.log('Generator finished:', result);
    })
    .catch((error) => {
      console.error('Generator failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runGenerator,
};
