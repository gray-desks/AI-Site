/**
 * @fileoverview 記事詳細ページ専用のUI制御スクリプト
 * 以下の機能を提供します:
 * - 目次（Table of Contents）の自動生成とスクロール連動ハイライト
 * - 読書進捗バーの表示
 * - 目次のレスポンシブ対応（折りたたみ機能）
 * - 記事内タグのクリックによるトップページへの遷移
 */

/**
 * 記事詳細ページの初期化関数
 * Barba.jsによるページ遷移後にも呼び出せるようにグローバル関数として定義
 */
window.initArticlePage = () => {
  'use strict';

  // <body>に 'article-page' クラスがなければ記事ページではないと判断し、処理を中断
  // Barba.js遷移後はbodyのクラスが更新されていない可能性があるため、
  // data-barba-namespaceもチェックするとより堅牢だが、
  // ここでは既存のクラスチェックに加え、コンテナ内の要素チェックも行う。
  const root = document.body;
  const articleContainer = document.querySelector('.article-detail');

  if ((!root || !root.classList.contains('article-page')) && !articleContainer) return;

  const currentUrl = window.location.href;
  const title = document.title.replace(/ \| AI情報ブログ$/, '') || 'AI情報ブログ';

  // --- 2. 目次 (Table of Contents) の自動生成 ---
  const setupTableOfContents = () => {
    const tocList = document.querySelector('[data-toc-list]');
    const headings = document.querySelectorAll('.post-article h2, .post-article h3, .article-content h2, .article-content h3');

    if (!tocList || headings.length === 0) {
      if (tocList) {
        tocList.innerHTML = '<li>目次はありません</li>';
      }
      return;
    }

    tocList.innerHTML = ''; // 既存の目次をクリア

    // 見出しテキストをID用のスラッグに変換する関数
    const slugify = (text) => text.trim().toLowerCase().replace(/[\s・、。/]+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

    let h2Counter = 0;
    let h3Counter = 0;

    // 各見出しをループ処理
    headings.forEach((heading, index) => {
      const text = heading.textContent || `section-${index + 1}`;
      const slug = heading.id || slugify(text) || `section-${index + 1}`;
      heading.id = slug; // 見出し自体にIDを付与
      heading.classList.add('toc-target'); // スクロールターゲット用のクラス

      // H2とH3の階層構造をカウント
      if (heading.tagName === 'H2') {
        h2Counter += 1;
        h3Counter = 0;
      } else {
        if (h2Counter === 0) h2Counter = 1; // H2なしでH3が始まった場合
        h3Counter += 1;
      }
      const indexLabel = heading.tagName === 'H3' ? `${h2Counter}.${h3Counter}` : `${h2Counter}`;

      // 目次リストのアイテム(li)を作成
      const item = document.createElement('li');
      item.dataset.sectionId = slug;
      item.dataset.tocIndex = indexLabel;
      if (heading.tagName === 'H3') {
        item.classList.add('is-depth'); // H3ならインデント用のクラスを付与
      }

      // アンカーリンク(a)を作成
      const anchor = document.createElement('a');
      anchor.href = `#${slug}`;
      anchor.setAttribute('data-toc-link', 'true');
      anchor.innerHTML = `<span class="toc-index">${indexLabel}</span><span class="toc-text">${text.trim()}</span>`;

      item.appendChild(anchor);
      tocList.appendChild(item);
    });

    // 目次リンククリック時のスムーズスクロール処理
    const tocClickHandler = (e) => {
      const link = e.target.closest('a[data-toc-link="true"]');
      if (!link) return;

      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (target) {
        const headerOffset = 100; // ヘッダーの高さを考慮したオフセット
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
    };
    tocList.addEventListener('click', tocClickHandler);
  };
  setupTableOfContents();


  // --- 3. 読書進捗インジケーター ---
  // ページ上部に読書進捗を示すプログレスバーを表示する
  const initReadingProgress = () => {
    // 既存のバーがあれば削除（ページ遷移時の重複を防ぐ）
    const existingBar = document.querySelector('.reading-progress');
    if (existingBar) existingBar.remove();

    const progressBar = document.createElement('div');
    progressBar.className = 'reading-progress';
    progressBar.innerHTML = '<div class="reading-progress-bar"></div>';
    document.body.prepend(progressBar);

    const bar = progressBar.querySelector('.reading-progress-bar');
    const articleContent = document.querySelector('.article-content, .post-article');
    if (!articleContent) return;

    // スクロール位置に応じてプログレスバーの幅を更新する
    const updateProgress = () => {
      const articleTop = articleContent.offsetTop;
      const articleHeight = articleContent.offsetHeight;
      const scrollPosition = window.pageYOffset;
      const windowHeight = window.innerHeight;

      // 記事の開始位置と終了位置を計算
      const scrollStart = articleTop;
      const scrollEnd = articleTop + articleHeight - windowHeight;

      // 現在の読書進捗を0〜100の範囲で計算
      let progress = 0;
      if (scrollPosition >= scrollStart && scrollPosition <= scrollEnd) {
        progress = ((scrollPosition - scrollStart) / (scrollEnd - scrollStart)) * 100;
      } else if (scrollPosition > scrollEnd) {
        progress = 100;
      }

      // プログレスバーの幅を更新
      bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    };

    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();

  };
  initReadingProgress();


  // --- 4. 目次のレスポンシブ対応と現在地表示 ---
  const initResponsiveToc = () => {
    const tocCard = document.querySelector('.article-card.article-toc');
    const tocList = tocCard?.querySelector('[data-toc-list]');
    const headings = document.querySelectorAll('.toc-target');
    if (!tocCard || !tocList || headings.length === 0) return;

    // --- DOM構造のセットアップ ---
    // 既にセットアップ済みかチェック
    if (tocCard.querySelector('.article-card-header')) return;

    const header = document.createElement('div');
    header.className = 'article-card-header';
    const label = tocCard.querySelector('.article-card-label');
    header.appendChild(label);

    const panel = document.createElement('div');
    panel.className = 'toc-panel';
    panel.id = 'article-toc-panel';
    panel.appendChild(tocList);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toc-toggle';
    toggle.setAttribute('aria-controls', panel.id);
    header.appendChild(toggle);

    tocCard.prepend(header);
    tocCard.appendChild(panel);

    // --- 状態管理とイベントリスナー ---
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const state = {
      isMobile: mediaQuery.matches,
      expanded: !mediaQuery.matches,
    };

    const applyState = () => {
      state.isMobile = mediaQuery.matches;
      if (!state.isMobile) state.expanded = true; // PCでは常に展開

      const shouldShow = !state.isMobile || state.expanded;
      panel.hidden = !shouldShow;
      toggle.setAttribute('aria-expanded', String(shouldShow));
      toggle.textContent = state.expanded ? '目次を隠す' : '目次を表示';
      tocCard.dataset.mobileCollapsed = String(state.isMobile && !state.expanded);
    };

    const toggleHandler = () => {
      if (!state.isMobile) return;
      state.expanded = !state.expanded;
      applyState();
    };
    toggle.addEventListener('click', toggleHandler);

    const mediaQueryHandler = () => applyState();
    mediaQuery.addEventListener('change', mediaQueryHandler);
    applyState(); // 初期状態を適用



  };
  initResponsiveToc();


  // --- 5. 記事内タグのクリック機能 ---
  // 記事ページ内のタグをクリックすると、トップページのそのタグでフィルタリングされたページに遷移する
  const setupTagLinks = () => {
    const clickHandler = (e) => {
      const tagElement = e.target.closest('.tag[data-tag-slug]');
      // 記事ページ内でのみ動作
      if (!tagElement || (!document.body.classList.contains('article-page') && !document.querySelector('.article-detail'))) return;

      e.preventDefault();
      e.stopPropagation();

      const slug = tagElement.getAttribute('data-tag-slug');
      if (!slug) return;

      // ルートパスを取得するヘルパー関数（将来的な構成変更にも耐えられるように堅牢化）
      const getRootPath = () => {
        // 1. ヘッダーのロゴリンクから取得（最も確実な設定値）
        // ビルドプロセスによって生成された正しい相対パスを利用する
        const homeLink = document.querySelector('.site-header .brand');
        if (homeLink) {
          const href = homeLink.getAttribute('href');
          if (href) {
            // "index.html" を除去してディレクトリパスのみを返す
            return href.replace(/index\.html$/, '');
          }
        }

        // 2. スクリプトタグのパスから逆算（フォールバック）
        // article.js が assets/js/ にあることを前提に、その読み込みパスからルートを割り出す
        const script = document.querySelector('script[src*="assets/js/article.js"]');
        if (script) {
          const src = script.getAttribute('src');
          // 例: "../../../assets/js/article.js" -> "../../../"
          if (src) return src.split('assets/js/article.js')[0];
        }

        // 3. URL構造からの推測（最終手段）
        // /posts/ ディレクトリの深さから相対パスを生成
        if (window.location.pathname.includes('/posts/')) {
          const relativePath = window.location.pathname.split('/posts/')[1];
          // パス区切り文字の数だけ階層を上がる
          const depth = relativePath.split('/').length;
          return '../'.repeat(depth);
        }

        return './';
      };

      const rootPath = getRootPath();
      // パスの末尾が '/' でない、かつ空文字でない場合は '/' を追加（念のため）
      const basePath = (rootPath && !rootPath.endsWith('/')) ? `${rootPath}/` : rootPath;
      const targetUrl = `${basePath}index.html`;

      const separator = targetUrl.includes('?') ? '&' : '?';
      window.location.href = `${targetUrl}${separator}tag=${encodeURIComponent(slug)}`;
    };

    document.addEventListener('click', clickHandler);


    // タグにクリック可能なカーソルスタイルを適用
    const applyTagStyles = () => {
      document.querySelectorAll('.article-tags .tag[data-tag-slug], .article-hero .tag[data-tag-slug]').forEach(tag => {
        tag.style.cursor = 'pointer';
      });
    };
    applyTagStyles();
  };
  setupTagLinks();


  // --- 6. Note記事用コピー機能 ---
  // 記事のタイトル、本文、タグをNote記事形式でクリップボードにコピーする
  const setupNoteCopyButton = () => {
    // ローカル環境でのみ表示する
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isLocal) return;

    const articleContent = document.querySelector('.article-content');
    if (!articleContent) return;

    // 既存のボタンがあれば削除
    const existingContainer = document.querySelector('.note-copy-btn-container');
    if (existingContainer) existingContainer.remove();

    const btnContainer = document.createElement('div');
    btnContainer.className = 'note-copy-btn-container';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'note-copy-btn';
    copyBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Note記事用にコピー
    `;
    copyBtn.type = 'button';

    copyBtn.addEventListener('click', async () => {
      try {
        const title = document.querySelector('h1')?.textContent.trim() || '';
        const tags = Array.from(document.querySelectorAll('.article-tags .tag'))
          .map(tag => `#${tag.textContent.trim()}`)
          .join(' ');

        // 本文のテキスト抽出（簡易的なHTMLタグ除去と整形）
        let bodyText = '';

        // 記事本文の要素を取得
        const contentElements = Array.from(articleContent.querySelectorAll('p, h2, h3, ul, ol'));

        // まとめの要素を取得して追加
        const conclusion = document.querySelector('.article-conclusion');
        if (conclusion) {
          const conclusionHeading = conclusion.querySelector('.conclusion-heading');
          if (conclusionHeading) contentElements.push(conclusionHeading);

          const conclusionContent = conclusion.querySelector('.conclusion-content');
          if (conclusionContent) {
            const conclusionParagraphs = conclusionContent.querySelectorAll('p, ul, ol');
            contentElements.push(...Array.from(conclusionParagraphs));
          }
        }

        contentElements.forEach(el => {
          // ボタン自体のテキストが含まれないようにチェック
          if (el.closest('.note-copy-btn-container')) return;

          if (el.tagName === 'H2') {
            bodyText += `\n\n## ${el.textContent.trim()}\n\n`;
          } else if (el.tagName === 'H3') {
            bodyText += `\n### ${el.textContent.trim()}\n\n`;
          } else if (el.tagName === 'UL' || el.tagName === 'OL') {
            const listItems = Array.from(el.querySelectorAll('li')).map(li => `- ${li.textContent.trim()}`).join('\n');
            bodyText += `${listItems}\n\n`;
          } else {
            bodyText += `${el.textContent.trim()}\n\n`;
          }
        });

        const copyText = `${title}\n\n${bodyText}\n${tags}`;

        await navigator.clipboard.writeText(copyText);

        const originalContent = copyBtn.innerHTML;
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          コピーしました！
        `;

        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = originalContent;
        }, 2000);

      } catch (err) {
        console.error('コピーに失敗しました:', err);
        alert('コピーに失敗しました');
      }
    });

    btnContainer.appendChild(copyBtn);
    articleContent.appendChild(btnContainer);
  };
  setupNoteCopyButton();


};

// 初回読み込み時
document.addEventListener('DOMContentLoaded', () => {
  window.initArticlePage();
});
