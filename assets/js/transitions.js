/**
 * @fileoverview ページ遷移とスムーズスクロールの制御 (Barba.js + Lenis)
 * - Barba.jsによるSPA風のページ遷移
 * - Lenisによる慣性スクロール
 * - ページ遷移後のスクリプト再初期化 (Prism.js, Main.js, Article.js, etc.)
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. Lenis (Smooth Scroll) Initialization ---
    /**
     * Lenisスムーズスクロールライブラリを初期化します
     * 慣性スクロール効果を提供し、ユーザー体験を向上させます
     */
    const initLenis = () => {
        // Lenisライブラリが読み込まれていない場合は処理を中断
        if (!window.Lenis) return;

        // Lenisインスタンスを生成し、スクロールの挙動を設定
        const lenis = new window.Lenis({
            duration: 1.2,              // スクロールアニメーションの持続時間（秒）
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // イージング関数（指数関数的な減速）
            direction: 'vertical',       // スクロール方向（垂直）
            gestureDirection: 'vertical', // ジェスチャーの方向（垂直）
            smooth: true,                // スムーズスクロールを有効化
            mouseMultiplier: 1,          // マウスホイールの感度調整
            smoothTouch: false,          // タッチデバイスでのスムーズスクロールは無効（パフォーマンス考慮）
            touchMultiplier: 2,          // タッチスクロールの感度調整
        });

        /**
         * requestAnimationFrameを使用してLenisを連続的に更新します
         * これによりスクロールアニメーションが滑らかに動作します
         * @param {number} time - 現在のタイムスタンプ
         */
        function raf(time) {
            lenis.raf(time);  // Lenisの内部状態を更新
            requestAnimationFrame(raf);  // 次のフレームでも呼び出す（ループ）
        }

        // アニメーションループを開始
        requestAnimationFrame(raf);

        // Barba.jsと連携するためにグローバルに公開（必要であれば）
        window.lenis = lenis;
    };

    // Lenisの初期化を実行
    initLenis();


    // --- 2. Barba.js Initialization ---
    // ローカルファイル実行(file://)の場合はCORSエラーになるためBarbaを無効化
    if (window.location.protocol === 'file:') {
        console.warn('Barba.js is disabled on file:// protocol due to CORS restrictions.');
        return;
    }

    // Barba.jsライブラリが読み込まれていない場合は処理を中断
    if (!window.barba) {
        console.warn('Barba.js not loaded.');
        return;
    }

    const barba = window.barba;
    // GSAPアニメーションライブラリが利用可能かチェック
    const hasGsap = typeof gsap !== 'undefined';

    /**
     * Barba.jsを初期化し、SPA（シングルページアプリケーション）風のページ遷移を実現します
     * ページ遷移時にフェードアニメーションを適用します
     */
    barba.init({
        debug: true, // 開発中はtrue（コンソールにデバッグ情報を出力）
        transitions: [
            {
                name: 'fade',  // トランジション名
                /**
                 * ページを離れる際のアニメーション（フェードアウト）
                 * @param {Object} data - Barbaが提供する遷移データ
                 * @returns {Promise} アニメーション完了を示すPromise
                 */
                leave(data) {
                    if (hasGsap) {
                        // GSAPを使用したフェードアウトアニメーション
                        return gsap.to(data.current.container, {
                            opacity: 0,      // 透明度を0に
                            duration: 0.5    // 0.5秒かけてアニメーション
                        });
                    }
                    // GSAPがない場合のフォールバック（CSS Transitionsを使用）
                    return new Promise((resolve) => {
                        data.current.container.style.transition = 'opacity 0.5s ease';
                        data.current.container.style.opacity = 0;
                        setTimeout(resolve, 500);  // 500ms後にPromiseを解決
                    });
                },
                /**
                 * 新しいページに入る際のアニメーション（フェードイン）
                 * @param {Object} data - Barbaが提供する遷移データ
                 * @returns {Promise} アニメーション完了を示すPromise
                 */
                enter(data) {
                    if (hasGsap) {
                        // GSAPを使用したフェードインアニメーション
                        return gsap.from(data.next.container, {
                            opacity: 0,      // 透明度0から開始
                            duration: 0.5    // 0.5秒かけてアニメーション
                        });
                    }
                    // GSAPがない場合のフォールバック（CSS Transitionsを使用）
                    data.next.container.style.opacity = 0;
                    data.next.container.style.transition = 'opacity 0.5s ease';
                    return new Promise((resolve) => {
                        data.next.container.offsetHeight; // リフローを強制してCSSを適用
                        data.next.container.style.opacity = 1;  // 透明度を1に戻す
                        setTimeout(resolve, 500);  // 500ms後にPromiseを解決
                    });
                }
            }
        ],
        // ページごとの固有の処理を定義（namespaceで識別）
        views: [
            {
                namespace: 'home',  // ホームページ（トップページ）
                beforeEnter() {
                    // ホームページに入る前の処理（必要に応じて追加）
                },
                afterEnter() {
                    // ホームページに入った後の初期化処理
                    if (window.initMain) window.initMain();      // メイン機能の初期化
                    if (window.initSearch) window.initSearch();  // 検索機能の初期化
                }
            },
            {
                namespace: 'article',  // 記事詳細ページ
                afterEnter() {
                    // 記事ページに入った後の初期化処理
                    if (window.initArticlePage) window.initArticlePage();
                    // Prism.jsによるシンタックスハイライトを再適用
                    if (window.Prism) window.Prism.highlightAll();
                },
                beforeLeave() {
                    // 記事ページを離れる前のクリーンアップ処理
                    // イベントリスナーの削除などを行う
                    if (window.articlePageCleanup) {
                        window.articlePageCleanup();
                        window.articlePageCleanup = null;
                    }
                }
            }
        ]
    });

    // --- 3. Global Hooks (全ページ共通の再初期化) ---
    /**
     * ページ遷移完了後に実行される共通処理
     * スクロール位置のリセット、Google Analyticsの送信、共通スクリプトの再初期化を行います
     */
    barba.hooks.after((data) => {
        // スクロール位置をトップに戻す（Lenisを使っている場合はLenisで戻す）
        if (window.lenis) {
            window.lenis.scrollTo(0, { immediate: true });  // Lenisで即座にトップにスクロール
        } else {
            window.scrollTo(0, 0);  // 標準のスクロール
        }

        // Google Analytics (gtag) のページビュー送信
        // ページ遷移をアナリティクスに記録します
        if (typeof gtag === 'function') {
            gtag('config', 'UA-XXXXXXXXX-X', { // 実際のIDに置き換えるか、既存のタグから取得
                'page_path': window.location.pathname
            });
        }

        // 共通スクリプトの再初期化
        // ヘッダースクロール、スムーズスクロール、アニメーションなどを再適用
        if (window.initMain) window.initMain();
    });

});
