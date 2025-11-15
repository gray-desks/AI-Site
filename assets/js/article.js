// ============================================
// 記事詳細ページ専用のUI制御
// ============================================

(function initArticlePage() {
  const root = document.body;
  if (!root || !root.classList.contains('article-page')) return;

  const currentUrl = window.location.href;
  const title = document.title.replace(/ \| AI情報ブログ$/, '') || 'AI情報ブログ';

  // === 共有リンク生成 ===
  const encode = (value) => encodeURIComponent(value);

  document.querySelectorAll('[data-share-target="x"]').forEach((link) => {
    const url = new URL('https://twitter.com/intent/tweet');
    url.searchParams.set('text', `${title} | AI情報ブログ`);
    url.searchParams.set('url', currentUrl);
    link.setAttribute('href', url.toString());
  });

  document.querySelectorAll('[data-share-target="linkedin"]').forEach((link) => {
    const href = `https://www.linkedin.com/sharing/share-offsite/?url=${encode(currentUrl)}`;
    link.setAttribute('href', href);
  });

  const copyButton = document.querySelector('[data-copy-link]');
  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(currentUrl);
        const original = copyButton.textContent;
        copyButton.textContent = 'コピーしました';
        setTimeout(() => {
          copyButton.textContent = original;
        }, 2000);
      } catch (error) {
        console.error('リンクのコピーに失敗しました', error);
      }
    });
  }

  const nativeShare = document.querySelector('[data-share-target="native"]');
  if (nativeShare) {
    nativeShare.addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title, url: currentUrl });
        } catch (error) {
          console.warn('共有がキャンセルされました', error);
        }
      } else if (copyButton) {
        copyButton.click();
      }
    });
  }

  // === 目次の自動生成 ===
  const tocList = document.querySelector('[data-toc-list]');
  if (tocList) {
    const headings = document.querySelectorAll('.post-article h2, .post-article h3');
    const slugify = (text) =>
      text
        .trim()
        .toLowerCase()
        .replace(/[\s・、。/]+/g, '-')
        .replace(/[^a-z0-9\-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    headings.forEach((heading, index) => {
      const text = heading.textContent || `section-${index + 1}`;
      const slug = heading.id || slugify(text) || `section-${index + 1}`;
      heading.id = slug;

      const item = document.createElement('li');
      if (heading.tagName === 'H3') {
        item.classList.add('is-depth');
      }

      const anchor = document.createElement('a');
      anchor.href = `#${slug}`;
      anchor.textContent = text.trim();
      item.appendChild(anchor);
      tocList.appendChild(item);
    });

    if (!tocList.children.length) {
      const item = document.createElement('li');
      item.textContent = '目次はありません';
      tocList.appendChild(item);
    }
  }
})();
