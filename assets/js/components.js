/**
 * @fileoverview 共通コンポーネント（ヘッダー・フッター）の動的挿入スクリプト
 * 全てのページで共通のヘッダーとフッターをJavaScriptで動的に挿入します。
 * これにより、各HTMLファイルで同じコードを繰り返し記述する必要がなくなります。
 * また、レスポンシブ対応のハンバーガーメニューの機能も初期化します。
 * SEOへの影響を最小限に抑えるため、DOMContentLoadedイベントで即座に実行されます。
 */

(function() {
  'use strict';

  /**
   * 現在のページのパスに基づいて、アセット（画像など）への相対パスを決定します。
   * - `posts/` ディレクトリ内のページ（記事詳細ページ）からは `../`
   * - それ以外のページ（トップページ、概要ページなど）からは `./`
   * @returns {string} アセットへのベースパス
   */
  function getBasePath() {
    const path = window.location.pathname;
    return path.includes('/posts/') ? '../' : './';
  }

  /**
   * ヘッダーのHTML文字列を生成します。
   * 現在のページに応じてナビゲーションリンクに `aria-current="page"` を付与し、
   * アクセシビリティを向上させます。
   * @param {string} basePath - アセットへのベースパス
   * @returns {string} ヘッダーのHTML文字列
   */
  function getHeaderHTML(basePath) {
    // 現在のページがホームかどうかを判定
    const isHome = !window.location.pathname.includes('/posts/') &&
                   !window.location.pathname.includes('/about.html');
    const isAbout = window.location.pathname.includes('/about.html');
    
    // 各ページへのリンクとロゴ画像のパスを解決
    const homeLink = basePath === '../' ? '../index.html' : 'index.html';
    const aboutLink = basePath === '../' ? '../about.html' : 'about.html';
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
            <a href="${aboutLink}"${isAbout ? ' aria-current="page"' : ''}>このサイトについて</a>
          </nav>
        </div>
        <div class="menu-overlay"></div>
      </header>
    `;
  }

  /**
   * フッターのHTML文字列を生成します。
   * 現在の西暦を自動的に表示します。
   * @returns {string} フッターのHTML文字列
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
   * モバイル表示時のハンバーガーメニューの動作を初期化します。
   * メニューの開閉、キーボード操作（ESCキー）、オーバーレイクリックでのクローズなどを設定します。
   */
  function initMobileMenu() {
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.site-header nav');
    const menuOverlay = document.querySelector('.menu-overlay');
    const navLinks = document.querySelectorAll('.site-header nav a');

    if (!menuToggle || !nav || !menuOverlay) return;

    // メニューを開閉する関数
    function toggleMenu() {
      const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', !isExpanded);
      menuToggle.setAttribute('aria-label', isExpanded ? 'メニューを開く' : 'メニューを閉じる');
      
      // activeクラスを付け外しして表示を切り替える
      menuToggle.classList.toggle('active');
      nav.classList.toggle('active');
      menuOverlay.classList.toggle('active');

      // メニューが開いている間、背景のスクロールを禁止する
      document.body.style.overflow = !isExpanded ? 'hidden' : '';
    }

    // メニューを閉じる関数
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

    // ウィンドウリサイズ時にPC幅になったらメニューを自動で閉じる
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768 && nav.classList.contains('active')) {
        closeMenu();
      }
    });
  }

  /**
   * ヘッダーとフッターのコンポーネントをDOMに挿入します。
   * 重複挿入を防ぐために、既に要素が存在しないかチェックします。
   */
  function injectComponents() {
    const basePath = getBasePath();

    if (!document.querySelector('.site-header')) {
      document.body.insertAdjacentHTML('afterbegin', getHeaderHTML(basePath));
      // ヘッダーが挿入された後にメニューの初期化処理を実行
      initMobileMenu();
    }

    if (!document.querySelector('.site-footer')) {
      document.body.insertAdjacentHTML('beforeend', getFooterHTML());
    }
  }

  // DOMの読み込み状態に応じて、コンポーネント挿入処理を実行
  if (document.readyState === 'loading') {
    // まだ読み込み中の場合は、DOMContentLoadedイベントを待つ
    document.addEventListener('DOMContentLoaded', injectComponents);
  } else {
    // 既に読み込み済みの場合は即座に実行
    injectComponents();
  }
})();