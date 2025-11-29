/**
 * @fileoverview AI情報ブログ メインスクリプト (トップページ用)
 * サイト全体の共通機能と、記事一覧ページのインタラクティブなUIを制御します。
 */

// --- 共通UI機能 ---

/**
 * スクロール時にヘッダーのスタイルを変更します。
 */
const initHeaderScroll = () => {
  const header = document.querySelector('.site-header');
  if (!header) return;

  // 重複登録防止
  if (window.headerScrollHandler) {
    window.removeEventListener('scroll', window.headerScrollHandler);
  }

  // スクロール判定のしきい値（ピクセル単位）
  const scrollThreshold = 50;
  window.headerScrollHandler = () => {
    // ページのスクロール量がしきい値を超えたらヘッダーに'scrolled'クラスを追加
    if (window.pageYOffset > scrollThreshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', window.headerScrollHandler, { passive: true });
};


/**
 * ページ内アンカーリンクのスムーズスクロール
 */
const initSmoothScroll = () => {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    // 重複登録防止（簡易的）
    if (anchor.dataset.smoothScrollInit) return;
    anchor.dataset.smoothScrollInit = 'true';

    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      try {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          // ヘッダーの高さ分のオフセット（ピクセル単位）
          const headerOffset = 80;
          // ターゲット要素の現在位置を取得
          const elementPosition = target.getBoundingClientRect().top;
          // スクロール先の位置を計算（ヘッダー分を考慮）
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

          // スムーズスクロールを実行
          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      } catch (error) {
        console.warn(`Smooth scroll target not found or invalid: ${href}`);
      }
    });
  });
};


/**
 * スクロールアニメーション (IntersectionObserver)
 */
const initScrollAnimations = () => {
  if (!('IntersectionObserver' in window)) return;

  // Intersection Observerのオプション設定
  const observerOptions = {
    threshold: 0.1, // 要素の10%が表示されたら発火
    rootMargin: '0px 0px -50px 0px' // ビューポートの下辺から50px手前で判定
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.animate-on-scroll, .post-card, .workflow-card, .source-card, .info-panel, .hero-panel').forEach(el => {
    observer.observe(el);
  });
};


// --- 記事一覧ページの機能 ---

/**
 * 記事一覧の初期化
 */
