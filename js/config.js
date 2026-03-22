/**
 * パンセノート — 設定定数（将来: ライセンスAPI・PWA と連携しやすいよう集約）
 * 初版: 管理サーバー未接続のため試用版固定（API無応答と同等）
 */
(function (global) {
  "use strict";

  /** GitHub Pages 等のサブパス配信用（Step 7 で manifest / SW と揃える想定） */
  var BASE_PATH = "/panseenote/";

  var CONFIG = {
    APP_ID: "PenseeNote",
    APP_VERSION: "1.0.0",
    EXPORT_JSON_VERSION: "1.0",

    DB_NAME: "panseenote-db",
    DB_VERSION: 1,

    STORES: {
      ENTRIES: "entries",
      LICENSE: "license",
      SETTINGS: "settings",
    },

    /** 試用版（API未接続時） */
    DEFAULT_PLAN_CODE: "trial",
    DEFAULT_PLAN_NAME: "試用版",
    /** 実機UI検証用に試用版も含め上限を引き上げ（本番ではライセンスで上書き予定） */
    DEFAULT_ITEM_LIMIT: 30000,

    LICENSE_DOC_ID: "current",
    SETTINGS_DOC_ID: "app-settings",

    MAX_TITLE_LENGTH: 100,
    SPEECH_TIMEOUT_MS: 10000,
    MAX_SEARCH_DISPLAY: 50,

    SPEECH_LANG: "ja-JP",

    /** 将来 Step 6: 認証APIベースURLをここまたは環境で差し替え */
    LICENSE_API_BASE: "",
    ACCIDENT_KEY_API_BASE: "",
  };

  CONFIG.getBasePath = function () {
    return BASE_PATH;
  };

  global.PANSEE_CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
