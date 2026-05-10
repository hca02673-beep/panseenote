/**
 * パンセノート — 設定定数
 * ライセンスAPI / 利用状況API の URL 定義
 */
(function (global) {
  "use strict";

  /** GitHub Pages 等のサブパス配信用（PWA 実装時に manifest と揃える想定） */
  var BASE_PATH = "/panseenote/";

  var CONFIG = {
    APP_ID: "PenseeNote",
    APP_VERSION: "1.0.9",
    BUILD_TIMESTAMP: "2026-04-19T03:30:00Z",
    EXPORT_JSON_VERSION: "2.0",
    TERMS_VERSION: "1.1",
    APP_NAME: "パンセノート",
    APP_SHORT_NAME: "パンセノート",
    APP_DESCRIPTION: "紙ノートに書いた情報の索引を、音声と手入力で登録・検索します。",
    THEME_COLOR: "#115e59",
    BACKGROUND_COLOR: "#f6fbfa",

    DB_NAME: "panseenote-db",
    DB_VERSION: 2,

    STORES: {
      ENTRIES: "entries",
      LICENSE: "license",
      SETTINGS: "settings",
      PHOTO_ASSETS: "photo_assets",
    },

    /** 未認証・試用（サーバー返却の itemLimit を正とする） */
    DEFAULT_PLAN_CODE: "trial",
    DEFAULT_PLAN_NAME: "試用版",
    DEFAULT_ITEM_LIMIT: 100,

    LICENSE_DOC_ID: "current",
    SETTINGS_DOC_ID: "app-settings",

    MAX_TITLE_LENGTH: 100,
    SPEECH_TIMEOUT_MS: 10000,
    MAX_SEARCH_DISPLAY: 50,
    PHOTO_LIMIT: 2000,
    PHOTO_MIME_TYPE: "image/jpeg",
    PHOTO_FULL_MAX_EDGE: 1600,
    PHOTO_FULL_QUALITY: 0.72,
    PHOTO_THUMB_MAX_EDGE: 320,
    PHOTO_THUMB_QUALITY: 0.6,
    BACKUP_JSON_NAME: "backup.json",

    SPEECH_LANG: "ja-JP",

    /**
     * GAS デプロイ後の Web アプリ URL（/exec で終わる想定）
     * 未設定時は window.__PANSEE_LICENSE_API_URL__ で上書き可能
     */
    LICENSE_API_URL: "https://script.google.com/macros/s/AKfycbzCoZsd9oE5BG_DH6AtmhWLDTvgSmm_aNPu6Y6fMX5qJfgySs1rffdm_xqB9B9ohKs/exec",

    /**
     * 利用状況モニタリング用 GAS Web アプリ URL
     * 未設定時は window.__PANSEE_USAGE_API_URL__ で上書き可能
     */
    USAGE_API_URL: "https://script.google.com/macros/s/AKfycbxKtFIxNWPyDscAWIJHg2KE0sm4ygj_sqd_ppfdEq4C1xp496hMKFMP2t6yC_Sfu-en/exec",
  };

  CONFIG.getBasePath = function () {
    var base = String(BASE_PATH || "/");
    if (base.charAt(0) !== "/") base = "/" + base;
    if (!/\/$/.test(base)) base += "/";
    return base;
  };

  CONFIG.getAssetUrl = function (relativePath) {
    var base = CONFIG.getBasePath();
    var rel = String(relativePath || "").replace(/^\/+/, "");
    return base + rel;
  };

  CONFIG.getManifestUrl = function () {
    return CONFIG.getAssetUrl("manifest.webmanifest");
  };

  CONFIG.getServiceWorkerUrl = function () {
    return CONFIG.getAssetUrl("service-worker.js");
  };

  CONFIG.getOfflineFallbackUrl = function () {
    return CONFIG.getAssetUrl("offline.html");
  };

  /**
   * @returns {string}
   */
  CONFIG.getLicenseApiUrl = function () {
    var w = typeof global !== "undefined" ? global : {};
    var ovr = w.__PANSEE_LICENSE_API_URL__;
    var u = ovr != null && String(ovr).trim() !== "" ? String(ovr).trim() : CONFIG.LICENSE_API_URL;
    return String(u || "").trim();
  };

  CONFIG.getUsageApiUrl = function () {
    var w = typeof global !== "undefined" ? global : {};
    var ovr = w.__PANSEE_USAGE_API_URL__;
    var u = ovr != null && String(ovr).trim() !== "" ? String(ovr).trim() : CONFIG.USAGE_API_URL;
    return String(u || "").trim();
  };

  global.PANSEE_CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
