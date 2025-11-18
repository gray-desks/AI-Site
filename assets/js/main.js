// ============================================
// AI情報ブログ - インタラクティブUI v2.0
// ============================================

// === スクロール時のヘッダー効果 ===
(function initHeaderScroll() {
  const header = document.querySelector('.site-header');
  let lastScroll = 0;
  const scrollThreshold = 50;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > scrollThreshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
  }, { passive: true });
})();

// === スムーズスクロールアニメーション ===
(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      e.preventDefault();
      const target = document.querySelector(href);

      if (target) {
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
})();

// === インターセクションオブザーバー（要素のフェードイン） ===
(function initScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // アニメーション対象要素を監視
  const animateElements = document.querySelectorAll(
    '.post-card, .workflow-card, .source-card, .info-panel, .hero-panel'
  );

  animateElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    observer.observe(el);
  });
})();

// === 記事一覧の読み込み ===
(function loadPosts() {
  const list = document.getElementById('post-list');
  const errorLabel = document.getElementById('post-error');
  const defaultCardImage = 'assets/img/articles/ai-core-01.svg';

  if (!list) return;

  const tagSearchElements = {
    panel: document.getElementById('tag-search-panel'),
    input: document.getElementById('tag-search-input'),
    clearButton: document.getElementById('tag-search-clear'),
    selectedWrapper: document.getElementById('tag-search-selected'),
    selectedLabel: document.getElementById('tag-search-selected-label'),
    selectedClear: document.getElementById('tag-search-selected-clear'),
    suggestions: document.getElementById('tag-search-suggestions'),
    status: document.getElementById('tag-filter-status'),
    toggle: document.getElementById('tag-search-toggle'),
  };

  if (tagSearchElements.input) tagSearchElements.input.disabled = true;
  if (tagSearchElements.clearButton) tagSearchElements.clearButton.disabled = true;
  if (tagSearchElements.status) {
    tagSearchElements.status.textContent = 'タグ情報を読み込み中...';
  }

  const tagSearchState = {
    posts: [],
    filteredPosts: [],
    tags: [],
    query: '',
    selectedTag: null,
    hasLoadedPosts: false,
  };

  const normalizeFilterValue = (value) => {
    if (value === null || value === undefined) return '';
    return value.toString().normalize('NFKC').trim().toLowerCase();
  };

  const buildTagIndex = (posts) => {
    const tagMap = new Map();
    posts.forEach((post) => {
      const postTags = Array.isArray(post.tags) ? post.tags : [];
      postTags.forEach((tag, index) => {
        const normalized = toTagObject(tag, index);
        const key = normalized.slug || normalized.label || `tag-${index + 1}`;
        if (!tagMap.has(key)) {
          tagMap.set(key, { ...normalized, count: 1 });
        } else {
          const existing = tagMap.get(key);
          existing.count += 1;
        }
      });
    });
    return Array.from(tagMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, 'ja');
    });
  };

  const filterPostsByTagSlug = (slug) => {
    const posts = Array.isArray(tagSearchState.posts) ? tagSearchState.posts : [];
    if (!slug) return [...posts];
    return posts.filter((post) => {
      const postTags = Array.isArray(post.tags) ? post.tags : [];
      return postTags.some((tag, index) => toTagObject(tag, index).slug === slug);
    });
  };

  const updateSelectedTagUI = () => {
    if (!tagSearchElements.selectedWrapper || !tagSearchElements.selectedLabel) return;
    if (!tagSearchState.selectedTag) {
      tagSearchElements.selectedWrapper.hidden = true;
      tagSearchElements.selectedWrapper.setAttribute('aria-hidden', 'true');
      tagSearchElements.selectedLabel.textContent = '';
      return;
    }
    tagSearchElements.selectedWrapper.hidden = false;
    tagSearchElements.selectedWrapper.removeAttribute('aria-hidden');
    const label = tagSearchState.selectedTag.label;
    const count = tagSearchState.filteredPosts.length;
    tagSearchElements.selectedLabel.textContent = `${label} (${count}件)`;
  };

  const updateFilterStatus = () => {
    if (!tagSearchElements.status) return;
    if (!tagSearchState.posts.length) {
      tagSearchElements.status.textContent = tagSearchState.hasLoadedPosts
        ? '記事がまだ登録されていません。'
        : 'タグ情報を読み込み中...';
      return;
    }
    if (tagSearchState.selectedTag) {
      if (tagSearchState.filteredPosts.length === 0) {
        tagSearchElements.status.textContent = `タグ「${tagSearchState.selectedTag.label}」に該当する記事はまだありません。`;
      } else {
        tagSearchElements.status.textContent = `タグ「${tagSearchState.selectedTag.label}」の記事を${tagSearchState.filteredPosts.length}件表示中`;
      }
    } else {
      tagSearchElements.status.textContent = `全${tagSearchState.posts.length}件の記事を表示中`;
    }
  };

  const updateClearButtonState = () => {
    if (!tagSearchElements.clearButton) return;
    tagSearchElements.clearButton.disabled = tagSearchState.query.length === 0;
  };

  const TAG_SUGGESTION_LIMIT = 18;

  const getFilteredTagSuggestions = () => {
    if (!tagSearchState.query) return tagSearchState.tags;
    const query = normalizeFilterValue(tagSearchState.query);
    if (!query) return tagSearchState.tags;
    return tagSearchState.tags.filter((tag) => {
      const labelText = normalizeFilterValue(tag.label);
      const slugText = normalizeFilterValue(tag.slug);
      return labelText.includes(query) || slugText.includes(query);
    });
  };

  const renderTagSuggestions = () => {
    if (!tagSearchElements.suggestions) return;
    if (!tagSearchState.tags.length) {
      const message = tagSearchState.hasLoadedPosts
        ? 'タグ情報がまだ登録されていません。'
        : 'タグ情報を読み込み中です。';
      tagSearchElements.suggestions.innerHTML = `<p class="tag-search-empty">${message}</p>`;
      return;
    }
    const suggestions = getFilteredTagSuggestions();
    if (!suggestions.length) {
      tagSearchElements.suggestions.innerHTML = '<p class="tag-search-empty">該当するタグが見つかりません。</p>';
      return;
    }
    const items = suggestions.slice(0, TAG_SUGGESTION_LIMIT).map((tag) => {
      const isActive = tagSearchState.selectedTag?.slug === tag.slug;
      return `
        <button
          type="button"
          class="tag-search-chip${isActive ? ' active' : ''}"
          data-tag-select="true"
          data-tag-slug="${tag.slug}"
          role="option"
          aria-selected="${isActive ? 'true' : 'false'}"
          aria-pressed="${isActive ? 'true' : 'false'}"
        >
          <span>${tag.label}</span>
          <span class="tag-count">${tag.count}件</span>
        </button>
      `;
    }).join('');
    tagSearchElements.suggestions.innerHTML = items;
  };

  const applyPostFilter = (tag) => {
    tagSearchState.selectedTag = tag || null;
    tagSearchState.filteredPosts = filterPostsByTagSlug(tagSearchState.selectedTag?.slug);
    renderPosts(tagSearchState.filteredPosts);
    updateSelectedTagUI();
    updateFilterStatus();
    updateClearButtonState();
  };

  const attachTagSearchEvents = () => {
    if (tagSearchElements.input) {
      const handleInputChange = (event) => {
        tagSearchState.query = event.target.value || '';
        renderTagSuggestions();
        updateClearButtonState();
      };
      tagSearchElements.input.addEventListener('input', handleInputChange);
      tagSearchElements.input.addEventListener('search', handleInputChange);
      tagSearchElements.input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const [first] = getFilteredTagSuggestions();
        if (!first) return;
        event.preventDefault();
        applyPostFilter(first);
        renderTagSuggestions();
      });
    }

    if (tagSearchElements.clearButton) {
      tagSearchElements.clearButton.addEventListener('click', () => {
        if (!tagSearchState.query) return;
        tagSearchState.query = '';
        updateClearButtonState();
        if (tagSearchElements.input) {
          tagSearchElements.input.value = '';
          tagSearchElements.input.focus();
        }
        renderTagSuggestions();
      });
    }

    if (tagSearchElements.selectedClear) {
      tagSearchElements.selectedClear.addEventListener('click', () => {
        if (!tagSearchState.selectedTag) return;
        applyPostFilter(null);
        renderTagSuggestions();
      });
    }

    if (tagSearchElements.suggestions) {
      tagSearchElements.suggestions.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        const target = event.target.closest('[data-tag-select="true"]');
        if (!target) return;
        const slug = target.getAttribute('data-tag-slug');
        if (!slug) return;
        const selected = tagSearchState.tags.find((tag) => tag.slug === slug);
        if (!selected) return;
        if (tagSearchState.selectedTag?.slug === selected.slug) {
          applyPostFilter(null);
        } else {
          applyPostFilter(selected);
        }
        renderTagSuggestions();
      });
    }
  };

  const initResponsiveTagSearchLayout = () => {
    if (!tagSearchElements.panel || !tagSearchElements.toggle) return;

    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const layoutState = {
      isMobile: mediaQuery.matches,
      isExpanded: mediaQuery.matches ? false : true,
    };

    const scrollPanelIntoView = () => {
      if (!tagSearchElements.panel) return;
      tagSearchElements.panel.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    };

    const applyState = () => {
      const panel = tagSearchElements.panel;
      const toggle = tagSearchElements.toggle;
      const shouldShowPanel = !layoutState.isMobile || layoutState.isExpanded;

      panel.dataset.mobileOpen = shouldShowPanel ? 'true' : 'false';
      panel.hidden = layoutState.isMobile ? !shouldShowPanel : false;

      toggle.setAttribute('aria-expanded', shouldShowPanel ? 'true' : 'false');
      toggle.setAttribute('aria-label', shouldShowPanel ? 'タグ検索を閉じる' : 'タグ検索を開く');

      if (layoutState.isMobile) {
        toggle.removeAttribute('aria-hidden');
        toggle.tabIndex = 0;
      } else {
        toggle.setAttribute('aria-hidden', 'true');
        toggle.tabIndex = -1;
      }
    };

    const updateViewportState = (isMobile) => {
      layoutState.isMobile = isMobile;
      layoutState.isExpanded = isMobile ? false : true;
      applyState();
    };

    const handleToggleClick = () => {
      if (!layoutState.isMobile) return;
      layoutState.isExpanded = !layoutState.isExpanded;
      applyState();
      if (layoutState.isExpanded && tagSearchElements.input) {
        requestAnimationFrame(() => {
          tagSearchElements.input.focus({ preventScroll: true });
          scrollPanelIntoView();
        });
      }
    };

    tagSearchElements.toggle.addEventListener('click', handleToggleClick);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', (event) => updateViewportState(event.matches));
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener((event) => updateViewportState(event.matches));
    }

    applyState();
  };

  attachTagSearchEvents();
  initResponsiveTagSearchLayout();
  renderTagSuggestions();

  const enhanceCardAccessibility = () => {
    list.querySelectorAll('.post-card').forEach(card => {
      if (card.dataset.accessibilityInit === 'true') return;
      card.dataset.accessibilityInit = 'true';
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'article');
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const link = card.querySelector('a');
          if (link) link.click();
        }
      });
    });
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    const normalized = isoString.replaceAll('/', '-');
    const date = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(date.getTime())) return isoString;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  };

  const getSortableTimestamp = (post) => {
    if (!post) return 0;
    const candidateValues = [post.publishedAt, post.updatedAt];
    for (const value of candidateValues) {
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }
    if (post.date) {
      const parsed = new Date(`${post.date}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }
    return 0;
  };

  const comparePosts = (a, b) => {
    const timeDiff = getSortableTimestamp(b) - getSortableTimestamp(a);
    if (timeDiff !== 0) return timeDiff;

    if (a?.date && b?.date) {
      const dateDiff = new Date(b.date) - new Date(a.date);
      if (!Number.isNaN(dateDiff) && dateDiff !== 0) {
        return dateDiff;
      }
    }

    const slugA = (a?.slug || a?.url || '').toString();
    const slugB = (b?.slug || b?.url || '').toString();
    return slugB.localeCompare(slugA, undefined, { sensitivity: 'base', numeric: true });
  };

  const slugifyTag = (value, fallback = 'tag') => {
    if (!value) return fallback;
    const normalized = value
      .toString()
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return normalized || fallback;
  };

  const toTagObject = (tag, index = 0) => {
    if (tag && typeof tag === 'object') {
      return {
        slug: tag.slug || slugifyTag(tag.label || `tag-${index + 1}`),
        label: tag.label || tag.slug || `タグ${index + 1}`,
        category: tag.category || 'その他',
        style: tag.style || null,
      };
    }
    const label = (tag ?? '').toString().trim();
    return {
      slug: slugifyTag(label || `tag-${index + 1}`),
      label: label || `タグ${index + 1}`,
      category: 'その他',
      style: null,
    };
  };

  const createTagMarkup = (tags) => {
    if (!Array.isArray(tags) || tags.length === 0) return '';
    const items = tags
      .map((tag, index) => {
        const normalized = toTagObject(tag, index);
        const attrs = [
          normalized.slug ? `data-tag-slug="${normalized.slug}"` : '',
          normalized.category ? `data-tag-category="${normalized.category}"` : '',
          normalized.style ? `data-tag-style="${normalized.style}"` : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<li class="tag"${attrs ? ` ${attrs}` : ''}>${normalized.label}</li>`;
      })
      .join('');
    return items ? `<ul class="tag-list">${items}</ul>` : '';
  };

  const renderPosts = (posts) => {
    list.innerHTML = '';

    posts.forEach((post, index) => {
      const item = document.createElement('li');
      item.className = 'post-card';

      // スタガードアニメーション（順次表示）
      item.style.animationDelay = `${index * 0.1}s`;

      const tags = Array.isArray(post.tags) ? post.tags : [];
      const tagMarkup = createTagMarkup(tags);
      const imageSrc = (post?.image && post.image.src) || defaultCardImage;
      const imageAlt = (post?.image && post.image.alt) || `${post.title}のイメージ`;
      const coverMarkup = `
        <figure class="post-card-cover">
          <img src="${imageSrc}" alt="${imageAlt}" loading="lazy" decoding="async" width="640" height="360">
        </figure>`;

      item.innerHTML = `
        ${coverMarkup}
        <div class="post-card-body">
          <div class="post-meta">${formatDate(post.date)}</div>
          <h3><a href="${post.url}">${post.title}</a></h3>
          <p class="post-summary">${post.summary ?? ''}</p>
          ${tagMarkup}
        </div>
      `;

      // カード全体をクリック可能に
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'A') {
          const link = item.querySelector('h3 a');
          if (link) link.click();
        }
      });

      list.appendChild(item);
    });

    // 追加後にアニメーション監視を再実行
    setTimeout(() => {
      const cards = list.querySelectorAll('.post-card');
      cards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';

        // すぐに表示開始
        requestAnimationFrame(() => {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        });
      });
    }, 10);

    enhanceCardAccessibility();
  };

  // スケルトンローダーの表示
  const showSkeleton = () => {
    list.innerHTML = Array(3)
      .fill(0)
      .map(
        () => `
      <li class="post-card skeleton">
        <div class="skeleton-media"></div>
        <div class="post-card-body">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>
      </li>
    `,
      )
      .join('');
  };

  showSkeleton();

  fetch('data/posts.json', { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((posts) => {
      const sorted = [...posts].sort(comparePosts);

      // データ取得後、少し遅延させて表示（UX向上）
      setTimeout(() => {
        tagSearchState.posts = sorted;
        tagSearchState.tags = buildTagIndex(sorted);
        tagSearchState.query = '';
        tagSearchState.hasLoadedPosts = true;
        if (tagSearchElements.input) {
          tagSearchElements.input.disabled = tagSearchState.tags.length === 0;
          tagSearchElements.input.value = '';
        }
        applyPostFilter(null);
        renderTagSuggestions();
        if (errorLabel) errorLabel.textContent = '';
      }, 300);
    })
    .catch((error) => {
      console.error('記事一覧の読み込みに失敗しました', error);
      if (errorLabel) {
        errorLabel.textContent = '記事一覧の読み込みに失敗しました。時間をおいて再度お試しください。';
      }
      if (tagSearchElements.status) {
        tagSearchElements.status.textContent = 'タグ情報を取得できませんでした。';
      }
      if (tagSearchElements.suggestions) {
        tagSearchElements.suggestions.innerHTML = '<p class="tag-search-empty">タグ情報を取得できませんでした。</p>';
      }
      if (tagSearchElements.input) {
        tagSearchElements.input.disabled = true;
      }
      if (tagSearchElements.clearButton) {
        tagSearchElements.clearButton.disabled = true;
      }
      list.innerHTML = '';
    });
})();

