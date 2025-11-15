/**
 * 共通コンポーネント（ヘッダー・フッター）の動的挿入
 * SEO影響を最小化するため、DOMContentLoadedで即座に実行
 */

(function() {
  'use strict';

  /**
   * 現在のページパスに基づいて相対パスを調整
   * @returns {string} assets/へのパス（'../' or './'）
   */
  function getBasePath() {
    const path = window.location.pathname;
    // posts/配下のページなら '../'、それ以外は './'
    return path.includes('/posts/') ? '../' : './';
  }

  /**
   * ヘッダーHTMLを生成
   * @param {string} basePath - assets/へのパス
   * @returns {string} ヘッダーHTML
   */
  function getHeaderHTML(basePath) {
    const isHome = !window.location.pathname.includes('/posts/') &&
                   !window.location.pathname.includes('/about.html');
    const homeLink = basePath + 'index.html';
    const aboutLink = basePath + 'about.html';
    const logoPath = basePath + 'assets/img/logo.svg';

    return `
      <header class="site-header">
        <div class="inner">
          <a class="brand" href="${homeLink}">
            <img src="${logoPath}" alt="AI情報ブログ ロゴ" class="logo">
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
            <a href="${homeLink}"${isHome ? ' aria-current="page"' : ''}>ホーム</a>
            <a href="${aboutLink}">このサイトについて</a>
          </nav>
        </div>
        <div class="menu-overlay"></div>
      </header>
    `;
  }

  /**
   * フッターHTMLを生成
   * @returns {string} フッターHTML
   */
  function getFooterHTML() {
    const currentYear = new Date().getFullYear();
    return `
      <footer class="site-footer">
        <div class="inner">
          <small>&copy; ${currentYear} AI情報ブログ</small>
        </div>
      </footer>
    `;
  }

  /**
   * ハンバーガーメニューの動作を初期化
   */
  function initMobileMenu() {
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.site-header nav');
    const menuOverlay = document.querySelector('.menu-overlay');
    const navLinks = document.querySelectorAll('.site-header nav a');

    if (!menuToggle || !nav || !menuOverlay) return;

    // メニューの開閉
    function toggleMenu() {
      const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';

      menuToggle.setAttribute('aria-expanded', !isExpanded);
      menuToggle.setAttribute('aria-label', isExpanded ? 'メニューを開く' : 'メニューを閉じる');
      menuToggle.classList.toggle('active');
      nav.classList.toggle('active');
      menuOverlay.classList.toggle('active');

      // メニューが開いている時はbodyのスクロールを防止
      if (!isExpanded) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }

    // メニューを閉じる
    function closeMenu() {
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'メニューを開く');
      menuToggle.classList.remove('active');
      nav.classList.remove('active');
      menuOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    // ハンバーガーボタンをクリック
    menuToggle.addEventListener('click', toggleMenu);

    // オーバーレイをクリック
    menuOverlay.addEventListener('click', closeMenu);

    // ナビゲーションリンクをクリックしたらメニューを閉じる
    navLinks.forEach(link => {
      link.addEventListener('click', closeMenu);
    });

    // ESCキーでメニューを閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('active')) {
        closeMenu();
      }
    });

    // ウィンドウリサイズ時に768px以上になったらメニューを閉じる
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth > 768 && nav.classList.contains('active')) {
          closeMenu();
        }
      }, 250);
    });
  }

  /**
   * コンポーネントを挿入
   */
  function injectComponents() {
    const basePath = getBasePath();

    // ヘッダーが存在しない場合のみ挿入（重複防止）
    if (!document.querySelector('.site-header')) {
      document.body.insertAdjacentHTML('afterbegin', getHeaderHTML(basePath));
      // ヘッダー挿入後にモバイルメニューを初期化
      initMobileMenu();
    }

    // フッターが存在しない場合のみ挿入（重複防止）
    if (!document.querySelector('.site-footer')) {
      document.body.insertAdjacentHTML('beforeend', getFooterHTML(basePath));
    }
  }

  // DOM読み込み完了後すぐに実行（SEO影響を最小化）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectComponents);
  } else {
    // 既に読み込み済みの場合は即座に実行
    injectComponents();
  }
})();
