/**
 * @fileoverview 記事検索機能 (Fuse.js)
 * Fuse.jsを使用した曖昧検索により、記事のタイトル、要約、タグから
 * キーワードにマッチする記事をリアルタイムで検索します。
 */

const isPublishedPost = (post) => (post?.status || 'published') === 'published';

/**
 * 記事検索機能の初期化
 * Fuse.jsを使った曖昧検索を初期化し、検索入力フィールドにイベントリスナーを登録します。
 * Barba.jsなどのSPA遷移後にも呼び出せるようにグローバル関数として定義しています。
 */
window.initSearch = async () => {
    // DOM要素を取得
    const searchInput = document.getElementById('search-input');   // 検索入力フィールド
    const searchResults = document.getElementById('search-results'); // 検索結果のドロップダウン

    // 検索バーが存在しないページでは何もしない
    if (!searchInput || !searchResults) return;

    // 既に初期化済み（イベントリスナー登録済み）の場合は重複を防ぐためにチェック
    // 簡易的な実装として、data属性でマーキングします
    if (searchInput.dataset.searchInitialized) return;
    searchInput.dataset.searchInitialized = 'true';

    // Fuse.jsインスタンスと記事データを格納する変数
    let fuse;
    let posts = [];

    // --- 記事データの取得とFuse.jsの初期化 ---
    try {
        // posts.jsonから記事データを非同期で取得
        const response = await fetch('/data/posts.json');
        if (!response.ok) throw new Error('Failed to load posts');
        const loaded = await response.json();
        const normalized = Array.isArray(loaded) ? loaded : [];
        posts = normalized.filter(isPublishedPost);

        // Fuse.jsの初期化
        // 検索対象フィールドとスコアリングパラメータを設定
        const options = {
            keys: ['title', 'summary', 'tags'], // タイトル、要約、タグを検索対象とする
            threshold: 0.4, // マッチング精度（0.0: 完全一致、1.0: 何でもマッチ）
            distance: 100, // マッチする最大文字距離
        };

        // Fuse.jsが読み込まれているか確認してインスタンスを作成
        if (window.Fuse) {
            fuse = new window.Fuse(posts, options);
        } else {
            console.error('Fuse.js library not loaded');
            return;
        }

    } catch (error) {
        console.error('Error initializing search:', error);
        return;
    }

    /**
     * 検索を実行する関数
     * クエリ文字列が空の場合は検索結果を非表示にし、
     * クエリがある場合はFuse.jsで曖昧検索を実行して結果を表示します。
     * @param {string} query - 検索クエリ文字列
     */
    const performSearch = (query) => {
        // クエリが空の場合は検索結果を非表示にする
        if (!query) {
            searchResults.style.display = 'none';
            searchResults.innerHTML = '';
            return;
        }

        // Fuse.jsによる曖昧検索を実行
        const results = fuse.search(query);
        // 検索結果を表示
        displayResults(results);
    };

    /**
     * 検索結果をドロップダウンリストとして表示する関数
     * 結果が0件の場合は非表示にし、1件以上ある場合は上位5件を表示します。
     * @param {Array} results - Fuse.jsの検索結果配列
     */
    const displayResults = (results) => {
        // 既存の検索結果をクリア
        searchResults.innerHTML = '';

        // 結果が0件の場合はドロップダウンを非表示
        if (results.length === 0) {
            searchResults.style.display = 'none';
            return;
        }

        // 検索結果のドロップダウンを表示
        searchResults.style.display = 'block';
        const ul = document.createElement('ul');
        ul.className = 'search-results-list';

        // 上位5件のみを表示（スクロール可能）
        results.slice(0, 5).forEach(({ item }) => {
            const li = document.createElement('li');
            li.className = 'search-result-item';

            // 各結果アイテムへのリンクを作成
            const link = document.createElement('a');
            const href = item.url ? `/${item.url}` : `/posts/${item.slug}.html`;
            link.href = href;
            link.className = 'search-result-link';

            // タイトル要素を作成
            const title = document.createElement('div');
            title.className = 'search-result-title';
            title.textContent = item.title;

            // 日付要素を作成（公開日時を表示）
            const date = document.createElement('div');
            date.className = 'search-result-date';
            date.textContent = item.date;

            // DOM構造を組み立て（リンク > タイトル + 日付）
            link.appendChild(title);
            link.appendChild(date);
            li.appendChild(link);
            ul.appendChild(li);
        });

        // 検索結果をDOMに追加
        searchResults.appendChild(ul);
    };

    // --- イベントリスナーの登録 ---

    /**
     * 検索入力フィールドのinputイベント
     * ユーザーが文字を入力するたびにリアルタイムで検索を実行します
     */
    searchInput.addEventListener('input', (e) => {
        performSearch(e.target.value);
    });

    /**
     * クリックアウトで検索結果を閉じる
     * 検索フィールドまたは結果ドロップダウン以外をクリックした際に、
     * ドロップダウンを自動的に閉じます。
     *
     * Note: documentへのリスナーはページ遷移しても残る可能性があるため、
     * Barba.js利用時は注意が必要ですが、ここでは簡易的に追加しています。
     * 厳密にはクリーンアップが必要です。
     */
    const closeHandler = (e) => {
        // クリックされた要素が検索フィールドまたは結果ドロップダウンの外側の場合
        if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
        }
    };
    document.addEventListener('click', closeHandler);
};

// 初回読み込み時に検索機能を初期化
document.addEventListener('DOMContentLoaded', () => {
    window.initSearch();
});
