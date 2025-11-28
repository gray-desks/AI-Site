#!/usr/bin/env node
/**
 * @fileoverview Generator: 記事生成ステージ
 * - Researcherで採用された動画候補（字幕付き）を元に記事を生成します。
 * - OpenAI API を呼び出し、SEOを意識した記事の下書きをJSON形式で生成させます。
 * - 生成された記事データとテンプレートを組み合わせて、公開用のHTMLファイルを作成します。
 * - 記事のトピックが最近公開されたものと重複していないかチェックします。
 * - 候補のステータスを `generated` に更新し、次のPublisherステージに渡します。
 */

const path = require('path');
const { readJson, writeJson } = require('../lib/io');
const slugify = require('../lib/slugify');
const { GENERATOR } = require('../config/constants');
const { ARTICLE_GENERATION } = require('../config/models');
const ARTICLE_GENERATION_PROMPT = require('../prompts/articleGeneration');
const { callOpenAI } = require('../lib/openai');
const { readCandidates, writeCandidates } = require('../lib/candidatesRepository');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker } = require('../lib/metrics');
const { createTagMapper } = require('./services/tagMapper');
const { createImageSelector } = require('./services/imageSelector');
const { createTemplateRenderer } = require('./services/templateRenderer');

// --- パス設定 ---
// プロジェクトのルートディレクトリを取得
const root = path.resolve(__dirname, '..', '..');
// 公開済み記事リストのパス
const postsJsonPath = path.join(root, 'data', 'posts.json');
// トピック履歴のパス
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');
// タグ定義ファイルのパス
const tagsConfigPath = path.join(root, 'data', 'tags.json');
// 記事画像リストのパス
const articleImagesManifestPath = path.join(root, 'assets', 'img', 'articles', 'index.json');
// 記事HTMLテンプレートのパス
// 記事HTMLテンプレートのパス
const articleHtmlTemplatePath = path.join(root, 'automation', 'templates', 'article.html');
// レイアウトテンプレートのパス
const layoutHtmlTemplatePath = path.join(root, 'automation', 'templates', 'layout.html');

// --- 定数 ---
const { DEDUPE_WINDOW_DAYS } = GENERATOR;
// ロガーとメトリクス追跡ツールを初期化
const logger = createLogger('generator');
const metricsTracker = createMetricsTracker('generator');

// --- サービス初期化 ---
// タグマッピングサービス: AIが生成したタグを正規化する
const { mapArticleTags } = createTagMapper({
  readJson,
  tagsConfigPath,
});

// 画像選択サービス: 記事内容に合った画像を自動で選ぶ
const { selectArticleImage } = createImageSelector({
  readJson,
  manifestPath: articleImagesManifestPath,
});

// テンプレートレンダリングサービス: 記事データからHTMLを生成する
const { compileArticleHtml } = createTemplateRenderer({
  templatePath: articleHtmlTemplatePath,
  layoutPath: layoutHtmlTemplatePath,
});

/**
 * 生成された記事オブジェクトの簡易バリデーション
 * 必須フィールドや最低長を満たさない場合はエラーを投げ、再試行用にキーワードを戻せるようにする。
 */
const validateArticlePayload = (article) => {
  if (!article || typeof article !== 'object') {
    throw new Error('article payload is empty or invalid');
  }
  const totalLength =
    (article.intro || '').length +
    (article.conclusion || '').length +
    (Array.isArray(article.sections)
      ? article.sections.reduce((acc, sec) => {
        const bodySum = Array.isArray(sec.subSections)
          ? sec.subSections.reduce((bAcc, sub) => bAcc + (sub.body || '').length, 0)
          : 0;
        return acc + (sec.heading || '').length + bodySum;
      }, 0)
      : 0);

  if (!article.title || article.title.length < 10) {
    throw new Error('article title too short');
  }
  if (!article.summary || article.summary.length < 100) {
    throw new Error('article summary too short');
  }
  if (!article.intro || article.intro.length < 300) {
    throw new Error('article intro too short');
  }
  if (!Array.isArray(article.sections) || article.sections.length === 0) {
    throw new Error('article sections missing');
  }
  const hasValidSection = article.sections.some((sec) =>
    Array.isArray(sec.subSections) &&
    sec.subSections.some((sub) => (sub.body || '').length >= 200),
  );
  if (!hasValidSection) {
    throw new Error('article sections too thin');
  }
  if (totalLength < 1800) {
    throw new Error('article total length too short');
  }
};

