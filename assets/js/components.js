/**
 * @fileoverview 共通コンポーネント（ヘッダー・フッター）の制御スクリプト
 * ページ読み込み時にヘッダーとフッターを動的に挿入し、
 * ハンバーガーメニューなどのインタラクティブな機能を提供します。
 */

(function () {
  'use strict';

  /**
   * 現在のページのパス深度に基づいて、ルートディレクトリへの相対パスを計算します。
   * 例:
   * - /index.html -> ./
   * - /posts/2025/11/article.html -> ../../../
   */
  function getRootPath() {
    // scriptタグから自身のパスを取得して逆算する方法もあるが、
    // ここではシンプルにlocation.pathnameの深度から計算する
    const path = window.location.pathname;

    // index.html または ルート直下の場合
    if (path === '/' || path.endsWith('/index.html') || path.split('/').length <= 2) {
      return './';
    }

    // ディレクトリの深さを計算（先頭の空文字を除く）
    // 例: /posts/2025/11/article.html -> ['', 'posts', '2025', '11', 'article.html'] -> length 5
    // 必要な '../' の数は length - 2 (ファイル名とルートの分)
    const depth = path.split('/').filter(Boolean).length - 1;
    return '../'.repeat(depth) || './';
  }

  /**
   * ヘッダーHTMLを生成して挿入します。
   * @param {string} rootPath - ルートへの相対パス
   */
  function insertHeader(rootPath) {
    // 既にヘッダーがある場合は挿入しない（二重挿入防止）
    if (document.querySelector('.site-header')) return;

    const headerHtml = `
      <header class="site-header">
        <div class="inner">
          <a class="brand" href="${rootPath}index.html">
            <img src="${rootPath}assets/img/logo.svg" alt="AI情報ブログ ロゴ" class="logo">
            <span>AI情報ブログ</span>
          </a>
          <button class="menu-toggle" type="button" aria-label="メニューを開く" aria-expanded="false">
            <div class="hamburger">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </button>
          <nav aria-label="メインナビゲーション">
            <a href="${rootPath}index.html">ホーム</a>
            <a href="${rootPath}about.html">このサイトについて</a>
          </nav>
        </div>
        <div class="menu-overlay"></div>
      </header>
    `;

    // bodyの先頭に挿入
    document.body.insertAdjacentHTML('afterbegin', headerHtml);
  }

  /**
   * フッターHTMLを生成して挿入します。
   * @param {string} rootPath - ルートへの相対パス
   */
  function insertFooter(rootPath) {
    // 既にフッターがある場合は挿入しない
    if (document.querySelector('.site-footer')) return;

    const footerHtml = `
      <footer class="site-footer">
        <div class="inner">
          <div class="footer-content">
            <div class="footer-logo">
              <span>AI情報ブログ</span>
            </div>
            <nav class="footer-nav" aria-label="フッターナビゲーション">
              <a href="${rootPath}index.html">ホーム</a>
              <a href="${rootPath}about.html">このサイトについて</a>
              <a href="${rootPath}privacy-policy.html">プライバシーポリシー</a>
              <a href="${rootPath}contact.html">お問い合わせ</a>
            </nav>
          </div>
          <small class="copyright">&copy; 2025 AI情報ブログ</small>
        </div>
      </footer>
    `;

    // bodyの末尾（scriptタグの前など）に挿入
    // コンテンツの直後に追加するため、beforeendを使用
    document.body.insertAdjacentHTML('beforeend', footerHtml);
  }

  /**
   * モバイル表示時のハンバーガーメニューの動作を初期化します。
   */
  function initMobileMenu() {
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.site-header nav');
    const menuOverlay = document.querySelector('.menu-overlay');
    const navLinks = document.querySelectorAll('.site-header nav a');

    if (!menuToggle || !nav || !menuOverlay) return;

    function toggleMenu() {
      const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', !isExpanded);
      menuToggle.setAttribute('aria-label', isExpanded ? 'メニューを開く' : 'メニューを閉じる');
      menuToggle.classList.toggle('active');
      nav.classList.toggle('active');
      menuOverlay.classList.toggle('active');
      document.body.style.overflow = !isExpanded ? 'hidden' : '';
    }

    function closeMenu() {
      if (menuToggle.getAttribute('aria-expanded') !== 'true') return;
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'メニューを開く');
      menuToggle.classList.remove('active');
      nav.classList.remove('active');
      menuOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    menuToggle.addEventListener('click', toggleMenu);
    menuOverlay.addEventListener('click', closeMenu);
    navLinks.forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('active')) {
        closeMenu();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768 && nav.classList.contains('active')) {
        closeMenu();
      }
    });
  }

  /**
   * 初期化処理
   */
  function init() {
    const rootPath = getRootPath();

    // 1. リソースのロード（CSS, Favicon, JS）
    loadCommonResources(rootPath);

    // 2. ヘッダー・フッターの挿入
    // DOMContentLoadedを待つ必要があるか確認
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        insertHeader(rootPath);
        insertFooter(rootPath);
        initMobileMenu();
      });
    } else {
      insertHeader(rootPath);
      insertFooter(rootPath);
      initMobileMenu();
    }
  }

  /**
   * 共通のリソース（CSS, JS, Favicon）を動的に読み込みます。
   * @param {string} rootPath 
   */
  function loadCommonResources(rootPath) {
    const head = document.head;
    const body = document.body;

    // --- CSS ---
    const cssList = [
      'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css',
      `${rootPath}assets/css/main.css`
    ];

    cssList.forEach(href => {
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        head.appendChild(link);
      }
    });

    // --- Favicon ---
    const faviconPath = `${rootPath}assets/img/logo.svg`;
    if (!document.querySelector('link[rel="icon"]')) {
      const icon = document.createElement('link');
      icon.rel = 'icon';
      icon.type = 'image/svg+xml';
      icon.href = faviconPath;
      head.appendChild(icon);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      appleIcon.href = faviconPath;
      head.appendChild(appleIcon);
    }

    // --- Scripts (Head) ---
    // Analytics
    const analyticsSrc = `${rootPath}assets/js/analytics.js`;
    if (!document.querySelector(`script[src="${analyticsSrc}"]`)) {
      const script = document.createElement('script');
      script.src = analyticsSrc;
      head.appendChild(script);
    }

    // AdSense
    const adSenseSrc = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX';
    if (!document.querySelector(`script[src^="https://pagead2.googlesyndication.com"]`)) {
      const script = document.createElement('script');
      script.src = adSenseSrc;
      script.async = true;
      script.crossOrigin = 'anonymous';
      head.appendChild(script);
    }

    // --- Scripts (Body End) ---
    // 読み込み順序を保証するために、async=false で追加するか、loadScript関数でチェーンする
    // ここではシンプルに defer をつけて追加する（モダンブラウザなら順序は概ね守られるが、厳密にはチェーン推奨）
    // Prism系は依存関係があるため、順番に追加する

    const scripts = [
      'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-bash.min.js',
      `${rootPath}assets/js/main.js`,
      `${rootPath}assets/js/article.js`
    ];

    // 順次読み込みを行うヘルパー
    const loadScriptsSequentially = async () => {
      for (const src of scripts) {
        if (!document.querySelector(`script[src="${src}"]`)) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.defer = true; // deferをつける
            script.onload = resolve;
            script.onerror = resolve; // エラーでも次へ進む
            // document.body.appendChild(script); // bodyの最後に追加
            // headに追加してもdeferがあれば実行タイミングはパース後になる
            document.head.appendChild(script);
          });
        }
      }
    };

    // DOM構築をブロックしないように非同期で実行開始
    loadScriptsSequentially();
  }

  // 即時実行（CSSなどはなるべく早く読み込みたい）
  init();
})();