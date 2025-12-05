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


  // --- 6. Noteドラフト作成支援 (Local Only - Client Side Mode) ---
  const setupNoteDraftButton = async () => {
    // ローカル環境チェック (Live Server含む)
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isLocal) return;

    const articleContent = document.querySelector('.article-content');
    if (!articleContent) return;

    // ボタンコンテナ作成
    const container = document.createElement('div');
    container.className = 'note-draft-container';
    container.style.margin = '2rem 0';
    container.style.padding = '1.5rem';
    container.style.backgroundColor = '#f4f4f4';
    container.style.borderRadius = '8px';
    container.style.textAlign = 'center';
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.gap = '10px';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';

    // タイトル
    const label = document.createElement('div');
    label.textContent = 'Note投稿支援ツール';
    label.style.width = '100%';
    label.style.fontWeight = 'bold';
    label.style.marginBottom = '0.5rem';
    label.style.color = '#555';
    container.appendChild(label);

    // 共通ボタンスタイル生成関数
    const createBtn = (text, color = '#555') => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.disabled = true; // 初期状態は無効
      btn.style.padding = '0.6rem 1rem';
      btn.style.backgroundColor = color;
      btn.style.color = 'white';
      btn.style.border = 'none';
      btn.style.borderRadius = '4px';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '0.9rem';
      btn.style.fontWeight = 'bold';
      btn.style.transition = 'all 0.2s';

      // ホバー効果
      btn.onmouseover = () => {
        if (!btn.disabled) btn.style.opacity = '0.8';
      };
      btn.onmouseout = () => {
        if (!btn.disabled) btn.style.opacity = '1';
      };

      return btn;
    };

    // ボタン定義 (ユーザー要望: 配色統一 / タグ追加)
    const btnImage = createBtn('1. 見出し画像をDL');
    const btnTitle = createBtn('2. タイトルコピー');
    const btnBody = createBtn('3. 本文コピー');
    const btnTags = createBtn('4. ハッシュタグコピー');

    container.appendChild(btnImage);
    container.appendChild(btnTitle);
    container.appendChild(btnBody);
    container.appendChild(btnTags);

    // データ保持用
    let state = {
      title: '',
      body: '',
      imageUrl: '',
      tags: '',
      ready: false
    };
    let noteWindow = null; // Noteタブの参照を保持

    // 初期化・データ取得
    const initData = async () => {
      try {
        const pathname = window.location.pathname;
        const filename = pathname.split('/').pop().replace('.html', '');
        const mdPath = `../../../content/posts/${filename}.md`;

        const response = await fetch(mdPath);
        if (response.ok) {
          const text = await response.text();

          // Frontmatter解析
          const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
          if (fmMatch) {
            const fmText = fmMatch[1];
            state.body = fmMatch[2].trim(); // 本文

            const titleMatch = fmText.match(/title:\s*(.*)/);
            state.title = titleMatch ? titleMatch[1].replace(/^['"]|['"]$/g, '').trim() : document.title;

            // 画像パス取得 (YAMLの構造に対応)
            const srcMatch = fmText.match(/src:\s*(.*)/);
            if (srcMatch) {
              state.imageUrl = srcMatch[1].trim().replace(/^['"]|['"]$/g, '');
            } else {
              const imgMatch = fmText.match(/^image:[ \t]*(.+)$/m);
              if (imgMatch) {
                const val = imgMatch[1].trim();
                if (val && !val.startsWith('key:') && !val.startsWith('src:')) {
                  state.imageUrl = val.replace(/^['"]|['"]$/g, '');
                }
              }
            }

            // タグ取得 (tagsセクションから label を抽出)
            // tags:
            //   - label: タグ名
            const tagsMatch = fmText.match(/tags:\s*\n([\s\S]*?)(?=\n[a-z]|$)/);
            if (tagsMatch) {
              const tagsBlock = tagsMatch[1];
              const labels = [...tagsBlock.matchAll(/label:\s*(.*)/g)].map(m => `#${m[1].trim().replace(/^['"]|['"]$/g, '')}`);
              state.tags = labels.join(' ');
            }

          } else {
            state.title = document.title;
            state.body = text;
          }

          // 準備完了
          state.ready = true;
          [btnImage, btnTitle, btnBody, btnTags].forEach(b => {
            b.disabled = false;
            b.style.opacity = '1';
          });

        } else {
          label.textContent = 'データ読込エラー (Markdownが見つかりません)';
        }
      } catch (e) {
        console.error(e);
        label.textContent = '初期化エラー';
      }
    };
    initData();

    // イベントリスナー設定
    btnTitle.addEventListener('click', async () => {
      await navigator.clipboard.writeText(state.title);
      const originalText = btnTitle.textContent;
      btnTitle.textContent = 'コピー完了・移動します';
      btnTitle.style.backgroundColor = '#2cb696';

      // Noteタブを開く、またはフォーカス移動
      if (!noteWindow || noteWindow.closed) {
        noteWindow = window.open('https://note.com/notes/new', 'note_draft_tab');
      } else {
        noteWindow.focus();
      }

      setTimeout(() => {
        btnTitle.textContent = originalText;
        // 完了状態の色を残すかどうか？ ユーザー体験的には戻ったほうがいいかもしれないが、
        // 「終わったかどうか」を知りたい場合は残したほうがいい。
        // しかし一旦元に戻す仕様を踏襲する。
        btnTitle.style.backgroundColor = '#555';
      }, 3000); // 少し長めに
    });

    btnBody.addEventListener('click', async () => {
      await navigator.clipboard.writeText(state.body);
      const originalText = btnBody.textContent;
      btnBody.textContent = 'コピー完了！';
      btnBody.style.backgroundColor = '#2cb696';

      // Noteタブへフォーカス移動
      if (noteWindow && !noteWindow.closed) {
        noteWindow.focus();
      } else {
        noteWindow = window.open('https://note.com/notes/new', 'note_draft_tab');
      }

      setTimeout(() => {
        btnBody.textContent = originalText;
        btnBody.style.backgroundColor = '#555';
      }, 1500);
    });

    btnTags.addEventListener('click', async () => {
      if (!state.tags) {
        alert('タグが見つかりませんでした');
        return;
      }
      await navigator.clipboard.writeText(state.tags);
      const originalText = btnTags.textContent;
      btnTags.textContent = 'コピー完了！';
      btnTags.style.backgroundColor = '#2cb696';

      if (noteWindow && !noteWindow.closed) {
        noteWindow.focus();
      } else {
        noteWindow = window.open('https://note.com/notes/new', 'note_draft_tab');
      }

      setTimeout(() => {
        btnTags.textContent = originalText;
        btnTags.style.backgroundColor = '#555';
      }, 1500);
    });

    btnImage.addEventListener('click', async () => {
      if (!state.imageUrl) {
        alert('見出し画像が見つかりません');
        return;
      }

      try {
        // 相対パスを絶対パスに解決
        let imgUrl = state.imageUrl;
        if (!imgUrl.startsWith('http')) {
          if (!imgUrl.startsWith('/')) {
            imgUrl = `/${imgUrl}`;
          }
          imgUrl = window.location.origin + imgUrl;
        }

        const res = await fetch(imgUrl);
        if (!res.ok) throw new Error(`Status ${res.status}`);

        const blob = await res.blob();

        // エラーチェック（404ページが返ってきている場合など）
        if (blob.type.includes('html')) {
          throw new Error('指定されたパスに画像がありません (404 Not Found)');
        }

        const url = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;

        // 拡張子推定 (MIME type優先)
        let ext = 'png';
        if (blob.type === 'image/jpeg') ext = 'jpg';
        else if (blob.type === 'image/webp') ext = 'webp';
        else if (blob.type === 'image/png') ext = 'png';
        else {
          // ファイル名から取得試行
          const parts = imgUrl.split('/').pop().split('?')[0].split('.');
          if (parts.length > 1) ext = parts.pop();
        }

        a.download = `header-image.${ext}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        const originalText = btnImage.textContent;
        btnImage.textContent = 'DL完了！';
        btnImage.style.backgroundColor = '#2cb696';
        setTimeout(() => {
          btnImage.textContent = originalText;
          btnImage.style.backgroundColor = '#555';
        }, 1500);

      } catch (e) {
        console.error(e);
        alert(`画像のダウンロードに失敗しました。\nURL: ${state.imageUrl}\nError: ${e.message}`);
      }
    });

    // 配置
    const header = document.querySelector('.article-header');
    if (header) {
      header.after(container);
    } else {
      articleContent.prepend(container);
    }
  };
  setupNoteDraftButton();


  // --- 7. SNSシェアボタンの設置 ---
  const setupShareButtons = () => {
    const articleContent = document.querySelector('.article-content');
    const articleGrid = document.querySelector('.article-grid');
    if (!articleContent) return;

    const url = encodeURIComponent(window.location.href);
    const title = encodeURIComponent(document.title);

    // --- Side Share Bar (Desktop) ---
    if (articleGrid) {
      // 既存のサイドシェアがあれば削除
      const existingSide = document.querySelector('.share-side');
      if (existingSide) existingSide.remove();

      const sideShare = document.createElement('aside');
      sideShare.className = 'share-side';
      sideShare.innerHTML = `
            <span class="share-side-label">Share</span>
            <a href="https://twitter.com/intent/tweet?url=${url}&text=${title}" target="_blank" rel="noopener noreferrer" class="share-btn share-btn--x" aria-label="X (Twitter)でシェア">
                <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                <span class="share-tooltip">Post to X</span>
            </a>
            <button type="button" class="share-btn share-btn--copy" aria-label="リンクをコピー">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                <span class="share-tooltip">Copy Link</span>
            </button>
        `;

      // 記事グリッドの先頭に挿入
      articleGrid.prepend(sideShare);
      articleGrid.classList.add('has-share-side');

      // サイドバーのコピー機能
      const sideCopyBtn = sideShare.querySelector('.share-btn--copy');
      if (sideCopyBtn) {
        sideCopyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            sideCopyBtn.classList.add('copied');
            const tooltip = sideCopyBtn.querySelector('.share-tooltip');
            if (tooltip) {
              const originalText = tooltip.textContent;
              tooltip.textContent = 'Copied!';
              setTimeout(() => {
                sideCopyBtn.classList.remove('copied');
                tooltip.textContent = originalText;
              }, 2000);
            }
          } catch (err) {
            console.error('Failed to copy:', err);
          }
        });
      }
    }

    // --- Bottom Share Container (Mobile/All) ---
    // 既存のシェアボタンがあれば削除
    const existingShare = document.querySelector('.share-container');
    if (existingShare) existingShare.remove();

    const shareContainer = document.createElement('div');
    shareContainer.className = 'share-container';

    shareContainer.innerHTML = `
      <span class="share-label">Share this post</span>
      <div class="share-buttons">
        <a href="https://twitter.com/intent/tweet?url=${url}&text=${title}" target="_blank" rel="noopener noreferrer" class="share-btn share-btn--x" aria-label="X (Twitter)でシェア">
          <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
          <span class="share-tooltip">Post to X</span>
        </a>
        <button type="button" class="share-btn share-btn--copy" aria-label="リンクをコピー">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          <span class="share-tooltip">Copy Link</span>
        </button>
      </div>
    `;

    // 挿入位置: 記事の最後（まとめセクションの前、あるいは広告の前）
    // ここでは .article-conclusion の直前に挿入する
    const conclusion = articleContent.querySelector('.article-conclusion');
    if (conclusion) {
      articleContent.insertBefore(shareContainer, conclusion);
    } else {
      articleContent.appendChild(shareContainer);
    }

    // コピーボタンの動作
    const copyBtn = shareContainer.querySelector('.share-btn--copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        copyBtn.classList.add('copied');
        const tooltip = copyBtn.querySelector('.share-tooltip');
        if (tooltip) {
          const originalText = tooltip.textContent;
          tooltip.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            tooltip.textContent = originalText;
          }, 2000);
        }
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  };
  setupShareButtons();


};

// 初回読み込み時
document.addEventListener('DOMContentLoaded', () => {
  window.initArticlePage();
});
