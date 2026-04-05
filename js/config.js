/**
 * パンセノート — 設定定数
 * ライセンスAPI: GAS Web アプリ 1 URL に POST（activate / check）
 */
(function (global) {
  "use strict";

  /** GitHub Pages 等のサブパス配信用（PWA 実装時に manifest と揃える想定） */
  var BASE_PATH = "/panseenote/";

  var CONFIG = {
    APP_ID: "PenseeNote",
    APP_VERSION: "1.0.8",
    BUILD_TIMESTAMP: "2026-04-05T04:28:29Z",
    EXPORT_JSON_VERSION: "1.0",
    TERMS_VERSION: "1.0",

    DB_NAME: "panseenote-db",
    DB_VERSION: 1,

    STORES: {
      ENTRIES: "entries",
      LICENSE: "license",
      SETTINGS: "settings",
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

    SPEECH_LANG: "ja-JP",

    /**
     * GAS デプロイ後の Web アプリ URL（/exec で終わる想定）
     * 未設定時は window.__PANSEE_LICENSE_API_URL__ で上書き可能
     */
    LICENSE_API_URL: "https://script.google.com/macros/s/AKfycbzCoZsd9oE5BG_DH6AtmhWLDTvgSmm_aNPu6Y6fMX5qJfgySs1rffdm_xqB9B9ohKs/exec",
  };

  CONFIG.getBasePath = function () {
    return BASE_PATH;
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

  global.PANSEE_CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