const initPostList = () => {
  const listContainer = document.getElementById('post-list');
  if (!listContainer) return;

  // 既に初期化済みならスキップ
  if (listContainer.dataset.postListInit) return;
  listContainer.dataset.postListInit = 'true';

  // --- DOM要素の取得 ---
  const elements = {
    list: listContainer,
    errorLabel: document.getElementById('post-error'),
    tagSearchPanel: document.getElementById('tag-search-panel'),
    tagSearchInput: document.getElementById('tag-search-input'),
    tagSearchClear: document.getElementById('tag-search-clear'),
    selectedTagWrapper: document.getElementById('tag-search-selected'),
    selectedTagLabel: document.getElementById('tag-search-selected-label'),
    selectedTagClear: document.getElementById('tag-search-selected-clear'),
    tagSuggestions: document.getElementById('tag-search-suggestions'),
    filterStatus: document.getElementById('tag-filter-status'),
    tagSearchToggle: document.getElementById('tag-search-toggle'),
    loadMoreContainer: document.getElementById('load-more-container'),
    loadMoreBtn: document.getElementById('load-more-btn'),
  };

  // 要素が足りない場合は中断（検索パネルがないページなど）
  if (!elements.tagSearchInput) return;

  // 表示件数の定数
  const INITIAL_DISPLAY_COUNT = 9; // 初期表示件数
  const LOAD_MORE_INCREMENT = 9; // 「もっと見る」ボタンで追加表示する件数

  // アプリケーションの状態管理オブジェクト
  const state = {
    allPosts: [], // すべての記事データ（公開・下書き含む）
    filteredPosts: [], // フィルタリング後の記事データ
    allTags: [], // すべてのタグ情報（カウント付き）
    searchQuery: '', // タグ検索のクエリ文字列
    selectedTag: null, // 現在選択されているタグ
    isLoading: true, // データ読み込み中フラグ
    visibleCount: INITIAL_DISPLAY_COUNT, // 現在表示されている記事数
  };

  const isDraftPost = (post) => (post?.status || 'published') !== 'published';
  const isPublishedPost = (post) => (post?.status || 'published') === 'published';

  /**
   * 文字列を正規化する（全角/半角統一、トリミング、小文字化）
   * @param {string} value - 正規化する文字列
   * @returns {string} 正規化された文字列
   */
  const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLowerCase();

  /**
   * すべての記事からタグのインデックスを作成する
   * @param {Array} posts - 記事の配列
   * @returns {Array} タグオブジェクトの配列（slug, label, count）
   */
  const buildTagIndex = (posts) => {
    const tagMap = new Map();
    // 公開記事のみをカウント対象（通常表示と一致させる）
    posts.filter(isPublishedPost).forEach(post => {
      (post.tags || []).forEach(tag => {
        const tagObj = toTagObject(tag);
        if (!tagMap.has(tagObj.slug)) {
          tagMap.set(tagObj.slug, { ...tagObj, count: 0 });
        }
        // タグの出現回数をカウント
        tagMap.get(tagObj.slug).count++;
      });
    });
    // カウント数の降順、同数なら日本語の辞書順でソート
    const tags = Array.from(tagMap.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
    // 下書きタグの表示を保証（下書きが存在する場合）
    const hasDraftTag = tags.some((tag) => tag.slug === 'draft');
    const draftCount = posts.filter(isDraftPost).length;
    let draftTag = null;
    if (hasDraftTag) {
      const idx = tags.findIndex((tag) => tag.slug === 'draft');
      draftTag = tags.splice(idx, 1)[0];
    } else if (draftCount > 0) {
      draftTag = { slug: 'draft', label: '下書き', count: draftCount };
    }
    if (draftTag) {
      draftTag.count = draftCount || draftTag.count || 0;
      tags.push(draftTag); // 常に最後に配置
    }
    return tags;
  };

  /**
   * 指定されたタグで記事をフィルタリングする
   * - デフォルトは公開記事のみを対象
   * - slugが 'draft' の場合のみ下書きを対象
   * @param {string} slug - フィルタするタグのslug（nullの場合は全記事を返す）
   * @returns {Array} フィルタリングされた記事の配列
   */
  const filterPostsByTag = (slug) => {
    const base = slug === 'draft'
      ? state.allPosts.filter(isDraftPost)
      : state.allPosts.filter(isPublishedPost);

    if (!slug) return base;
    if (slug === 'draft') return base;

    return base.filter(post =>
      (post.tags || []).some(tag => toTagObject(tag).slug === slug)
    );
  };

  /**
   * 記事カードのHTML文字列を生成する
   * @param {Object} post - 記事オブジェクト
   * @param {number} index - 記事のインデックス（アニメーション遅延に使用）
   * @returns {string} 記事カードのHTML文字列
   */
  const createPostCardHTML = (post, index) => {
    // デフォルト画像のパス
    const defaultImg = 'assets/img/article-templates/new_default.svg';
    const imageSrc = post.image?.src || defaultImg;
    const imageAlt = post.image?.alt || post.title;
    const statusBadge = isDraftPost(post) ? '<span class="post-status badge-draft">下書き</span>' : '';
    // タグリストのHTMLを生成
    const tagsHTML = (post.tags || []).map(tag => {
      const tagObj = toTagObject(tag);
      return `<li class="tag" data-tag-slug="${tagObj.slug}" style="cursor: pointer;">${tagObj.label}</li>`;
    }).join('');

    return `
      <li class="post-card animate-on-scroll" style="animation-delay: ${index * 0.05}s;">
        <a href="${post.url}" class="post-card-link" aria-label="${post.title}">
          <figure class="post-card-cover">
            <img src="${imageSrc}" alt="${imageAlt}" loading="lazy" decoding="async" width="640" height="360">
          </figure>
          <div class="post-card-body">
            <div class="post-meta"><span class="post-date">${formatDate(post.date)}</span>${statusBadge}</div>
            <h3>${post.title}</h3>
            <p class="post-summary">${post.summary ?? ''}</p>
            ${tagsHTML ? `<ul class="tag-list">${tagsHTML}</ul>` : ''}
          </div>
        </a>
      </li>
    `;
  };

  /**
   * 記事一覧を画面に描画する
   * @param {Array} posts - 描画する記事の配列
   * @param {boolean} append - trueの場合は追加描画、falseの場合は全描画
   */
  const renderPosts = (posts, append = false) => {
    // 表示件数分の記事を抽出
    const postsToShow = posts.slice(0, state.visibleCount);
    const html = postsToShow.map(createPostCardHTML).join('');

    if (posts.length > 0) {
      if (append) {
        // 追加読み込みの場合は、既存のリストの末尾に追加する形にするのが理想だが、
        // ここでは簡易的にinnerHTMLを書き換える（アニメーションリセットされるが許容）
        // もしくは、新しく追加される分だけ生成してappendする方が良い。
        // 今回は実装をシンプルにするため、全再描画とするが、
        // アニメーションのちらつきを防ぐなら差分更新が必要。
        // -> 差分更新ロジックに変更
        const currentCount = elements.list.children.length;
        const newPosts = postsToShow.slice(currentCount);
        if (newPosts.length > 0) {
          const newHtml = newPosts.map((post, idx) => createPostCardHTML(post, idx)).join('');
          // 既存リストの末尾に新しい記事カードを追加
          elements.list.insertAdjacentHTML('beforeend', newHtml);
        }
      } else {
        // 初回またはフィルタ変更時は全書き換え
        elements.list.innerHTML = html;
      }
    } else {
      // 該当記事がない場合のメッセージ表示
      elements.list.innerHTML = `<li class="no-results">該当する記事が見つかりませんでした。</li>`;
    }

    // "Load More" ボタンの表示制御
    if (elements.loadMoreContainer) {
      if (state.visibleCount < posts.length) {
        // まだ表示していない記事がある場合はボタンを表示
        elements.loadMoreContainer.style.display = 'block';
      } else {
        // すべての記事を表示済みの場合はボタンを非表示
        elements.loadMoreContainer.style.display = 'none';
      }
    }

    // アニメーション再適用
    initScrollAnimations();
  };

  /**
   * タグ候補リストを描画する
   */
  const renderTagSuggestions = () => {
    const query = normalize(state.searchQuery);
    // 検索クエリがあれば部分一致でフィルタ、なければ全タグ表示
    const suggestions = query
      ? state.allTags.filter(tag => normalize(tag.label).includes(query) || normalize(tag.slug).includes(query))
      : state.allTags;

    if (suggestions.length > 0) {
      elements.tagSuggestions.innerHTML = suggestions.slice(0, 18).map(tag => {
        const isActive = state.selectedTag?.slug === tag.slug;
        return `
          <button type="button" class="tag-search-chip${isActive ? ' active' : ''}" data-tag-slug="${tag.slug}">
            <span>${tag.label}</span>
            <span class="tag-count">${tag.count}件</span>
          </button>
        `;
      }).join('');
    } else {
      elements.tagSuggestions.innerHTML = `<p class="tag-search-empty">該当するタグが見つかりません。</p>`;
    }
  };

  /**
   * UIを更新する（記事一覧、タグ候補、フィルタ状態の表示）
   * @param {boolean} append - trueの場合は追加更新
   */
  const updateUI = (append = false) => {
    renderPosts(state.filteredPosts, append);
    renderTagSuggestions();

    // 選択中タグの表示更新
    if (state.selectedTag) {
      elements.selectedTagWrapper.hidden = false;
      elements.selectedTagLabel.textContent = `${state.selectedTag.label} (${state.filteredPosts.length}件)`;
    } else {
      elements.selectedTagWrapper.hidden = true;
    }

    // フィルタ状態のテキスト更新
    if (state.selectedTag) {
      elements.filterStatus.textContent = `タグ「${state.selectedTag.label}」でフィルタ中 (${state.filteredPosts.length}件)`;
    } else {
      elements.filterStatus.textContent = `全${state.filteredPosts.length}件の記事を表示中`;
    }

    // 検索クリアボタンの有効/無効を制御
    elements.tagSearchClear.disabled = !state.searchQuery;
  };

  /**
   * タグフィルタを適用する
   * @param {Object|null} tag - 適用するタグオブジェクト（nullの場合はフィルタ解除）
   */
  const applyTagFilter = (tag) => {
    state.selectedTag = tag;
    state.filteredPosts = filterPostsByTag(tag?.slug);
    state.visibleCount = INITIAL_DISPLAY_COUNT; // フィルタ変更時はリセット

    // URLのクエリパラメータを更新
    const url = new URL(window.location);
    if (tag) {
      url.searchParams.set('tag', tag.slug);
    } else {
      url.searchParams.delete('tag');
    }
    // ブラウザ履歴に追加（ページはリロードしない）
    window.history.pushState({}, '', url);

    updateUI(false);
  };

  // --- イベントリスナーの登録 ---

  // タグ検索の入力イベント
  elements.tagSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderTagSuggestions();
    elements.tagSearchClear.disabled = !state.searchQuery;
  });

  // タグ検索のクリアボタン
  elements.tagSearchClear.addEventListener('click', () => {
    state.searchQuery = '';
    elements.tagSearchInput.value = '';
    elements.tagSearchInput.focus();
    renderTagSuggestions();
    elements.tagSearchClear.disabled = true;
  });

  // 選択中タグのクリアボタン
  elements.selectedTagClear.addEventListener('click', () => applyTagFilter(null));

  // タグ候補のクリックイベント
  elements.tagSuggestions.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-tag-slug]');
    if (!button) return;
    const slug = button.dataset.tagSlug;
    const tag = state.allTags.find(t => t.slug === slug);
    if (tag) {
      // 既に選択中のタグをクリックした場合はフィルタ解除
      applyTagFilter(state.selectedTag?.slug === slug ? null : tag);
    }
  });

  // 記事カード内のタグクリックイベント
  elements.list.addEventListener('click', (e) => {
    const tagEl = e.target.closest('.tag[data-tag-slug]');
    if (!tagEl) return;
    e.preventDefault();
    e.stopPropagation();
    const slug = tagEl.dataset.tagSlug;
    const tag = state.allTags.find(t => t.slug === slug);
    if (tag) {
      applyTagFilter(tag);
      // タグ検索パネルまでスクロール
      elements.tagSearchPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // タグ検索パネルの開閉トグル（モバイル用）
  elements.tagSearchToggle.addEventListener('click', () => {
    const isExpanded = elements.tagSearchToggle.getAttribute('aria-expanded') === 'true';
    elements.tagSearchToggle.setAttribute('aria-expanded', !isExpanded);
    elements.tagSearchPanel.dataset.mobileOpen = String(!isExpanded);
  });

  // 「もっと見る」ボタンのクリックイベント
  if (elements.loadMoreBtn) {
    elements.loadMoreBtn.addEventListener('click', () => {
      state.visibleCount += LOAD_MORE_INCREMENT;
      updateUI(true);
    });
  }

  // --- データ読み込みと初期化 ---

  // スケルトンスクリーン（ローディング表示）を表示
  elements.list.innerHTML = Array(6).fill('<li class="post-card skeleton"><div class="skeleton-media"></div><div class="post-card-body"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></li>').join('');

  // 記事データをJSON形式で読み込み
  fetch(`data/posts.json?v=${new Date().getTime()}`, { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(posts => {
      const normalizedPosts = Array.isArray(posts) ? posts : [];
      // 記事データを日付順にソートして保存
      state.allPosts = normalizedPosts.sort(comparePosts);
      // タグのインデックスを構築
      state.allTags = buildTagIndex(state.allPosts);
      state.isLoading = false;
      elements.tagSearchInput.disabled = false;

      // URLパラメータから初期タグを取得
      const initialTagSlug = new URLSearchParams(window.location.search).get('tag');
      const initialTag = initialTagSlug ? state.allTags.find(t => t.slug === initialTagSlug) : null;

      // 初期フィルタを適用して表示
      applyTagFilter(initialTag);
    })
    .catch(error => {
      console.error('記事一覧の読み込みに失敗しました', error);
      elements.list.innerHTML = '';
      elements.errorLabel.textContent = '記事一覧の読み込みに失敗しました。';
      state.isLoading = false;
      updateUI();
    });

  // --- ユーティリティ関数 ---

  /** ISO形式の日付を日本語形式に変換 */
  const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString('ja-JP') : '';
  /** 記事を日付の降順でソート */
  const comparePosts = (a, b) => new Date(b.date) - new Date(a.date);
  /** タグを統一されたオブジェクト形式に変換 */
  const toTagObject = (tag) => (typeof tag === 'object' ? tag : { slug: normalize(tag), label: tag });
};


/**
 * 全体の初期化
 */
window.initMain = () => {
  initHeaderScroll();
  initSmoothScroll();
  initScrollAnimations();
  initPostList();
};

// 初回読み込み
document.addEventListener('DOMContentLoaded', () => {
  window.initMain();
});
