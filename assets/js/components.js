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
          <nav aria-label="メインナビゲーション">
            <a href="${homeLink}"${isHome ? ' aria-current="page"' : ''}>ホーム</a>
            <a href="${aboutLink}">このサイトについて</a>
          </nav>
        </div>
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
   * コンポーネントを挿入
   */
  function injectComponents() {
    const basePath = getBasePath();

    // ヘッダーが存在しない場合のみ挿入（重複防止）
    if (!document.querySelector('.site-header')) {
      document.body.insertAdjacentHTML('afterbegin', getHeaderHTML(basePath));
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