/**
 * チャンネルIDからYouTubeチャンネルURLを生成します。
 * @param {string} channelId - YouTubeチャンネルID
 * @returns {string} チャンネルURL
 */
const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : '';

/**
 * 候補のソース情報からURLを解決します。
 * @param {object} source - 候補のソースオブジェクト
 * @returns {string} ソースのURL
 */
const resolveSourceUrl = (source) => {
  if (!source) return '';
  // source.urlが存在すればそれを使い、なければチャンネルIDから生成
  return source.url || createChannelUrl(source.channelId);
};

/**
 * OpenAIからのレスポンス（JSON文字列）をパースします。
 * @param {string|Array} content - OpenAIの`message.content`
 * @returns {object} パースされたJSONオブジェクト
 * @throws {Error} パースに失敗した場合
 */
const parseCompletionContent = (content) => {
  if (!content) {
    throw new Error('OpenAIレスポンスにcontentが含まれていません');
  }
  // contentが文字列の場合、そのままパース
  if (typeof content === 'string') {
    return JSON.parse(content);
  }
  // ストリーミングなどでcontentが配列の場合を考慮
  if (Array.isArray(content)) {
    // 配列の各要素を結合して1つのJSON文字列にする
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

/**
 * 記事生成プロンプトに渡すソース情報を組み立てます。
 * @param {object} candidate - 候補オブジェクト
 * @returns {string} 整形された文字列
 */
const buildSourceMaterial = (candidate) => {
  const blocks = [];
  if (candidate.transcript) {
    blocks.push(`【Transcript 抜粋】\n${candidate.transcript}`);
  }
  if (candidate.video?.description) {
    blocks.push(`【Video Description】\n${candidate.video.description}`);
  }
  if (candidate.themeCheck?.reason) {
    const matched = candidate.themeCheck?.matchedTitle
      ? ` / matched: ${candidate.themeCheck.matchedTitle}`
      : '';
    blocks.push(`【テーマ重複チェック】${candidate.themeCheck.reason}${matched}`);
  }
  return blocks.join('\n\n') || '情報が十分に取得できていません。';
};

/**
 * OpenAI APIにリクエストを送り、記事の下書きを生成します。
 * @param {string} apiKey - OpenAI APIキー
 * @param {object} candidate - 記事の元となる候補データ
 * @returns {Promise<object>} 生成された記事データ (JSON)
 */
const requestArticleDraft = async (apiKey, candidate, { forceLongSummary = false, forceLongIntro = false } = {}) => {
  const today = new Date().toISOString().split('T')[0];
  const sourceMaterial = buildSourceMaterial(candidate);

  // プロンプトを組み立てる
  const messages = [
    {
      role: 'system',
      content: ARTICLE_GENERATION_PROMPT.system,
    },
    {
      role: 'user',
      content: ARTICLE_GENERATION_PROMPT.user(candidate, sourceMaterial, today, {
        forceLongSummary,
        forceLongIntro,
      }),
    },
  ];

  // OpenAI APIを呼び出す（フォールバックモデル付き）
  // 注意: この処理は1回のみ実行されます。リトライはしません。
  const completion = await callOpenAI({
    apiKey,
    messages,
    model: ARTICLE_GENERATION.model,
    fallbackModel: ARTICLE_GENERATION.fallbackModel,
    temperature: ARTICLE_GENERATION.temperature,
    responseFormat: ARTICLE_GENERATION.response_format,
  });

  const content = completion?.choices?.[0]?.message?.content;
  // レスポンスをパースして返す
  return parseCompletionContent(content);
};

/**
 * 指定されたトピックキーが最近公開された記事と重複していないかチェックします。
 * @param {string} topicKey - チェックするトピックキー
 * @param {Array<object>} posts - 公開済み記事のリスト
 * @param {Array<object>} history - トピック履歴
 * @returns {boolean} 重複していればtrue
 */
const isDuplicateTopic = (topicKey, posts, history) => {
  const now = Date.now();
  // 重複チェック期間を計算
  const windowMs = DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  // 1. 公開済み記事リストに同じトピックキーがないか確認
  const inPosts = posts.some((post) => slugify(post.title) === topicKey);
  if (inPosts) return true;

  // 2. トピック履歴内で、指定期間内に同じトピックキーが公開されていないか確認
  return history.some((entry) => {
    if (entry.topicKey !== topicKey) return false;
    const last = new Date(entry.lastPublishedAt || entry.firstSeen).getTime();
    // 最終公開日時がチェック期間内であれば重複とみなす
    return !Number.isNaN(last) && last >= cutoff;
  });
};

/**
 * トピック履歴を更新します。
 * @param {Array<object>} history - 現在のトピック履歴
 * @param {string} topicKey - 更新するトピックキー
 * @param {object} record - 関連情報
 * @returns {Array<object>} 更新されたトピック履歴
 */
const updateTopicHistory = (history, topicKey, record) => {
  // 既存の履歴から同じトピックキーのエントリを削除
  const filtered = history.filter((entry) => entry.topicKey !== topicKey);
  const now = new Date().toISOString();
  // 新しいエントリを追加
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

/**
 * Generatorステージのメイン処理
 *
 * @param {object|null} input - Researcherで採用された候補オブジェクト（{ candidate })。
 *                              未指定の場合は candidates.json から status='researched' を探す。
 */
const runGenerator = async (input = null) => {
  logger.info('ステージ開始: 候補の分析を実行します。');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  // 処理結果を返すためのヘルパー関数
  const buildResult = (payload) => {
    const summary = metricsTracker.summary();
    logger.info('Generatorメトリクスサマリー:', summary);
    return {
      ...payload,
      metrics: summary,
    };
  };

  const posts = readJson(postsJsonPath, []);
  const topicHistory = readJson(topicHistoryPath, []);
  const allCandidates = readCandidates();
  let candidates = Array.isArray(allCandidates) ? allCandidates : [];
  let candidate = null;
  let mode = input?.mode || 'auto';

  if (input && typeof input === 'object' && input.candidate) {
    candidate = input.candidate;
    // candidates.json に保存されている最新版があればマージ
    const stored = candidates.find((item) => item.id === candidate.id);
    if (stored) {
      candidate = { ...stored, ...candidate };
    }
  } else if (!input) {
    logger.info('candidates.json から候補を読み込みます。');
    candidates = Array.isArray(allCandidates) ? allCandidates : [];
    metricsTracker.set('candidates.total', candidates.length);
    candidate = candidates.find((item) => item.status === 'researched');
  } else if (input && input.keyword) {
    // 後方互換: キーワードのみ渡された場合の簡易モード
    mode = 'manual';
    logger.info('キーワード入力から候補を生成します（簡易モード）。');
    const now = new Date().toISOString();
    const topicKey = slugify(input.keyword, 'ai-topic');
    candidate = {
      id: `manual-${Date.now()}`,
      status: 'researched',
      topicKey,
      video: {
        title: input.keyword,
        url: '',
        description: '',
      },
      source: {
        name: 'Manual Input',
        url: '',
        channelId: '',
      },
      transcript: input.transcript || '',
      researchedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    candidates = [];
    metricsTracker.set('candidates.total', 1);
  }

  const isManualMode = mode === 'manual';

  if (!candidate) {
    logger.info('researched状態の候補が存在しないため処理を終了します。');
    return buildResult({
      generated: false,
      reason: 'no-researched-candidates',
    });
  }

  metricsTracker.set('candidates.total', candidates.length || 1);
  metricsTracker.increment('candidates.analyzed');

  const sourceName = candidate.source?.name || 'Unknown Source';
  logger.info(`対象候補: ${candidate.id} / ${sourceName} / ${candidate.video?.title}`);
  const sourceUrl = resolveSourceUrl(candidate.source);
  // トピックキーが存在しない場合のフォールバック
  const fallbackTopicKey = slugify(candidate.video?.title);
  const topicKey = candidate.topicKey || fallbackTopicKey;
  if (candidate.topicKey) {
    logger.info(`トピックキー: ${topicKey}`);
  } else {
    logger.warn(`⚠️ topicKey未設定のため動画タイトルから生成しました: ${topicKey}`);
  }

  // --- トピックの重複チェック ---
  const duplicate = isDuplicateTopic(topicKey, posts, topicHistory);
  logger.info(`重複判定: ${duplicate ? '重複あり → スキップ' : '新規トピック'}`);

  if (duplicate) {
    metricsTracker.increment('candidates.skipped.duplicate');
    const now = new Date().toISOString();

    // candidates.json の更新（従来モードのみ）
    if (!isManualMode) {
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
      writeCandidates(updatedCandidates);
    }

    return buildResult({
      generated: false,
      reason: 'duplicate-topic',
      candidateId: candidate.id,
    });
  }

  if (!candidate.transcript) {
    logger.warn('⚠️ 字幕テキストがないため、動画説明のみで記事生成を試みます。');
  } else {
    logger.info(`[source] transcript length: ${candidate.transcript.length} chars`);
  }

  // --- 記事生成 ---
  const stopDraftTimer = metricsTracker.startTimer('articleGeneration.timeMs');
  let article;
  let attempts = 0;
  const maxAttempts = 2; // バリデーション失敗時に1回だけ再生成

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      article = await requestArticleDraft(apiKey, candidate, {
        forceLongSummary: attempts >= 2,
        forceLongIntro: attempts >= 2,
      });
      validateArticlePayload(article);
      const elapsed = stopDraftTimer();
      metricsTracker.increment('articles.generated');
      logger.info(`OpenAI応答を受信: "${article.title}" (${elapsed}ms) (attempt ${attempts})`);
      break;
    } catch (error) {
      const elapsed = stopDraftTimer();
      logger.warn(`⚠️ 記事生成リトライ対象: ${error.message} (${elapsed}ms) / attempt ${attempts}`);
      if (attempts >= maxAttempts) {
        metricsTracker.increment('articles.failed');

        // candidates.json の更新（従来モードのみ）
        if (!isManualMode) {
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
          writeCandidates(updatedCandidates);
        }

        return buildResult({
          generated: false,
          reason: 'article-generation-failed',
          candidateId: candidate.id,
          error: error.message,
        });
      }
    }
  }

  // --- 記事データの後処理 ---
  const normalizedTags = mapArticleTags(article.tags); // タグを正規化
  if (DEFAULT_POST_STATUS !== 'published') {
    // 下書き扱いの場合は #下書き タグを追加
    const hasDraftTag = normalizedTags.some((tag) => {
      const slug = typeof tag === 'object' ? tag.slug : tag;
      return slug === 'draft' || slug === '下書き';
    });
    if (!hasDraftTag) {
      normalizedTags.push({ slug: 'draft', label: '下書き', category: '運用', style: 'accent-gold' });
    }
  }
  const hydratedArticle = {
    ...article,
    tags: normalizedTags,
  };
  const selectedImage = selectArticleImage(hydratedArticle, candidate); // 画像を選択

  // --- ファイルパスとメタデータ生成 ---
  const today = new Date().toISOString().split('T')[0];
  const slugifiedTitle = slugify(article.title, topicKey || 'ai-topic');
  const slug = `${today}-${slugifiedTitle}`;
  const fileName = `${slug}.html`;
  const publishRelativePath = path.posix.join('posts', fileName);

  // HTMLテンプレートに渡すメタデータ
  const meta = {
    date: today,
    sourceName,
    sourceUrl,
    videoUrl: candidate.video?.url || '',
    videoTitle: candidate.video?.title || '',
    image: selectedImage,
  };

  // --- HTML生成 ---
  const publishHtml = compileArticleHtml(hydratedArticle, meta, {
    assetBase: '../',
    image: selectedImage,
  });

  const now = new Date().toISOString();

  // --- 候補と履歴の更新 ---
  // candidates.json の更新（従来モードのみ）
  if (!isManualMode) {
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
    writeCandidates(updatedCandidates);
  }

  // トピック履歴を更新
  const updatedHistory = updateTopicHistory(topicHistory, topicKey, {
    sourceName: candidate.source.name,
    videoTitle: candidate.video.title,
    draftUrl: publishRelativePath,
    lastPublishedAt: today,
  });
  writeJson(topicHistoryPath, updatedHistory);
  logger.info('candidates と topic-history を更新しました。');

  // --- Publisherステージへの返り値を作成 ---
  // posts.jsonに保存するためのエントリ
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

  // PublisherステージでHTMLファイルを書き込むための詳細データ
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
      name: sourceName,
      url: sourceUrl,
    },
    video: {
      title: candidate.video?.title || '',
      url: candidate.video?.url || '',
      id: candidate.video?.id || null,
    },
    transcriptLength: candidate.transcript ? candidate.transcript.length : 0,
  };

  logger.info(`記事データを返却: slug=${slug}, ファイル予定パス=${publishRelativePath}`);

  // 最終的な結果を返す
  return buildResult({
    generated: true,
    candidateId: candidate.id,
    postEntry,
    draftUrl: publishRelativePath,
    topicKey,
    article: articleData,
  });
};

// スクリプトが直接実行された場合にrunGeneratorを実行
if (require.main === module) {
  runGenerator()
    .then((result) => {
      logger.info('Generator finished:', result);
    })
    .catch((error) => {
      logger.error('Generator failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runGenerator,
};