// === パフォーマンス最適化: Passive Event Listeners ===
(function optimizeScrollPerformance() {
  // すべてのホバー効果をGPU加速
  const cards = document.querySelectorAll('.post-card, .workflow-card, .source-card');
  cards.forEach(card => {
    card.style.willChange = 'transform';
  });
})();

// === ページロード完了時の初期化 ===
window.addEventListener('DOMContentLoaded', () => {
  // フォーカス可視性の強化
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      document.body.classList.add('keyboard-navigation');
    }
  });

  document.addEventListener('mousedown', () => {
    document.body.classList.remove('keyboard-navigation');
  });
});

// === プリロードとパフォーマンス最適化 ===
(function optimizePerformance() {
  // 重要なフォントをプリロード
  const preloadFont = (url) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.crossOrigin = 'anonymous';
    link.href = url;
    document.head.appendChild(link);
  };

  // 画像の遅延読み込み
  const images = document.querySelectorAll('img[data-src]');
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          imageObserver.unobserve(img);
        }
      });
    });

    images.forEach(img => imageObserver.observe(img));
  } else {
    // フォールバック
    images.forEach(img => {
      img.src = img.dataset.src;
    });
  }
})();

console.log('🎨 AI情報ブログ v2.0 - デザインシステム初期化完了');
