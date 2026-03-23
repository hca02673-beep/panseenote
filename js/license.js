/**
 * ライセンスキー形式チェック（本物判定はサーバーのみ）と GAS API 呼び出し
 */
(function (global) {
  "use strict";

  /** 推奨形式: PN1-XXXX-XXXX-XXXX（英数字大文字） */
  var LICENSE_KEY_RE = /^PN1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  var ERROR_CODE_MESSAGES = {
    INVALID_JSON: "通信データが不正です",
    INVALID_ACTION: "サーバー要求が不正です",
    INVALID_LICENSE_FORMAT: "ライセンスキー形式が不正です",
    LICENSE_NOT_FOUND: "ライセンスキーが見つかりません",
    LICENSE_DELETED: "このライセンスは無効です",
    INTERNAL_ERROR: "サーバーエラーが発生しました",
  };

  function normalizeLicenseKeyInput(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function isValidLicenseKeyFormat(key) {
    if (!key) return false;
    return LICENSE_KEY_RE.test(String(key).trim().toUpperCase());
  }

  function messageForErrorCode(code, fallbackMessage) {
    if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
    if (fallbackMessage) return fallbackMessage;
    return "認証に失敗しました";
  }

  /**
   * @param {string} url
   * @param {object} payload
   * @returns {Promise<object>}
   */
  function postLicenseAction(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      return res.json();
    });
  }

  global.PANSEE_license = {
    LICENSE_KEY_RE: LICENSE_KEY_RE,
    normalizeLicenseKeyInput: normalizeLicenseKeyInput,
    isValidLicenseKeyFormat: isValidLicenseKeyFormat,
    messageForErrorCode: messageForErrorCode,
    postLicenseAction: postLicenseAction,
  };
})(typeof window !== "undefined" ? window : globalThis);
