/**
 * @fileoverview Google Analytics 4 (GA4) の初期化スクリプト
 * Google Analyticsのトラッキングタグを動的に読み込み、Webサイトのアクセス解析を開始します。
 * このスクリプトは即時実行関数（IIFE）で囲まれており、グローバルスコープを汚染しません。
 */
(function () {
  'use strict'; // Strictモードを有効にし、より厳格なエラーチェックを行う

  // Google Analytics 測定ID
  var GA_ID = 'G-SPZSXWE8Q1';

  // 既に初期化されている場合、または測定IDが設定されていない場合は、二重実行を防ぐために処理を中断
  if (!GA_ID || window.__AIINFOBLOG_GA_INITIALIZED__) {
    return;
  }
  // 初期化済みフラグをグローバルに設定
  window.__AIINFOBLOG_GA_INITIALIZED__ = true;

  // dataLayerとgtag関数を初期化（Google Tag Managerの標準的な初期化処理）
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      // gtag関数が呼び出された際に、引数をdataLayerにプッシュする
      window.dataLayer.push(arguments);
    };

  // Google Analyticsのライブラリを非同期で読み込むための<script>タグを生成
  var gaScript = document.createElement('script');
  gaScript.async = true; // 非同期読み込みを設定
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  
  // 生成した<script>タグを<head>要素の末尾に追加して、ライブラリの読み込みを開始
  document.head.appendChild(gaScript);

  // gtagコマンドを初期化
  window.gtag('js', new Date()); // 現在時刻でページビューを記録
  window.gtag('config', GA_ID); // 指定した測定IDでGA4を設定
})();