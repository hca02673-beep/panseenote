/**
 * パンセノート — UI オーケストレーション（Step 1〜5）
 */
(function () {
  "use strict";

  var C = window.PANSEE_CONFIG;
  var db = window.PANSEE_db;
  var norm = window.PANSEE_normalizeForSearch;
  var voice = window.PANSEE_voice;
  var lic = window.PANSEE_license;
  var usage = window.PANSEE_usage;

  var state = {
    idb: null,
    license: null,
    settings: null,
    /** @type {null | { id?: string, title: string, book: string, page: string, memo: string }} */
    draft: null,
    searchQuery: "",
    voiceRegisterMode: false,
    voicePreviewEntry: null,
    /** 音声登録モード中に #search-meta へ表示するメッセージ（空なら既定文言） */
    voiceRegisterMetaMsg: "",
    /** 音声検索フローで #search-meta へ表示するカスタムメッセージ（空なら通常表示） */
    voiceSearchMsg: "",
    /** @type {Set<string>} 展開中のメモ行のエントリID */
    openMemoIds: new Set(),
    /** スマホ時は登録日付列を DOM から外した 3 列構造にする */
    isCompactTable: false,
    detachedDateCol: null,
    detachedDateTh: null,
    detachedActionsCol: null,
    detachedActionsTh: null,
    /** 直近の明示検索で確定した表示中サブセット */
    searchSnapshot: null,
    homeSearchQuery: "",
    mobileEditEntryId: "",
    mobileBackGuardReady: false,
    exportBusy: false,
    importBusy: false,
    backupRecommendBusy: false,
    usageSessionStarted: false,
    usageSentThisSession: false,
    usageSendBusy: false,
  };

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function makeAppSelfId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return (
      "ps-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function formatTraceDelta(ms) {
    var n = Number(ms);
    if (!isFinite(n)) return "0.0";
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function createVoiceTimingTrace(kind) {
    var baseMs = nowMs();
    var marks = [{
      name: "button_click",
      atMs: baseMs,
      extra: null,
    }];
    return {
      kind: String(kind || ""),
      baseMs: baseMs,
      mark: function (name, extra) {
        var entry = {
          name: String(name || ""),
          atMs: nowMs(),
          extra: extra || null,
        };
        marks.push(entry);
        try {
          console.info(
            "[voice-trace]",
            this.kind || "unknown",
            entry.name,
            "+" + formatTraceDelta(entry.atMs - baseMs) + "ms",
            entry.extra || ""
          );
        } catch (_) {}
      },
      snapshot: function () {
        return marks.slice();
      },
    };
  }

  function buildVoiceTimingSummary(trace) {
    if (!trace || typeof trace.snapshot !== "function") return "";
    var marks = trace.snapshot();
    if (!marks.length) return "";
    return marks.map(function (mark) {
      var label = String(mark.name || "");
      var extra = "";
      if (mark.extra && typeof mark.extra === "object") {
        if (mark.extra.code) {
          extra = " [" + String(mark.extra.code) + "]";
        } else if (mark.extra.count != null) {
          extra = " [count=" + String(mark.extra.count) + "]";
        } else if (mark.extra.timeoutMs != null) {
          extra = " [timeout=" + String(mark.extra.timeoutMs) + "ms]";
        } else if (mark.extra.empty != null) {
          extra = mark.extra.empty ? " [empty]" : " [text]";
        }
      }
      return label + ": +" + formatTraceDelta(mark.atMs - trace.baseMs) + "ms" + extra;
    }).join(" / ");
  }

  function appendVoiceTimingNote(note, trace) {
    var base = String(note || "");
    var timing = buildVoiceTimingSummary(trace);
    if (!timing) return base;
    return base ? (base + " 計測: " + timing) : ("計測: " + timing);
  }

  /**
   * 規約モーダルを表示し、ユーザーが同意したら解決する Promise を返す。
   * @returns {Promise<void>}
   */
  function showTermsModal() {
    return new Promise(function (resolve) {
      var overlay = $("#terms-modal");
      var check = $("#terms-agree-check");
      var btn = $("#btn-terms-agree");
      if (!overlay || !check || !btn) {
        resolve();
        return;
      }

      overlay.removeAttribute("hidden");

      check.addEventListener("change", function () {
        btn.disabled = !check.checked;
      });

      btn.addEventListener("click", function () {
        if (!check.checked) return;
        db.updateSettings(state.idb, {
          termsAcceptedAt: new Date().toISOString(),
          termsVersion: C.TERMS_VERSION,
        }).then(function (updated) {
          state.settings = updated;
          overlay.setAttribute("hidden", "");
          resolve();
        });
      });
    });
  }

  /** 規約承認が必要なら showTermsModal を呼び出し、不要なら即時解決する。 */
  function checkTerms() {
    if (
      state.settings &&
      state.settings.termsVersion === C.TERMS_VERSION
    ) {
      return Promise.resolve();
    }
    return showTermsModal();
  }

  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      el.classList.remove("show");
    }, 3200);
  }

  function isAbortError(err) {
    return !!(err && (err.name === "AbortError" || err.code === 20));
  }

  function setDataTransferBusyUi(mode, isBusy) {
    if (mode === "export") state.exportBusy = !!isBusy;
    if (mode === "import") state.importBusy = !!isBusy;
    var disabled = !!(state.exportBusy || state.importBusy);
    var exportBtn = $("#btn-export");
    var importBtn = $("#btn-import-trigger");
    if (exportBtn) exportBtn.disabled = disabled;
    if (importBtn) importBtn.disabled = disabled;
  }

  function buildBackupFileName() {
    return "panseenote-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  }

  function normalizeFileLabel(name, fallback) {
    var s = String(name || "").trim();
    if (s) return s;
    return String(fallback || "ブラウザ管理");
  }

  function buildBackupFilePayload() {
    return Promise.all([
      db.getAllEntries(state.idb),
      db.getLicense(state.idb),
    ]).then(function (pair) {
      var rows = sortEntries(pair[0]);
      var lic = pair[1];
      var payload = {
        app: C.APP_ID,
        version: C.EXPORT_JSON_VERSION,
        exportedAt: new Date().toISOString(),
        planCode: lic.planCode,
        itemLimit: lic.itemLimit,
        items: rows.map(function (e) {
          return {
            title: e.title,
            book: e.book,
            page: e.page,
            memo: e.memo || "",
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          };
        }),
      };
      return {
        blob: new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
        name: buildBackupFileName(),
      };
    });
  }

  function persistSettingsPatch(patch) {
    return db.updateSettings(state.idb, patch).then(function (s) {
      state.settings = s;
      updatePlanBar();
      return s;
    });
  }

  function persistBackupExportInfo(fileLabel) {
    var iso = new Date().toISOString();
    return persistSettingsPatch({
      lastBackupAt: iso,
      lastBackupPath: normalizeFileLabel(fileLabel, "ブラウザ管理"),
      unsavedChangeCount: 0,
    }).then(function (s) {
      closeSettingsIfOpen();
      return s;
    });
  }

  function persistBackupImportInfo(fileLabel) {
    var iso = new Date().toISOString();
    return persistSettingsPatch({
      lastImportAt: iso,
      lastImportPath: normalizeFileLabel(fileLabel, "ブラウザ管理"),
      unsavedChangeCount: 0,
    });
  }

  function incrementUnsavedChangeCount() {
    if (!state.idb || !state.settings) return Promise.resolve();
    var current = Number(state.settings.unsavedChangeCount || 0);
    return persistSettingsPatch({
      unsavedChangeCount: current + 1,
    });
  }

  function requestSaveFileHandle(name) {
    return window.showSaveFilePicker({
      suggestedName: name,
      types: [
        {
          description: "JSON ファイル",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });
  }

  function writeBackupToHandle(handle, blob) {
    return handle.createWritable().then(function (writable) {
      return writable.write(blob).then(function () {
        return writable.close();
      });
    });
  }

  function canShareBackupFile(file) {
    if (!navigator.share || !file || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [file] });
    } catch (_) {
      return false;
    }
  }

  function shareBackupFile(file, name) {
    return navigator.share({
      title: name,
      text: "パンセノートのバックアップファイルです。",
      files: [file],
    });
  }

  function triggerBackupDownload(blob, name) {
    return new Promise(function (resolve) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 500);
      resolve("download");
    });
  }

  function exportBackupFile(blob, name) {
    if (typeof window.showSaveFilePicker === "function") {
      return saveBackupViaFilePicker(blob, name).then(function () {
        return {
          mode: "saved",
          fileLabel: normalizeFileLabel(name, "ブラウザ管理"),
        };
      });
    }
    var file = null;
    try {
      file = new File([blob], name, { type: "application/json" });
    } catch (_) {
      file = null;
    }
    if (canShareBackupFile(file)) {
      return shareBackupFile(file, name).then(function () {
        return {
          mode: "shared",
          fileLabel: normalizeFileLabel(name, "ブラウザ管理"),
        };
      });
    }
    return triggerBackupDownload(blob, name).then(function () {
      return {
        mode: "download",
        fileLabel: normalizeFileLabel(name, "ブラウザ管理"),
      };
    });
  }

  function requestImportFileViaPicker() {
    if (typeof window.showOpenFilePicker !== "function") {
      return Promise.resolve(null);
    }
    return window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "JSON ファイル",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    }).then(function (handles) {
      if (!handles || !handles[0]) return null;
      return handles[0].getFile();
    });
  }

  function requestImportFileViaInput() {
    var input = $("#import-file");
    if (!input) return Promise.resolve(null);
    input.value = "";
    return new Promise(function (resolve) {
      var settled = false;
      function cleanup() {
        input.removeEventListener("change", onChange);
        window.removeEventListener("focus", onFocus, true);
      }
      function finish(file) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(file || null);
      }
      function onChange() {
        window.setTimeout(function () {
          finish(input.files && input.files[0] ? input.files[0] : null);
        }, 0);
      }
      function onFocus() {
        window.setTimeout(function () {
          if (settled) return;
          finish(input.files && input.files[0] ? input.files[0] : null);
        }, 800);
      }
      input.addEventListener("change", onChange);
      window.addEventListener("focus", onFocus, true);
      input.click();
    });
  }

  function requestImportFile() {
    if (typeof window.showOpenFilePicker === "function") {
      return requestImportFileViaPicker().catch(function (err) {
        if (isAbortError(err)) return null;
        throw err;
      });
    }
    return requestImportFileViaInput();
  }

  function showAppDialog(options) {
    return new Promise(function (resolve) {
      var overlay = $("#app-dialog");
      var msgEl = $("#app-dialog-message");
      var detailEl = $("#app-dialog-detail");
      var okBtn = $("#app-dialog-ok");
      var cancelBtn = $("#app-dialog-cancel");
      if (!overlay || !msgEl || !detailEl || !okBtn || !cancelBtn) {
        resolve(options && options.cancelable === false ? true : false);
        return;
      }

      var cancelable = !options || options.cancelable !== false;
      var prevActive = document.activeElement;
      var done = false;

      msgEl.textContent = String((options && options.message) || "");
      var detail = String((options && options.detail) || "").trim();
      detailEl.textContent = detail;
      detailEl.hidden = detail === "";
      detailEl.className =
        "app-dialog-detail" +
        ((options && options.detailAsChip) ? " app-dialog-detail-chip" : "");

      okBtn.textContent = (options && options.okLabel) || "OK";
      okBtn.className =
        "app-dialog-btn " +
        ((options && options.danger)
          ? "app-dialog-btn-danger"
          : "app-dialog-btn-primary");

      cancelBtn.textContent = (options && options.cancelLabel) || "キャンセル";
      cancelBtn.hidden = !cancelable;

      function cleanup() {
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKeyDown, true);
      }

      function close(result) {
        if (done) return;
        done = true;
        cleanup();
        overlay.setAttribute("hidden", "");
        if (prevActive && typeof prevActive.focus === "function") {
          window.setTimeout(function () {
            try {
              prevActive.focus();
            } catch (_) {}
          }, 0);
        }
        resolve(result);
      }

      function onOk(ev) {
        if (ev) ev.preventDefault();
        close(true);
      }

      function onCancel(ev) {
        if (ev) ev.preventDefault();
        close(false);
      }

      function onKeyDown(ev) {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        close(cancelable ? false : true);
      }

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKeyDown, true);
      overlay.removeAttribute("hidden");

      window.setTimeout(function () {
        okBtn.focus();
      }, 0);
    });
  }

  function showAppAlert(message, options) {
    var opts = Object.assign({}, options || {}, {
      message: message,
      cancelable: false,
      okLabel: (options && options.okLabel) || "閉じる",
    });
    return showAppDialog(opts).then(function () {});
  }

  function showAppConfirm(message, options) {
    var opts = Object.assign({}, options || {}, {
      message: message,
      cancelable: true,
    });
    return showAppDialog(opts).then(function (ok) {
      return !!ok;
    });
  }

  function setEntryLimitInlineWarning(msg) {
    var el = $("#entry-limit-warning-inline");
    if (!el) return;
    var text = String(msg || "").trim();
    el.textContent = text;
    el.hidden = text === "";
  }

  function updateEntryLimitInlineWarning(entryCount) {
    var limit = Number(state.license && state.license.itemLimit);
    if (!isFinite(limit) || limit <= 0) {
      setEntryLimitInlineWarning("");
      return;
    }
    if (entryCount >= limit) {
      setEntryLimitInlineWarning(
        "登録上限（" + limit + "件）に達しています。プラン変更で件数増加をご検討ください"
      );
      return;
    }
    setEntryLimitInlineWarning("");
  }

  /** 音声登録モード中の #search-meta メッセージをセット（赤太字） */
  function setVoiceRegisterMeta(msg) {
    state.voiceRegisterMetaMsg = msg || "";
  }

  function readDisplayedEntryCount() {
    var ids = ["#plan-summary-line", "#plan-summary-line-sp"];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (!el) continue;
      var text = String(el.textContent || "").trim();
      if (!text) continue;
      return parseCountFromSummaryText(text);
    }
    return null;
  }

  function enterVoiceRegisterResultMode(options) {
    options = options || {};
    if (!state.voiceRegisterMode) {
      state.homeSearchQuery = state.searchQuery;
    }
    state.voiceRegisterMode = true;
    state.voicePreviewEntry = options.previewEntry || null;
    state.draft = options.draft || null;
    state.voiceRegisterMetaMsg = options.metaMsg || "";
    state.voiceSearchMsg = "";
    state.openMemoIds = new Set();
    state.searchQuery = "";
    if ($("#manual-search")) {
      $("#manual-search").value = "";
    }
    return saveSearchQueryToSettings("").then(function () {
      return renderTable();
    });
  }

  function goHomeScreen() {
    closeSettingsIfOpen();
    state.voiceRegisterMode = false;
    state.voicePreviewEntry = null;
    state.draft = null;
    state.voiceRegisterMetaMsg = "";
    state.voiceSearchMsg = "";
    state.openMemoIds = new Set();
    state.searchQuery = String(state.homeSearchQuery || "");
    if ($("#manual-search")) {
      $("#manual-search").value = state.searchQuery;
    }
    return saveSearchQueryToSettings(state.searchQuery).then(function () {
      return renderTable({ refreshSearchResults: true });
    });
  }

  function ensureMobileBackGuard() {
    if (!isPhoneViewport() || state.mobileBackGuardReady) return;
    if (!window.history || !window.history.replaceState || !window.history.pushState) return;
    var baseState = Object.assign({}, window.history.state || {}, { panseeBackGuard: "base" });
    var guardState = Object.assign({}, window.history.state || {}, { panseeBackGuard: "guard" });
    window.history.replaceState(baseState, "", window.location.href);
    window.history.pushState(guardState, "", window.location.href);
    state.mobileBackGuardReady = true;
  }

  function rearmMobileBackGuard() {
    if (!isPhoneViewport()) return;
    if (!window.history || !window.history.pushState) return;
    var guardState = Object.assign({}, window.history.state || {}, { panseeBackGuard: "guard" });
    window.history.pushState(guardState, "", window.location.href);
  }

  function handleMobileBackNavigation() {
    if (!isPhoneViewport()) return;
    if ($("#mobile-edit-sheet-overlay") && !$("#mobile-edit-sheet-overlay").hasAttribute("hidden")) {
      closeMobileEditSheet();
      rearmMobileBackGuard();
      return;
    }
    if ($("#settings-panel") && !$("#settings-panel").hasAttribute("hidden")) {
      goHomeScreen().finally(function () {
        rearmMobileBackGuard();
      });
      return;
    }
    if (state.voiceRegisterMode) {
      goHomeScreen().finally(function () {
        rearmMobileBackGuard();
      });
      return;
    }
    rearmMobileBackGuard();
  }

  function sortEntries(rows) {
    return rows.slice().sort(function (a, b) {
      var ca = normalizeEntrySortTimestamp(a.createdAt);
      var cb = normalizeEntrySortTimestamp(b.createdAt);
      if (ca === cb) return String(b.id).localeCompare(String(a.id));
      return cb.localeCompare(ca);
    });
  }

  function normalizeEntrySortTimestamp(value) {
    var raw = String(value || "");
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw + "T00:00:00.000Z";
    }
    return raw;
  }

  function cloneSearchResult(res) {
    return {
      matches: (res && res.matches ? res.matches.slice() : []).map(function (row) {
        return Object.assign({}, row);
      }),
      total: res && typeof res.total === "number" ? res.total : 0,
      capped: !!(res && res.capped),
      emptyQuery: !!(res && res.emptyQuery),
    };
  }

  function updateSearchSnapshotFromRows(rows) {
    state.searchSnapshot = cloneSearchResult(applySearch(sortEntries(rows), state.searchQuery));
    return state.searchSnapshot;
  }

  function getSearchSnapshotOrCompute(rows) {
    if (!state.searchSnapshot) {
      return updateSearchSnapshotFromRows(rows);
    }
    return state.searchSnapshot;
  }

  function updateEntryInSearchSnapshot(entry) {
    if (!state.searchSnapshot || !entry || !entry.id) return;
    var matches = state.searchSnapshot.matches || [];
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].id === entry.id) {
        matches[i] = Object.assign({}, entry);
        return;
      }
    }
  }

  function removeEntryFromSearchSnapshot(id) {
    if (!state.searchSnapshot || !id) return;
    var matches = state.searchSnapshot.matches || [];
    var next = [];
    var removed = false;
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].id === id) {
        removed = true;
        continue;
      }
      next.push(matches[i]);
    }
    if (!removed) return;
    state.searchSnapshot.matches = next;
    if (typeof state.searchSnapshot.total === "number" && state.searchSnapshot.total > 0) {
      state.searchSnapshot.total -= 1;
    }
  }

  function applySearch(rows, q) {
    var qq = norm(q);
    if (!qq) {
      return { matches: [], total: rows.length, capped: false, emptyQuery: true };
    }
    var all = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var sn = r.searchNormalized || ((r.titleNormalized || "") + (r.memoNormalized || ""));
      if (sn.indexOf(qq) >= 0) all.push(r);
    }
    var total = all.length;
    var capped = total > C.MAX_SEARCH_DISPLAY;
    var matches = capped ? all.slice(0, C.MAX_SEARCH_DISPLAY) : all;
    return { matches: matches, total: total, capped: capped, emptyQuery: false };
  }

  function saveSearchQueryToSettings(q) {
    var nextQ = String(q || "");
    if (!state.idb) return Promise.resolve();
    if (!state.settings) return Promise.resolve();
    if (String(state.settings.lastSearchQuery || "") === nextQ) return Promise.resolve();
    return db.updateSettings(state.idb, { lastSearchQuery: nextQ }).then(function (s) {
      state.settings = s;
    });
  }

  function incrementSettingCounter(fieldName) {
    if (!state.idb || !state.settings) return Promise.resolve();
    var current = Number(state.settings[fieldName] || 0);
    var patch = {};
    patch[fieldName] = current + 1;
    return persistSettingsPatch(patch).catch(function (err) {
      console.warn("Metric update failed:", fieldName, err);
    });
  }

  function incrementSearchCount() {
    return incrementSettingCounter("searchCount");
  }

  function incrementRegisterCount() {
    return incrementSettingCounter("registerCount");
  }

  function startUsageSession() {
    if (state.usageSessionStarted) return Promise.resolve();
    if (!state.idb || !state.settings) return Promise.resolve();
    state.usageSessionStarted = true;
    var patch = {
      appLaunchCount: Number(state.settings.appLaunchCount || 0) + 1,
      appVersion: C.APP_VERSION,
    };
    if (!String(state.settings.appSelfId || "").trim()) {
      patch.appSelfId = makeAppSelfId();
    }
    return persistSettingsPatch(patch).catch(function (err) {
      console.warn("Usage session start failed:", err);
    });
  }

  function formatIsoDisplay(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  }

  function formatTextDisplay(value) {
    var s = String(value || "").trim();
    return s ? s : "—";
  }

  function formatCountDisplay(value) {
    var n = Number(value || 0);
    if (!isFinite(n) || n < 0) n = 0;
    return String(n);
  }

  function formatEntryCreatedAtDisplay(value) {
    if (!value) return "—";
    var raw = String(value);
    var m = raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (m) return m[0];
    return formatIsoDisplay(raw);
  }

  function hasEntryContentChanged(prev, next) {
    if (!prev || !next) return true;
    return (
      String(prev.title || "") !== String(next.title || "") ||
      String(prev.book || "") !== String(next.book || "") ||
      String(prev.page || "") !== String(next.page || "") ||
      String(prev.memo || "") !== String(next.memo || "")
    );
  }

  function isUnauthenticatedTrial() {
    var licDoc = state.license;
    if (!licDoc) return true;
    return !licDoc.licenseKey || String(licDoc.licenseKey).trim() === "";
  }

  function getLicenseApiUrl() {
    return C.getLicenseApiUrl();
  }

  function getUsageApiUrl() {
    return C.getUsageApiUrl ? C.getUsageApiUrl() : "";
  }

  function setLicenseDiagnostics(msg) {
    var el = $("#license-api-diagnostics");
    if (!el) return;
    el.textContent = String(msg || "");
  }

  function formatLicenseApiError(err) {
    if (!err) return "不明なエラー";
    var k = String(err.kind || "");
    if (k === "timeout") {
      return "API接続タイムアウト（" + String(err.timeoutMs || 15000) + "ms）";
    }
    if (k === "network") {
      var m = String(err.message || "");
      if (m.toLowerCase().indexOf("failed to fetch") >= 0) {
        return (
          "ネットワークエラー: Failed to fetch（GAS公開設定/CORSの可能性）。" +
          " Webアプリのアクセス権を「全員」にし、最新デプロイURLを使用してください。"
        );
      }
      return "ネットワークエラー: " + m;
    }
    if (k === "http") {
      var body = err.responseText ? " / 応答: " + String(err.responseText) : "";
      return (
        "HTTPエラー: " +
        String(err.status || "") +
        " " +
        String(err.statusText || "") +
        body
      );
    }
    if (k === "invalid_json") {
      return "API応答JSON不正: " + String(err.responseText || "");
    }
    return "APIエラー: " + String(err.message || "");
  }

  function updateLicenseApiHint() {
    var el = $("#license-api-url-hint");
    if (!el) return;
    if (getLicenseApiUrl()) {
      el.textContent = "";
      return;
    }
    el.textContent =
      "管理サーバーURLが未設定です。js/config.js の LICENSE_API_URL に GAS Web アプリの URL を設定するか、ページ読み込み前に window.__PANSEE_LICENSE_API_URL__ を設定してください。";
  }

  function updateLicenseWarningBanner() {
    var ban = $("#license-warning-banner");
    if (!ban) return;
    var msg = (state.license && state.license.warningMessage) || "";
    msg = String(msg).trim();
    if (!msg) {
      ban.hidden = true;
      ban.textContent = "";
      return;
    }
    ban.hidden = false;
    ban.textContent = msg;
  }

  function updateLicenseDetailsPanel() {
    var licDoc = state.license;
    if (!licDoc) return;
    var inp = $("#license-key-input");
    if (inp) {
      inp.value = licDoc.licenseKey ? String(licDoc.licenseKey) : "";
    }
    var pd = $("#license-plan-detail");
    if (pd) {
      pd.textContent =
        (licDoc.planName || "—") +
        " (" +
        (licDoc.planCode || "—") +
        ") / 上限 " +
        String(licDoc.itemLimit != null ? licDoc.itemLimit : "—") +
        " 件";
    }
    var st = $("#license-status-label");
    if (st) {
      st.textContent = licDoc.licenseStatus
        ? String(licDoc.licenseStatus)
        : "—";
    }
    var ac = $("#license-activated-at");
    if (ac) ac.textContent = formatIsoDisplay(licDoc.activatedAt);
    var lc = $("#license-last-checked");
    if (lc) lc.textContent = formatIsoDisplay(licDoc.lastCheckedAt);
    var nx = $("#license-next-check");
    if (nx) nx.textContent = formatIsoDisplay(licDoc.nextCheckAfter);
  }

  /**
   * プラン名を「○○プラン」表記に揃える（例: ベーシック → ベーシックプラン、試用版はそのまま）
   */
  function formatPlanLabelForSummary(lic) {
    var name = lic && lic.planName ? String(lic.planName).trim() : "試用版";
    if (name.indexOf("プラン") >= 0 || name.indexOf("版") >= 0) {
      return name;
    }
    return name + "プラン";
  }

  /** 狭い画面用: planCode を英字短縮表記に */
  function formatPlanShortEn(lic) {
    var code = lic && lic.planCode ? String(lic.planCode).trim().toLowerCase() : "trial";
    var map = {
      trial: "Trial",
      starter: "Starter",
      basic: "Basic",
      standard: "Standard",
      premium: "Premium",
    };
    if (map[code]) return map[code];
    if (!code) return "Trial";
    return code.charAt(0).toUpperCase() + code.slice(1);
  }

  function isNarrowLayoutViewport() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: 640px)").matches
    );
  }

  /** スマホ幅（479px 以下）: 件数情報の超コンパクト表示判定 */
  function isPhoneViewport() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: 479px)").matches
    );
  }

  function isPhoneSearchSheetMode() {
    return isPhoneViewport();
  }

  function isCompactTableViewport() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: 639px)").matches
    );
  }

  /**
   * スマホでは登録日付列を DOM から外し、table 自体を 3 列構造にする。
   * display:none では Chrome の colspan 再計算に負けるため、列そのものを脱着する。
   * @returns {boolean} 構造が変わった場合 true
   */
  function syncTableStructure() {
    var table = document.querySelector("table.entries-table");
    if (!table) return false;
    var compact = isCompactTableViewport();
    var phoneSheet = isPhoneSearchSheetMode();
    var changed = state.isCompactTable !== compact;
    var colgroup = table.querySelector("colgroup");
    var headRow = table.querySelector("thead tr");
    if (!colgroup || !headRow) {
      state.isCompactTable = compact;
      return changed;
    }

    var colDate = colgroup.querySelector("col.col-date");
    var colActions = colgroup.querySelector("col.col-actions");
    var thDate = headRow.querySelector("th.th-date");
    var thActions = headRow.querySelector("th.th-actions");

    if (compact) {
      if (colDate) {
        state.detachedDateCol = colDate;
        colgroup.removeChild(colDate);
        changed = true;
      }
      if (thDate) {
        state.detachedDateTh = thDate;
        headRow.removeChild(thDate);
        changed = true;
      }
    } else {
      if (!colDate && state.detachedDateCol) {
        colgroup.insertBefore(state.detachedDateCol, colActions || null);
        changed = true;
      }
      if (!thDate && state.detachedDateTh) {
        headRow.insertBefore(state.detachedDateTh, thActions || null);
        changed = true;
      }
    }

    colActions = colgroup.querySelector("col.col-actions");
    thActions = headRow.querySelector("th.th-actions");

    if (phoneSheet) {
      if (colActions) {
        state.detachedActionsCol = colActions;
        colgroup.removeChild(colActions);
        changed = true;
      }
      if (thActions) {
        state.detachedActionsTh = thActions;
        headRow.removeChild(thActions);
        changed = true;
      }
    } else {
      if (!colActions && state.detachedActionsCol) {
        colgroup.appendChild(state.detachedActionsCol);
        changed = true;
      }
      if (!thActions && state.detachedActionsTh) {
        headRow.appendChild(state.detachedActionsTh);
        changed = true;
      }
    }

    state.isCompactTable = compact;
    return changed;
  }

  function parseCountFromSummaryText(text) {
    var t = String(text || "");
    var m1 = t.match(/^(\d+)件登録済/);
    if (m1) return Number(m1[1]);
    var m2 = t.match(/登録\s+(\d+)/);
    if (m2) return Number(m2[1]);
    return 0;
  }

  /**
   * @param {number|undefined} entryCount 省略時は既存表示の件数を維持（上限・プラン名のみ更新）
   */
  function updatePlanSummaryLine(entryCount) {
    var el = $("#plan-summary-line");
    if (!el) return;
    var lic = state.license || {};
    var limit = Number(lic.itemLimit);
    if (!isFinite(limit) || limit < 0) limit = C.DEFAULT_ITEM_LIMIT;
    var n;
    if (entryCount != null && !isNaN(Number(entryCount))) {
      n = Number(entryCount);
    } else {
      n = parseCountFromSummaryText(el.textContent);
    }
    if (isNarrowLayoutViewport()) {
      el.textContent =
        "登録 " + n + "／上限" + limit + "件（" + formatPlanShortEn(lic) + "）";
    } else {
      var label = formatPlanLabelForSummary(lic);
      el.textContent = n + "件登録済／上限" + limit + "件（" + label + "）";
    }
    // SP/タブレット用件数情報要素を同期
    var elSp = $("#plan-summary-line-sp");
    if (elSp) {
      if (isPhoneViewport()) {
        // スマホ: 「上限」省略、日本語ラベルを小フォント、プラン名はみ出し許容
        elSp.innerHTML =
          '<span class="ps-j">登録</span>' + n +
          '<span class="ps-j">／</span>' + limit +
          '<span class="ps-j">件</span>（' + formatPlanShortEn(lic) + '）';
      } else {
        // タブレット: 通常テキスト表示
        elSp.textContent = "登録 " + n + "／上限" + limit + "件（" + formatPlanShortEn(lic) + "）";
      }
    }
  }

  function updatePlanBar() {
    var settings = state.settings || {};
    var lbEl = $("#last-backup-label");
    if (lbEl) lbEl.textContent = formatIsoDisplay(settings.lastBackupAt);
    var lbpEl = $("#last-backup-path-label");
    if (lbpEl) lbpEl.textContent = formatTextDisplay(settings.lastBackupPath);
    var liaEl = $("#last-import-at-label");
    if (liaEl) liaEl.textContent = formatIsoDisplay(settings.lastImportAt);
    var lipEl = $("#last-import-path-label");
    if (lipEl) lipEl.textContent = formatTextDisplay(settings.lastImportPath);
    var ucEl = $("#unsaved-change-count-label");
    if (ucEl) ucEl.textContent = formatCountDisplay(settings.unsavedChangeCount);
    var lrEl = $("#last-backup-recommend-label");
    if (lrEl) lrEl.textContent = formatIsoDisplay(settings.lastBackupRecommendAt);
    var taEl = $("#terms-accepted-at-label");
    if (taEl) taEl.textContent = formatIsoDisplay(settings.termsAcceptedAt);
    var idEl = $("#app-self-id-label");
    if (idEl) idEl.textContent = formatTextDisplay(settings.appSelfId);
    var alEl = $("#app-launch-count-label");
    if (alEl) alEl.textContent = formatCountDisplay(settings.appLaunchCount);
    var scEl = $("#search-count-label");
    if (scEl) scEl.textContent = formatCountDisplay(settings.searchCount);
    var rcEl = $("#register-count-label");
    if (rcEl) rcEl.textContent = formatCountDisplay(settings.registerCount);
    var lusEl = $("#last-usage-sent-at-label");
    if (lusEl) lusEl.textContent = formatIsoDisplay(settings.lastUsageSentAt);
    var vb = $("#app-version-label");
    if (vb) vb.textContent = String(C.APP_VERSION || "—");
    var bb = $("#app-build-label");
    if (bb && C.BUILD_TIMESTAMP) {
      try {
        var d = new Date(C.BUILD_TIMESTAMP);
        var pad = function(n){ return String(n).padStart(2,"0"); };
        var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
        bb.textContent = "(build: " + jst.getUTCFullYear() + "-" + pad(jst.getUTCMonth()+1) + "-" + pad(jst.getUTCDate()) + " " + pad(jst.getUTCHours()) + ":" + pad(jst.getUTCMinutes()) + " JST)";
      } catch(_) { bb.textContent = "(" + C.BUILD_TIMESTAMP + ")"; }
    }
    updatePlanSummaryLine();
    updateLicenseDetailsPanel();
    updateLicenseWarningBanner();
    updateLicenseApiHint();
  }

  function refreshCount() {
    return db.countEntries(state.idb).then(function (n) {
      updatePlanSummaryLine(n);
      updateEntryLimitInlineWarning(n);
      return n;
    });
  }

  function renderSearchMeta(result) {
    var el = $("#search-meta");
    if (!el) return;
    var q = state.searchQuery.trim();
    if (!q) {
      el.classList.add("has-result");
      if (state.voiceSearchMsg) {
        el.textContent = state.voiceSearchMsg;
      } else if (result.total > 0) {
        el.textContent = "検索してください。検索語は短くするのがコツです";
      } else {
        el.textContent = "登録はまだありません。";
      }
      return;
    }
    var parts = [];
    parts.push("「" + q + "」で検索");
    parts.push("— 該当 " + result.total + " 件");
    if (result.capped) {
      parts.push(
        "（検索結果が多いため先頭50件のみ表示。検索語を追加して絞り込んでください）"
      );
    } else if (result.total === 0) {
      parts.push("（ヒットなし）");
    }
    if (isPhoneSearchSheetMode() && result.total > 0) {
      parts.push("（行タップで詳細画面（メモ欄）が開きます）");
    }
    el.textContent = parts.join(" ");
    el.classList.add("has-result");
  }

  function rowHtml(entry, isDraft, options) {
    options = options || {};
    var compactTable = state.isCompactTable || isCompactTableViewport();
    var phoneSheetRow = !!options.phoneSheetRow;
    var showMemoButton = options.showMemoButton !== false;
    var showExitButton = !!options.showExitButton;
    var initialValues = options.initialValues || null;
    var saveDisabled = !!options.saveDisabled;
    var id = entry.id ? String(entry.id) : "";
    var dr = isDraft ? ' data-draft="1"' : "";
    var titleEsc = escapeAttr(entry.title || "");
    var bookEsc = escapeAttr(entry.book || "");
    var pageEsc = escapeAttr(entry.page || "");
    var memoEsc = escapeAttr(entry.memo || "");
    var dateLabel = formatEntryCreatedAtDisplay(entry.createdAt);
    var hasMemo = (entry.memo || "").trim() !== "";
    var memoInitiallyOpen = !!options.memoInitiallyOpen;
    var saveLabel = options.saveLabel || "登録";
    var deleteLabel = options.deleteLabel || "削除";
    var exitLabel = options.exitLabel || "終了";
    var rowClass = phoneSheetRow ? ' class="row-tappable"' : "";
    var memoIndicatorHtml =
      '<span class="memo-indicator' + (hasMemo ? "" : " is-hidden") + '">メモ</span>';

    var titleInner = phoneSheetRow
      ? '<div class="title-display-row">' +
          '<div class="title-display-readonly" title="' + titleEsc + '">' +
            escapeHtml(entry.title || "") +
          "</div>" +
          memoIndicatorHtml +
        "</div>" +
        '<input type="hidden" data-field="title" value="' + titleEsc + '" />'
      : '<div class="title-cell">' +
          '<textarea class="inline desktop-title-textarea" rows="1" maxlength="' +
          C.MAX_TITLE_LENGTH +
          '" data-field="title" title="' + titleEsc + '">' +
          escapeHtml(entry.title || "") +
          "</textarea>" +
          (showMemoButton
            ? '<button type="button" class="sm row-memo btn-memo' +
              (hasMemo ? " has-memo" : "") +
              (memoInitiallyOpen ? " memo-active" : "") +
              '">' + (memoInitiallyOpen ? "▲メモ" : "▼メモ") + "</button>"
            : "") +
          '<input type="hidden" data-field="memo" value="' + memoEsc + '" />' +
        "</div>";

    var bookPageInner = phoneSheetRow
      ? '<div class="booknum-wrap">' +
          '<span class="readonly-box">' + escapeHtml(entry.book || "") + "</span>" +
          '<span class="readonly-box">' + escapeHtml(entry.page || "") + "</span>" +
        "</div>" +
        '<input type="hidden" data-field="book" value="' + bookEsc + '" />' +
        '<input type="hidden" data-field="page" value="' + pageEsc + '" />' +
        '<input type="hidden" data-field="memo" value="' + memoEsc + '" />'
      : '<div class="booknum-wrap">' +
          '<input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="book" value="' + bookEsc + '" />' +
          '<input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="page" value="' + pageEsc + '" />' +
        "</div>";

    var mainTr =
      "<tr" +
      rowClass +
      dr +
      (id ? ' data-id="' + escapeAttr(id) + '"' : "") +
      (initialValues ? ' data-initial-title="' + escapeAttr(initialValues.title || "") + '"' : "") +
      (initialValues ? ' data-initial-book="' + escapeAttr(initialValues.book || "") + '"' : "") +
      (initialValues ? ' data-initial-page="' + escapeAttr(initialValues.page || "") + '"' : "") +
      (initialValues ? ' data-initial-memo="' + escapeAttr(initialValues.memo || "") + '"' : "") +
      ">" +
      '<td class="col-title">' +
      titleInner +
      '</td>' +
      '<td class="col-booknum">' +
      bookPageInner +
      '</td>' +
      (compactTable
        ? ""
        : '<td class="readonly col-date">' +
          escapeHtml(dateLabel) +
          "</td>") +
      (phoneSheetRow
        ? ""
        : '<td class="actions col-actions' + (showExitButton ? " voice-register-actions" : "") + '">' +
          (showExitButton
            ? '<button type="button" class="sm row-exit">' + escapeHtml(exitLabel) + "</button>"
            : "") +
          '<button type="button" class="sm row-save btn-action-green"' + (saveDisabled ? " disabled" : "") + ">" + escapeHtml(saveLabel) + "</button>" +
          (isDraft
            ? '<button type="button" class="sm row-delete btn-action-delete" disabled>' + escapeHtml(deleteLabel) + "</button>"
            : '<button type="button" class="sm row-delete btn-action-delete">' + escapeHtml(deleteLabel) + "</button>") +
          "</td>") +
      "</tr>";

    if (phoneSheetRow) {
      return mainTr;
    }

    var memoTr =
      '<tr class="memo-row"' +
      (id ? ' data-for="' + escapeAttr(id) + '"' : "") +
      (memoInitiallyOpen ? ">" : " hidden>") +
      '<td colspan="' + (compactTable ? "3" : "4") + '" class="memo-cell">' +
      '<textarea class="memo-textarea" rows="2" maxlength="500" placeholder="メモを入力（登録ボタンで確定）...">' +
      escapeHtml(entry.memo || "") +
      "</textarea>" +
      "</td>" +
      "</tr>";

    return mainTr + memoTr;
  }

  function mobileVoiceEditorRowHtml(entry, isDraft, options) {
    options = options || {};
    var id = entry.id ? String(entry.id) : "";
    var dr = isDraft ? ' data-draft="1"' : "";
    var compactTable = state.isCompactTable || isCompactTableViewport();
    var colSpan = isPhoneSearchSheetMode() ? 2 : (compactTable ? 3 : 4);
    var saveLabel = options.saveLabel || "登録";
    var deleteLabel = options.deleteLabel || "削除";
    var exitLabel = options.exitLabel || "終了";

    return (
      '<tr class="mobile-inline-editor-row"' +
      dr +
      (id ? ' data-id="' + escapeAttr(id) + '"' : "") +
      ">" +
      '<td colspan="' + colSpan + '" class="mobile-inline-editor-cell">' +
      '<div class="mobile-inline-editor">' +
      '<h2 class="mobile-edit-sheet-title">音声データ編集</h2>' +
      '<label class="mobile-edit-field">' +
      "<span>サービス名</span>" +
      '<textarea class="mobile-inline-title" rows="2" maxlength="' +
      C.MAX_TITLE_LENGTH +
      '" data-field="title">' +
      escapeHtml(entry.title || "") +
      "</textarea>" +
      "</label>" +
      '<div class="mobile-edit-bookpage-row">' +
      '<label class="mobile-edit-field">' +
      "<span>冊目</span>" +
      '<input type="text" inputmode="numeric" maxlength="3" data-field="book" value="' +
      escapeAttr(entry.book || "") +
      '" />' +
      "</label>" +
      '<label class="mobile-edit-field">' +
      "<span>ページ</span>" +
      '<input type="text" inputmode="numeric" maxlength="3" data-field="page" value="' +
      escapeAttr(entry.page || "") +
      '" />' +
      "</label>" +
      "</div>" +
      '<label class="mobile-edit-field">' +
      "<span>メモ</span>" +
      '<textarea rows="5" maxlength="500" data-field="memo" placeholder="メモを入力（登録ボタンで確定）...">' +
      escapeHtml(entry.memo || "") +
      "</textarea>" +
      "</label>" +
      '<div class="mobile-edit-sheet-actions mobile-inline-editor-actions">' +
      '<button type="button" class="app-dialog-btn app-dialog-btn-secondary row-exit">' +
      escapeHtml(exitLabel) +
      "</button>" +
      '<button type="button" class="app-dialog-btn btn-action-green row-save">' +
      escapeHtml(saveLabel) +
      "</button>" +
      '<button type="button" class="app-dialog-btn app-dialog-btn-danger row-delete"' +
      (isDraft ? " disabled" : "") +
      ">" +
      escapeHtml(deleteLabel) +
      "</button>" +
      "</div>" +
      "</div>" +
      "</td>" +
      "</tr>"
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, "&#96;");
  }

  function readRowFromTr(tr) {
    var inputs = tr.querySelectorAll("input[data-field], textarea[data-field]");
    var o = { title: "", book: "", page: "", memo: "" };
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var f = inp.getAttribute("data-field");
      if (f === "title" || f === "book" || f === "page" || f === "memo") {
        o[f] = inp.value;
      }
    }
    return o;
  }

  function getInitialRowValues(tr) {
    if (!tr) return null;
    return {
      title: tr.getAttribute("data-initial-title") || "",
      book: tr.getAttribute("data-initial-book") || "",
      page: tr.getAttribute("data-initial-page") || "",
      memo: tr.getAttribute("data-initial-memo") || "",
    };
  }

  function isDirtyTrackedDesktopListRow(tr) {
    return !!(
      tr &&
      tr.tagName === "TR" &&
      !isPhoneSearchSheetMode() &&
      tr.hasAttribute("data-id") &&
      tr.hasAttribute("data-initial-title") &&
      !tr.classList.contains("memo-row") &&
      !tr.classList.contains("mobile-inline-editor-row")
    );
  }

  function isRowDirty(tr) {
    if (!isDirtyTrackedDesktopListRow(tr)) return false;
    var current = readRowFromTr(tr);
    var initial = getInitialRowValues(tr);
    return (
      current.title !== initial.title ||
      current.book !== initial.book ||
      current.page !== initial.page ||
      current.memo !== initial.memo
    );
  }

  function updateSaveButtonStateForRow(tr) {
    if (!isDirtyTrackedDesktopListRow(tr)) return;
    var saveBtn = tr.querySelector("button.row-save");
    if (!saveBtn) return;
    saveBtn.disabled = !isRowDirty(tr);
  }

  function syncDesktopListRowAfterSave(tr, entry) {
    if (!isDirtyTrackedDesktopListRow(tr) || !entry) return;
    var vals = readRowFromTr(tr);
    tr.setAttribute("data-initial-title", vals.title || "");
    tr.setAttribute("data-initial-book", vals.book || "");
    tr.setAttribute("data-initial-page", vals.page || "");
    tr.setAttribute("data-initial-memo", vals.memo || "");
    var memoBtn = tr.querySelector("button.row-memo");
    if (memoBtn) {
      memoBtn.classList.toggle("has-memo", String(vals.memo || "").trim() !== "");
    }
    updateSaveButtonStateForRow(tr);
  }

  function removeDesktopListRowFromDom(tr) {
    if (!tr) return;
    var rowId = tr.getAttribute("data-id") || "";
    var memoTr = tr.nextElementSibling;
    if (memoTr && memoTr.classList && memoTr.classList.contains("memo-row")) {
      memoTr.remove();
    }
    tr.remove();
    if (rowId) {
      state.openMemoIds.delete(rowId);
    }
  }

  /** 設定パネル開閉に合わせてヘッダーボタンの文言・スタイルを同期する */
  function updateSettingsToggleUi(isPanelOpen) {
    var toggle = $("#btn-settings-toggle");
    if (!toggle) return;
    if (isPanelOpen) {
      toggle.textContent = "▲ホームへ戻る";
      toggle.classList.add("btn-settings-home");
    } else {
      toggle.textContent = "▶ 設定・ライセンス";
      toggle.classList.remove("btn-settings-home");
    }
  }

  function closeSettingsIfOpen() {
    var panel = $("#settings-panel");
    var mainSection = $("#main-section");
    if (panel && !panel.hasAttribute("hidden")) {
      panel.setAttribute("hidden", "");
      if (mainSection) mainSection.removeAttribute("hidden");
      updateSettingsToggleUi(false);
    }
  }

  function renderTable(options) {
    options = options || {};
    syncTableStructure();
    return db.getAllEntries(state.idb).then(function (rows) {
      closeSettingsIfOpen();
      rows = sortEntries(rows);
      var body = $("#entries-body");
      var tableEl = document.querySelector("table.entries-table");
      var wrapEl = document.querySelector(".table-wrap");
      var phoneSheetMode = isPhoneSearchSheetMode();
      var phoneVoiceRegisterMode = state.voiceRegisterMode && isPhoneViewport();
      var desktopVoiceRegisterMode = state.voiceRegisterMode && !isPhoneViewport();
      body.innerHTML = "";

      if (tableEl) {
        tableEl.classList.toggle("phone-sheet-mode", phoneSheetMode);
        tableEl.classList.toggle("voice-register-mobile-mode", phoneVoiceRegisterMode);
        tableEl.classList.toggle("voice-register-mode", desktopVoiceRegisterMode);
      }
      if (wrapEl) {
        wrapEl.classList.toggle("phone-sheet-mode", phoneSheetMode);
        wrapEl.classList.toggle("voice-register-mobile-mode", phoneVoiceRegisterMode);
        wrapEl.classList.toggle("voice-register-mode", desktopVoiceRegisterMode);
      }

      if (state.voiceRegisterMode) {
        var phoneVoiceEditorMode = isPhoneSearchSheetMode();
        if (state.draft) {
          var dv = state.draft;
          body.insertAdjacentHTML(
            "afterbegin",
            phoneVoiceEditorMode
              ? mobileVoiceEditorRowHtml(
                  {
                    id: dv.id || "",
                    title: dv.title,
                    book: dv.book,
                    page: dv.page,
                    memo: dv.memo || "",
                    createdAt: "（未保存）",
                  },
                  true,
                  { saveLabel: "登録", deleteLabel: "削除", exitLabel: "終了" }
                )
              : rowHtml(
                  {
                    id: dv.id || "",
                    title: dv.title,
                    book: dv.book,
                    page: dv.page,
                    memo: dv.memo || "",
                    createdAt: "（未保存）",
                  },
                  true,
                  {
                    memoInitiallyOpen: true,
                    saveLabel: "登録",
                    deleteLabel: "削除",
                    exitLabel: "終了",
                    initialValues: dv,
                    saveDisabled: true,
                    showMemoButton: false,
                    showExitButton: true,
                  }
                )
          );
        } else if (state.voicePreviewEntry) {
          body.insertAdjacentHTML(
            "afterbegin",
            phoneVoiceEditorMode
              ? mobileVoiceEditorRowHtml(state.voicePreviewEntry, false, {
                  saveLabel: "登録",
                  deleteLabel: "削除",
                  exitLabel: "終了",
                })
              : rowHtml(state.voicePreviewEntry, false, {
                  memoInitiallyOpen: true,
                  saveLabel: "登録",
                  deleteLabel: "削除",
                  exitLabel: "終了",
                  initialValues: state.voicePreviewEntry,
                  saveDisabled: true,
                  showMemoButton: false,
                  showExitButton: true,
                })
          );
        }
        var metaEl = $("#search-meta");
        if (metaEl) {
          var vmsg = state.voiceRegisterMetaMsg || "";
          if (vmsg) {
            metaEl.textContent = vmsg;
            metaEl.classList.add("has-result");
          } else {
            metaEl.textContent = "音声認識しています。";
            metaEl.classList.add("has-result");
          }
        }
        wireTableHandlers();
        bindDesktopTitleTextareas();
        bindExpandedMemoRows();
        restoreOpenMemoRows();
        return refreshCount();
      }

      var res = options.refreshSearchResults
        ? updateSearchSnapshotFromRows(rows)
        : getSearchSnapshotOrCompute(rows);

      for (var i = 0; i < res.matches.length; i++) {
        body.insertAdjacentHTML(
          "beforeend",
          rowHtml(
            res.matches[i],
            false,
            phoneSheetMode
              ? { phoneSheetRow: true }
              : { initialValues: res.matches[i], saveDisabled: true }
          )
        );
      }

      renderSearchMeta(res);
      wireTableHandlers();
      bindDesktopTitleTextareas();
      bindExpandedMemoRows();
      restoreOpenMemoRows();
      return refreshCount();
    });
  }

  /** メモ欄展開状態に応じたボタン表記（閉: ▼メモ / 開: ▲メモ） */
  function setMemoBtnLabel(btn, expanded) {
    if (!btn) return;
    btn.textContent = expanded ? "▲メモ" : "▼メモ";
  }

  function bindMemoTextarea(ta, hiddenMemoInput) {
    if (!ta || !hiddenMemoInput) return;
    ta.value = hiddenMemoInput.value;
    ta.oninput = function () {
      hiddenMemoInput.value = ta.value;
      ta.title = ta.value;
    };
  }

  function fitDesktopTitleTextarea(ta) {
    if (!ta) return;
    ta.style.height = "auto";
    var cs = window.getComputedStyle(ta);
    var lineHeight = parseFloat(cs.lineHeight) || 20;
    var chrome =
      (parseFloat(cs.paddingTop) || 0) +
      (parseFloat(cs.paddingBottom) || 0) +
      (parseFloat(cs.borderTopWidth) || 0) +
      (parseFloat(cs.borderBottomWidth) || 0);
    var maxHeight = lineHeight * 2 + chrome;
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + "px";
    ta.style.overflowY = "hidden";
  }

  function bindDesktopTitleTextareas() {
    var body = $("#entries-body");
    if (!body) return;
    var titleAreas = body.querySelectorAll("textarea.desktop-title-textarea[data-field='title']");
    for (var i = 0; i < titleAreas.length; i++) {
      (function (ta) {
        fitDesktopTitleTextarea(ta);
        ta.oninput = function () {
          ta.title = ta.value;
          fitDesktopTitleTextarea(ta);
        };
      })(titleAreas[i]);
    }
  }

  function bindExpandedMemoRows() {
    var body = $("#entries-body");
    if (!body) return;
    var memoRows = body.querySelectorAll("tr.memo-row:not([hidden])");
    for (var i = 0; i < memoRows.length; i++) {
      var memoTr = memoRows[i];
      var dataTr = memoTr.previousElementSibling;
      if (!dataTr) continue;
      var hiddenMemoInput = dataTr.querySelector("input[data-field='memo']");
      bindMemoTextarea(memoTr.querySelector("textarea.memo-textarea"), hiddenMemoInput);
    }
  }

  function closeMobileEditSheet() {
    var overlay = $("#mobile-edit-sheet-overlay");
    if (overlay) overlay.setAttribute("hidden", "");
    state.mobileEditEntryId = "";
  }

  function openMobileEditSheet(entry) {
    var overlay = $("#mobile-edit-sheet-overlay");
    if (!overlay || !entry) return;
    var title = $("#mobile-edit-title");
    var book = $("#mobile-edit-book");
    var page = $("#mobile-edit-page");
    var memo = $("#mobile-edit-memo");
    if (title) title.value = entry.title || "";
    if (book) book.value = entry.book || "";
    if (page) page.value = entry.page || "";
    if (memo) memo.value = entry.memo || "";
    state.mobileEditEntryId = entry.id || "";
    overlay.removeAttribute("hidden");
  }

  function getMobileEditSheetValues() {
    return {
      title: ($("#mobile-edit-title") && $("#mobile-edit-title").value) || "",
      book: ($("#mobile-edit-book") && $("#mobile-edit-book").value) || "",
      page: ($("#mobile-edit-page") && $("#mobile-edit-page").value) || "",
      memo: ($("#mobile-edit-memo") && $("#mobile-edit-memo").value) || "",
    };
  }

  function openMobileEditSheetForRow(tr) {
    if (!tr) return;
    var id = tr.getAttribute("data-id");
    if (!id) return;
    return db.getAllEntries(state.idb).then(function (rows) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === id) {
          openMobileEditSheet(rows[i]);
          break;
        }
      }
    });
  }

  function saveMobileEditSheet() {
    var id = state.mobileEditEntryId;
    if (!id) return;
    var vals = getMobileEditSheetValues();
    return db.getAllEntries(state.idb).then(function (rows) {
      var prev = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === id) {
          prev = rows[i];
          break;
        }
      }
      if (!prev) return;
      var next = db.patchEntry(prev, vals);
      var changed = hasEntryContentChanged(prev, next);
      return db.putEntry(state.idb, next).then(function () {
        return (changed ? incrementUnsavedChangeCount() : Promise.resolve()).then(function () {
          updateEntryInSearchSnapshot(next);
          closeMobileEditSheet();
          toast("保存しました。重要情報がある場合は、重要情報は手動で削除してください。");
          return renderTable();
        });
      });
    });
  }

  function deleteMobileEditSheet() {
    var id = state.mobileEditEntryId;
    if (!id) return;
    var vals = getMobileEditSheetValues();
    var detail = String(vals.title || "").trim();
    return showAppConfirm("この登録を削除しますか？", {
      detail: detail,
      detailAsChip: true,
      okLabel: "削除する",
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      return db.deleteEntry(state.idb, id).then(function () {
        removeEntryFromSearchSnapshot(id);
        closeMobileEditSheet();
        toast("削除しました。");
        return renderTable();
      });
    });
  }

  function onToggleMemo(tr, btn) {
    var memoTr = tr.nextElementSibling;
    if (!memoTr || !memoTr.classList.contains("memo-row")) return;
    var hiddenMemoInput = tr.querySelector("input[data-field='memo']");
    var entryId = tr.getAttribute("data-id") || "";
    var isHidden = memoTr.hasAttribute("hidden");

    if (isHidden) {
      memoTr.removeAttribute("hidden");
      bindMemoTextarea(memoTr.querySelector("textarea.memo-textarea"), hiddenMemoInput);
      if (btn) {
        btn.classList.add("memo-active");
        setMemoBtnLabel(btn, true);
      }
      if (entryId) state.openMemoIds.add(entryId);
    } else {
      var ta2 = memoTr.querySelector("textarea.memo-textarea");
      if (ta2 && hiddenMemoInput) {
        hiddenMemoInput.value = ta2.value;
      }
      memoTr.setAttribute("hidden", "");
      if (btn) {
        btn.classList.remove("memo-active");
        setMemoBtnLabel(btn, false);
      }
      if (entryId) state.openMemoIds.delete(entryId);
    }
  }

  /** 再描画後に openMemoIds に対応するメモ行を展開し直す */
  function restoreOpenMemoRows() {
    if (!state.openMemoIds || state.openMemoIds.size === 0) return;
    var body = $("#entries-body");
    if (!body) return;
    state.openMemoIds.forEach(function (id) {
      var tr = body.querySelector('tr[data-id="' + id.replace(/"/g, '\\"') + '"]');
      if (!tr) return;
      var memoTr = tr.nextElementSibling;
      if (!memoTr || !memoTr.classList.contains("memo-row")) return;
      var hiddenMemoInput = tr.querySelector("input[data-field='memo']");
      var btn = tr.querySelector("button.row-memo");
      memoTr.removeAttribute("hidden");
      bindMemoTextarea(memoTr.querySelector("textarea.memo-textarea"), hiddenMemoInput);
      if (btn) {
        btn.classList.add("memo-active");
        setMemoBtnLabel(btn, true);
      }
    });
  }

  function wireTableHandlers() {
    var body = $("#entries-body");
    body.onclick = function (ev) {
      var t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      var tr = t.closest("tr");
      if (!tr || !body.contains(tr)) return;
      if (tr.classList.contains("memo-row")) return;

      if (t.classList.contains("row-save")) {
        onSaveRow(tr);
      } else if (t.classList.contains("row-exit")) {
        goHomeScreen();
      } else if (t.classList.contains("row-delete")) {
        onDeleteRow(tr);
      } else if (t.classList.contains("row-memo")) {
        onToggleMemo(tr, t);
      } else if (
        isPhoneSearchSheetMode() &&
        !tr.getAttribute("data-draft") &&
        !tr.classList.contains("mobile-inline-editor-row")
      ) {
        openMobileEditSheetForRow(tr);
      }
    };

    body.oninput = function (ev) {
      var t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      var eventTr = t.closest("tr");
      if (!eventTr || !body.contains(eventTr)) return;
      if (eventTr.classList.contains("memo-row")) {
        updateSaveButtonStateForRow(eventTr.previousElementSibling);
        return;
      }
      updateSaveButtonStateForRow(eventTr);
    };

  }

  function onSaveRow(tr) {
    var draft = tr.getAttribute("data-draft") === "1";
    if (!isRowDirty(tr) && isDirtyTrackedDesktopListRow(tr)) {
      return Promise.resolve();
    }
    var vals = readRowFromTr(tr);
    if (draft) {
      return refreshCount().then(function (n) {
        if (n >= Number(state.license.itemLimit)) {
          return showAppAlert(
            "登録上限（" + state.license.itemLimit + "件）に達しています。保存できません。"
          ).then(function () {
            setEntryLimitInlineWarning(
              "登録上限（" + state.license.itemLimit + "件）に達しているため保存できません。"
            );
          });
        }
        var entry = db.buildNewEntry(vals.title, vals.book, vals.page, vals.memo);
        return db.putEntry(state.idb, entry).then(function () {
          return incrementUnsavedChangeCount().then(function () {
            return incrementRegisterCount();
          }).then(function () {
            state.draft = null;
            if (state.voiceRegisterMode) {
              state.voicePreviewEntry = entry;
            }
            toast("保存しました。重要情報がある場合は、重要情報は手動で削除してください。");
            return renderTable();
          });
        });
      });
    }

    var id = tr.getAttribute("data-id");
    if (!id) return;
    return db.getAllEntries(state.idb).then(function (rows) {
      var prev = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === id) {
          prev = rows[i];
          break;
        }
      }
      if (!prev) return;
      var next = db.patchEntry(prev, vals);
      var changed = hasEntryContentChanged(prev, next);
      return db.putEntry(state.idb, next).then(function () {
        return (changed ? incrementUnsavedChangeCount() : Promise.resolve()).then(function () {
          // 5.2: voiceRegisterMode中に保存した場合、voicePreviewEntryを最新データで更新
          // しないと renderTable が古い entry（memo空）で再描画してしまう
          if (state.voiceRegisterMode && state.voicePreviewEntry && state.voicePreviewEntry.id === id) {
            state.voicePreviewEntry = next;
          }
          updateEntryInSearchSnapshot(next);
          toast("保存しました。重要情報がある場合は、重要情報は手動で削除してください。");
          if (isDirtyTrackedDesktopListRow(tr)) {
            syncDesktopListRowAfterSave(tr, next);
            return;
          }
          return renderTable();
        });
      });
    });
  }

  function onDeleteRow(tr) {
    var draft = tr.getAttribute("data-draft") === "1";
    var title = String((readRowFromTr(tr).title || "")).trim();
    var detail = title || "";
    if (draft) {
      return showAppConfirm("この行を破棄しますか？", {
        detail: detail,
        detailAsChip: true,
        okLabel: "破棄する",
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        state.draft = null;
        return renderTable();
      });
    }
    var id = tr.getAttribute("data-id");
    if (!id) return;
    return showAppConfirm("この登録を削除しますか？", {
      detail: detail,
      detailAsChip: true,
      okLabel: "削除する",
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      return db.deleteEntry(state.idb, id).then(function () {
        removeEntryFromSearchSnapshot(id);
        toast("削除しました。");
        if (isDirtyTrackedDesktopListRow(tr)) {
          removeDesktopListRowFromDom(tr);
          renderSearchMeta(state.searchSnapshot || { total: 0, capped: false });
          return refreshCount();
        }
        return renderTable();
      });
    });
  }

  function runSearch() {
    state.voiceRegisterMode = false;
    state.voicePreviewEntry = null;
    state.draft = null;
    state.voiceRegisterMetaMsg = "";
    state.voiceSearchMsg = "";
    state.openMemoIds = new Set();
    state.searchQuery = $("#manual-search").value || "";
    state.homeSearchQuery = state.searchQuery;
    var countPromise = String(state.searchQuery || "").trim()
      ? incrementSearchCount()
      : Promise.resolve();
    return countPromise.then(function () {
      return saveSearchQueryToSettings(state.searchQuery);
    }).then(function () {
      return renderTable({ refreshSearchResults: true });
    });
  }

  function onVoiceSearch() {
    var trace = createVoiceTimingTrace("search");
    trace.mark("onVoiceSearch_enter");
    closeSettingsIfOpen();
    trace.mark("closeSettingsIfOpen_done");
    if (!voice.isSpeechSupported()) {
      trace.mark("speech_support_checked", { code: "unsupported" });
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      state.draft = null;
      state.voiceRegisterMetaMsg = "";
      state.voiceSearchMsg = "このブラウザでは音声認識を利用できません。手動検索をご利用ください。";
      state.searchQuery = "";
      state.openMemoIds = new Set();
      if ($("#manual-search")) $("#manual-search").value = "";
      return saveSearchQueryToSettings("").then(function () {
        return renderTable({ refreshSearchResults: true });
      });
    }
    trace.mark("speech_support_checked", { code: "supported" });
    trace.mark("recognizeOnce_call");
    return voice.recognizeOnce({ trace: trace }).then(function (text) {
      trace.mark("onVoiceSearch_recognize_resolved", {
        empty: !String(text || "").trim(),
      });
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      state.draft = null;
      state.voiceRegisterMetaMsg = "";
      state.voiceSearchMsg = "";
      state.openMemoIds = new Set();
        if (!text.trim()) {
          pushVoiceRecentLog("", null, "無音/タイムアウト", appendVoiceTimingNote("音声認識がタイムアウト（10秒）しました。", trace), {
            kind: "search",
            kindLabel: "音声検索",
            processedLabel: "正規化後",
            processedSummary: "（空欄）",
          });
        state.voiceSearchMsg = "音声認識がタイムアウト（10秒）しました。手動検索も利用可能です。";
        } else {
          pushVoiceRecentLog(text, null, "成功", appendVoiceTimingNote("音声検索語を検索欄へ反映しました。", trace), {
            kind: "search",
            kindLabel: "音声検索",
            processedLabel: "正規化後",
            processedSummary: norm(text) || "（空欄）",
          });
      }
      $("#manual-search").value = text;
      state.searchQuery = text;
      state.homeSearchQuery = state.searchQuery;
      var countPromise = String(state.searchQuery || "").trim()
        ? incrementSearchCount()
        : Promise.resolve();
      return countPromise.then(function () {
        return saveSearchQueryToSettings(state.searchQuery);
      }).then(function () {
        return renderTable({ refreshSearchResults: true }).then(function () {
          if (!text.trim()) {
            toast("音声認識がタイムアウトしました。");
          }
        });
      });
    }).catch(function (err) {
      trace.mark("onVoiceSearch_recognize_rejected", {
        code: err && err.code ? String(err.code) : "error",
      });
      if (err && (err.code === "replaced" || err.code === "aborted")) {
        return;
      }
      throw err;
    });
  }

  function onVoiceRegister() {
    var trace = createVoiceTimingTrace("register");
    trace.mark("onVoiceRegister_enter");
    if (!voice.isSpeechSupported()) {
      trace.mark("speech_support_checked", { code: "unsupported" });
      return enterVoiceRegisterResultMode({
        draft: { title: "", book: "", page: "", memo: "" },
        metaMsg: "このブラウザでは音声認識を利用できません。手動での登録をご利用ください。",
      }).then(function () {
        return refreshCount().then(function () {
          trace.mark("unsupported_register_rendered");
        });
      });
    }
    trace.mark("speech_support_checked", { code: "supported" });
    var displayedCount = readDisplayedEntryCount();
    trace.mark("displayed_count_checked", { count: displayedCount });
    if (
      displayedCount != null &&
      displayedCount >= Number(state.license.itemLimit)
    ) {
      trace.mark("register_limit_reached");
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      state.draft = null;
      state.voiceRegisterMetaMsg = "";
      state.searchQuery = "";
      if ($("#manual-search")) $("#manual-search").value = "";
      setEntryLimitInlineWarning(
        "登録上限（" + state.license.itemLimit + "件）です。プラン変更で件数増加をご検討ください"
      );
      return saveSearchQueryToSettings("").then(function () {
        return renderTable();
      });
    }

    if (voice && typeof voice.playStartBeep === "function") {
      trace.mark("register_start_beep_played");
      voice.playStartBeep();
    }
    trace.mark("recognizeOnce_call");
    return voice.recognizeOnce({ trace: trace }).then(function (text) {
      trace.mark("onVoiceRegister_recognize_resolved", {
        empty: !String(text || "").trim(),
      });

      if (!text.trim()) {
        pushVoiceRecentLog("", null, "無音/タイムアウト", appendVoiceTimingNote("音声認識がタイムアウト（10秒）しました。", trace));
        return enterVoiceRegisterResultMode({
          draft: { title: "", book: "", page: "", memo: "" },
          metaMsg: "音声認識がタイムアウト（10秒）しました。手動で登録ができます。",
        });
      }

      var parsed = voice.parseRegisterTranscript(text);
      var registeredTitle = (parsed.title || "").trim();
      var registeredBook = parsed.ok ? parsed.book : "";
      var registeredPage = parsed.ok ? parsed.page : "";
      var registeredTitleLabel = registeredTitle || "（空欄）";
      var registerNote = parsed.ok
        ? "冊目・ページ付きで解析しました。"
        : "冊目・ページは解析できなかったため、サービス名のみ登録しました。";
      var registerMetaMsg =
        "「" + registeredTitleLabel + "」が登録されました。";

      pushVoiceRecentLog(text, parsed, "成功", appendVoiceTimingNote(registerNote, trace));
      var entry = db.buildNewEntry(registeredTitle, registeredBook, registeredPage, "");
      return db.putEntry(state.idb, entry).then(function () {
        return incrementUnsavedChangeCount().then(function () {
          return incrementRegisterCount();
        }).then(function () {
          toast("保存しました。重要情報がある場合は、重要情報は手動で削除してください。");
          return enterVoiceRegisterResultMode({
            previewEntry: entry,
            metaMsg: registerMetaMsg,
          });
        });
      });
    }).catch(function (err) {
      trace.mark("onVoiceRegister_recognize_rejected", {
        code: err && err.code ? String(err.code) : "error",
      });
      if (err && (err.code === "replaced" || err.code === "aborted")) {
        return;
      }
      return enterVoiceRegisterResultMode({
        draft: { title: "", book: "", page: "", memo: "" },
        metaMsg: "音声認識がタイムアウト（10秒）しました。手動で登録ができます。",
      });
    });
  }

  function shouldRunPeriodicCheck(licDoc) {
    if (!licDoc || !licDoc.nextCheckAfter) return true;
    var t = new Date(licDoc.nextCheckAfter).getTime();
    if (isNaN(t)) return true;
    return Date.now() >= t;
  }

  function shouldPromptBackupRecommendation(settings) {
    if (!settings) return false;
    var count = Number(settings.unsavedChangeCount || 0);
    if (!(count >= 1)) return false;
    var lastShownAt = String(settings.lastBackupRecommendAt || "").trim();
    if (!lastShownAt) return true;
    var shownMs = new Date(lastShownAt).getTime();
    if (isNaN(shownMs)) return true;
    var intervalDays = count >= 50 ? 1 : 7;
    return Date.now() >= shownMs + intervalDays * 24 * 60 * 60 * 1000;
  }

  function shouldSendUsagePing(settings) {
    if (!settings) return false;
    var lastSentAt = String(settings.lastUsageSentAt || "").trim();
    if (!lastSentAt) return true;
    var sentMs = new Date(lastSentAt).getTime();
    if (isNaN(sentMs)) return true;
    return Date.now() >= sentMs + 7 * 24 * 60 * 60 * 1000;
  }

  function buildUsagePayload(trigger) {
    var licDoc = state.license || {};
    var settings = state.settings || {};
    return {
      action: "usage_ping",
      trigger: String(trigger || "unknown"),
      sentAt: new Date().toISOString(),
      licenseKey: String(licDoc.licenseKey || ""),
      planCode: String(licDoc.planCode || C.DEFAULT_PLAN_CODE || "trial"),
      termsAcceptedAt: String(settings.termsAcceptedAt || ""),
      termsVersion: String(settings.termsVersion || ""),
      appSelfId: String(settings.appSelfId || ""),
      appLaunchCount: Number(settings.appLaunchCount || 0),
      searchCount: Number(settings.searchCount || 0),
      registerCount: Number(settings.registerCount || 0),
      clientVersion: String(C.APP_VERSION || ""),
      deviceHint: String(navigator.userAgent || ""),
    };
  }

  function maybeSendUsagePing(trigger) {
    var url = getUsageApiUrl();
    if (!url || !usage || typeof usage.postUsagePing !== "function") {
      return Promise.resolve();
    }
    if (!navigator.onLine) return Promise.resolve();
    if (!state.idb || !state.settings) return Promise.resolve();
    if (!String(state.settings.termsAcceptedAt || "").trim()) return Promise.resolve();
    if (!String(state.settings.appSelfId || "").trim()) return Promise.resolve();
    if (!shouldSendUsagePing(state.settings)) return Promise.resolve();
    if (state.usageSendBusy || state.usageSentThisSession) return Promise.resolve();
    state.usageSendBusy = true;
    return usage
      .postUsagePing(url, buildUsagePayload(trigger))
      .then(function (result) {
        if (!result || result.ok !== true) return;
        state.usageSentThisSession = true;
        return persistSettingsPatch({
          lastUsageSentAt: result.loggedAt || new Date().toISOString(),
        });
      })
      .catch(function (err) {
        console.warn("Usage ping failed:", err);
      })
      .finally(function () {
        state.usageSendBusy = false;
      });
  }

  function maybeCheckLicenseOnline() {
    var url = getLicenseApiUrl();
    if (!url) return Promise.resolve();
    if (!navigator.onLine) return Promise.resolve();
    return db.getLicense(state.idb).then(function (licDoc) {
      if (!licDoc.licenseKey || String(licDoc.licenseKey).trim() === "") {
        return Promise.resolve();
      }
      if (!shouldRunPeriodicCheck(licDoc)) return Promise.resolve();
      var key = String(licDoc.licenseKey).trim();
      return lic
        .postLicenseAction(url, {
          action: "check",
          licenseKey: key,
          clientVersion: C.APP_VERSION,
          deviceHint: navigator.userAgent || "",
        })
        .then(function (result) {
          if (!result || !result.ok) {
            return;
          }
          licDoc.lastCheckedAt = result.checkedAt || licDoc.lastCheckedAt;
          if (result.nextCheckAfter != null) {
            licDoc.nextCheckAfter = result.nextCheckAfter;
          }
          if (result.licenseStatus != null) {
            licDoc.licenseStatus = result.licenseStatus;
          }
          licDoc.warningMessage =
            result.warningMessage != null ? result.warningMessage : "";
          state.license = licDoc;
          return db.putLicense(state.idb, licDoc).then(function () {
            updatePlanBar();
          });
        })
        .catch(function () {
          /* 通信失敗時はローカル継続 */
        });
    });
  }

  function maybePromptBackupRecommendation() {
    if (state.backupRecommendBusy) return Promise.resolve();
    if (!state.idb || !state.settings) return Promise.resolve();
    if (state.exportBusy || state.importBusy) return Promise.resolve();
    if (!shouldPromptBackupRecommendation(state.settings)) return Promise.resolve();
    state.backupRecommendBusy = true;
    var unsavedCount = Number(state.settings.unsavedChangeCount || 0);
    return persistSettingsPatch({
      lastBackupRecommendAt: new Date().toISOString(),
    })
      .then(function () {
        return showAppConfirm(
          "データファイルに保存されていない変更が" + unsavedCount + "件有ります。最新のデータをデータファイルへ保存しますか？",
          {
            okLabel: "保存する",
            cancelLabel: "あとで",
          }
        );
      })
      .then(function (ok) {
        if (!ok) return;
        return onExport();
      })
      .finally(function () {
        state.backupRecommendBusy = false;
      });
  }

  function runPeriodicMaintenance() {
    return maybeCheckLicenseOnline()
      .catch(function () {})
      .then(function () {
        return maybePromptBackupRecommendation().catch(function () {});
      });
  }

  function runBackgroundMaintenance(trigger) {
    return maybeSendUsagePing(trigger)
      .catch(function () {})
      .then(function () {
        return runPeriodicMaintenance().catch(function () {});
      });
  }

  function onActivateLicense() {
    var raw = ($("#license-key-input") && $("#license-key-input").value) || "";
    var key = lic.normalizeLicenseKeyInput(raw);
    if (!key) {
      return showAppAlert("ライセンスキーを入力してください。");
    }
    setLicenseDiagnostics("");
    if (!lic.isValidLicenseKeyFormat(key)) {
      return showAppAlert(
        "ライセンスキー形式が不正です（PN1-XXXX-XXXX-XXXX・英数字大文字）。"
      );
    }
    if (!navigator.onLine) {
      return showAppAlert("初回認証はオンライン環境で行ってください。");
    }
    var url = getLicenseApiUrl();
    if (!url) {
      return showAppAlert(
        "管理サーバーURLが未設定です。js/config.js の LICENSE_API_URL を設定してください。"
      );
    }
    var btn = $("#btn-license-activate");
    var status = $("#license-activate-status");
    function setActivateBusyUi(isBusy) {
      if (btn) btn.disabled = !!isBusy;
      if (status) {
        if (isBusy) {
          status.removeAttribute("hidden");
        } else {
          status.setAttribute("hidden", "");
        }
      }
    }
    if (voice && typeof voice.playEndBeep === "function") {
      voice.playEndBeep();
    }
    setActivateBusyUi(true);
    return lic
      .postLicenseAction(url, {
        action: "activate",
        licenseKey: key,
        clientVersion: C.APP_VERSION,
        deviceHint: navigator.userAgent || "",
      })
      .then(function (result) {
        if (!result || !result.ok) {
          var msg = lic.messageForErrorCode(
            result && result.errorCode,
            result && result.message
          );
          return showAppAlert(msg);
        }
        var checkedAt = result.checkedAt || new Date().toISOString();
        var doc = {
          id: C.LICENSE_DOC_ID,
          licenseKey: key,
          planCode: result.planCode,
          planName: result.planName,
          itemLimit:
            result.itemLimit != null
              ? Number(result.itemLimit)
              : C.DEFAULT_ITEM_LIMIT,
          licenseStatus: result.licenseStatus,
          warningMessage:
            result.warningMessage != null ? result.warningMessage : "",
          activatedAt: checkedAt,
          lastCheckedAt: checkedAt,
          nextCheckAfter:
            result.nextCheckAfter != null ? result.nextCheckAfter : "",
        };
        state.license = doc;
        return db.putLicense(state.idb, doc).then(function () {
          if ($("#license-key-input")) $("#license-key-input").value = key;
          updatePlanBar();
          setLicenseDiagnostics("");
          toast("ライセンス認証に成功しました。");
        });
      })
      .catch(function (err) {
        var detail = formatLicenseApiError(err);
        setLicenseDiagnostics(detail);
        console.error("License activate failed:", err);
        return showAppAlert(
          "サーバー接続に失敗しました。設定・ライセンス欄の診断メッセージを確認してください。"
        );
      })
      .finally(function () {
        setActivateBusyUi(false);
        if (voice && typeof voice.playEndBeep === "function") {
          voice.playEndBeep();
        }
      });
  }

  function onExport() {
    if (state.exportBusy || state.importBusy) return Promise.resolve();
    setDataTransferBusyUi("export", true);
    var saveHandlePromise = null;
    if (typeof window.showSaveFilePicker === "function") {
      saveHandlePromise = requestSaveFileHandle(buildBackupFileName());
    }
    return Promise.resolve(saveHandlePromise)
      .then(function (saveHandle) {
        return buildBackupFilePayload().then(function (pkg) {
          if (saveHandle) {
            return writeBackupToHandle(saveHandle, pkg.blob).then(function () {
              return {
                mode: "saved",
                fileLabel: normalizeFileLabel(saveHandle.name || pkg.name, "ブラウザ管理"),
              };
            });
          }
          return exportBackupFile(pkg.blob, pkg.name);
        });
      })
      .then(function (result) {
        if (!result) return;
        return persistBackupExportInfo(result.fileLabel).then(function () {
          if (result.mode === "saved") {
            toast("バックアップファイルを保存しました。");
            return;
          }
          if (result.mode === "shared") {
            toast("バックアップファイルを共有しました。");
            return;
          }
          return showAppAlert(
            "バックアップファイルのダウンロードを開始しました。保存先は端末・ブラウザ側で確認してください。"
          );
        });
      })
      .catch(function (err) {
        if (isAbortError(err)) return;
        console.error("Backup export failed:", err);
        return showAppAlert("バックアップファイルの保存に失敗しました。");
      })
      .finally(function () {
        setDataTransferBusyUi("export", false);
      });
  }

  function onImportFile(file) {
    if (!file) return Promise.resolve();
    if (state.importBusy || state.exportBusy) return Promise.resolve();
    setDataTransferBusyUi("import", true);
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result);
      };
      fr.onerror = function () {
        reject(fr.error);
      };
      fr.readAsText(file, "utf-8");
    })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          return showAppAlert("バックアップファイルの形式が正しくありません。");
        }
        if (!data || data.app !== C.APP_ID || !Array.isArray(data.items)) {
          return showAppAlert("バックアップファイルの形式が正しくありません。");
        }
        return db.getLicense(state.idb).then(function (lic) {
          var items = data.items;
          var effectiveLicense = state.license || lic || {};
          var limit = Number(effectiveLicense.itemLimit);
          if (isNaN(limit) || limit < 0) limit = C.DEFAULT_ITEM_LIMIT;
          var truncated = items.length > limit;
          var slice = items.slice(0, limit);

          return db.clearEntries(state.idb).then(function () {
            var chain = Promise.resolve();
            for (var i = 0; i < slice.length; i++) {
              (function (item) {
                chain = chain.then(function () {
                  var e = db.buildNewEntry(item.title, item.book, item.page, item.memo || "");
                  if (item.createdAt) e.createdAt = String(item.createdAt);
                  if (item.updatedAt) e.updatedAt = String(item.updatedAt);
                  return db.putEntry(state.idb, e);
                });
              })(slice[i]);
            }
            return chain.then(function () {
              state.draft = null;
              state.searchQuery = $("#manual-search").value || "";
              return persistBackupImportInfo(file && file.name).then(function () {
                return saveSearchQueryToSettings(state.searchQuery);
              }).then(function () {
                return renderTable({ refreshSearchResults: true }).then(function () {
                  if (truncated) {
                    return showAppAlert(
                      "このプランの登録上限を超えるため、先頭から取り込める分のみ登録しました。超過分は登録されていません。"
                    );
                  } else {
                    return showAppAlert(
                      "バックアップファイルを読み込みました。既存データは置き換えられました。"
                    );
                  }
                });
              });
            });
          });
        });
      })
      .catch(function () {
        return showAppAlert("バックアップファイルの読み込みに失敗しました。");
      })
      .finally(function () {
        setDataTransferBusyUi("import", false);
      });
  }

  function onImportRequest() {
    if (state.importBusy || state.exportBusy) return Promise.resolve();
    return showAppConfirm("バックアップファイルを読み出しますか？", {
      detail:
        "このあとファイル選択画面が開きます。キャンセルする場合は、この画面でキャンセルしてください。",
      okLabel: "ファイルを選ぶ",
      cancelLabel: "キャンセル",
    }).then(function (ok) {
      if (!ok) return;
      return requestImportFile()
        .then(function (file) {
          if (!file) return;
          return onImportFile(file);
        })
        .finally(function () {
          var input = $("#import-file");
          if (input) input.value = "";
        });
    });
  }

  function init() {
    window.addEventListener("popstate", function () {
      handleMobileBackNavigation();
    });
    ensureMobileBackGuard();
    $("#btn-export").addEventListener("click", function () {
      onExport();
    });
    $("#btn-import-trigger").addEventListener("click", function () {
      onImportRequest();
    });
    $("#btn-search").addEventListener("click", function () {
      runSearch();
    });
    $("#manual-search").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        runSearch();
      }
    });
    $("#btn-voice-search").addEventListener("click", function () {
      onVoiceSearch();
    });
    $("#btn-voice-register").addEventListener("click", function () {
      onVoiceRegister();
    });
    $("#btn-license-activate").addEventListener("click", function () {
      onActivateLicense();
    });
    var mobileEditOverlay = $("#mobile-edit-sheet-overlay");
    if (mobileEditOverlay) {
      mobileEditOverlay.addEventListener("click", function (ev) {
        if (ev.target === mobileEditOverlay) {
          closeMobileEditSheet();
        }
      });
    }
    if ($("#mobile-edit-cancel")) {
      $("#mobile-edit-cancel").addEventListener("click", function () {
        closeMobileEditSheet();
      });
    }
    if ($("#mobile-edit-save")) {
      $("#mobile-edit-save").addEventListener("click", function () {
        saveMobileEditSheet();
      });
    }
    if ($("#mobile-edit-delete")) {
      $("#mobile-edit-delete").addEventListener("click", function () {
        deleteMobileEditSheet();
      });
    }
    var settingsToggle = $("#btn-settings-toggle");
    if (settingsToggle) {
      settingsToggle.addEventListener("click", function () {
        var panel = $("#settings-panel");
        var mainSection = $("#main-section");
        if (!panel) return;
        var isOpen = !panel.hasAttribute("hidden");
        if (isOpen) {
          goHomeScreen();
        } else {
          panel.removeAttribute("hidden");
          if (mainSection) mainSection.setAttribute("hidden", "");
          updateSettingsToggleUi(true);
          panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }
    window.addEventListener("online", function () {
      runBackgroundMaintenance("online");
    });

    var layoutResizeTimer = null;
    function onViewportLayoutChange() {
      updatePlanSummaryLine();
      if (!isPhoneViewport()) {
        closeMobileEditSheet();
      } else {
        ensureMobileBackGuard();
      }
      if (syncTableStructure() && state.idb) {
        renderTable().catch(function () {});
      }
    }
    window.addEventListener("resize", function () {
      window.clearTimeout(layoutResizeTimer);
      layoutResizeTimer = window.setTimeout(onViewportLayoutChange, 120);
    });
    if (typeof window !== "undefined" && window.matchMedia) {
      var narrowMq = window.matchMedia("(max-width: 640px)");
      if (narrowMq.addEventListener) {
        narrowMq.addEventListener("change", onViewportLayoutChange);
      } else if (narrowMq.addListener) {
        narrowMq.addListener(onViewportLayoutChange);
      }
      // スマホ幅変化でコンパクト表示切替
      var phoneMq = window.matchMedia("(max-width: 479px)");
      if (phoneMq.addEventListener) {
        phoneMq.addEventListener("change", onViewportLayoutChange);
      } else if (phoneMq.addListener) {
        phoneMq.addListener(onViewportLayoutChange);
      }
    }

    return db
      .openDb()
      .then(function (idb) {
        state.idb = idb;
        return db.ensureSeedDocs(idb);
      })
      .then(function () {
        return db.syncTrialItemLimitWithConfig(state.idb);
      })
      .then(function () {
        return Promise.all([
          db.getLicense(state.idb),
          db.getSettings(state.idb),
        ]);
      })
      .then(function (pair) {
        state.license = pair[0];
        state.settings = pair[1];
        // 開発者用: localStorage に pansee_dev_limit が設定されている場合は上限を上書き
        (function () {
          try {
            var devVal = localStorage.getItem("pansee_dev_limit");
            if (devVal !== null) {
              var n = Number(devVal);
              if (isFinite(n) && n > 0) {
                state.license = Object.assign({}, state.license, { itemLimit: n });
                console.info("[DEV] itemLimit overridden to", n, "(localStorage: pansee_dev_limit)");
              }
            }
          } catch (_) {}
        })();
        state.searchQuery = String((state.settings && state.settings.lastSearchQuery) || "");
        state.homeSearchQuery = state.searchQuery;
        if ($("#manual-search")) {
          $("#manual-search").value = state.searchQuery;
        }
        ensureMobileBackGuard();
        updatePlanBar();
        syncTableStructure();
        return checkTerms().then(function () {
          return startUsageSession();
        }).then(function () {
          return renderTable({ refreshSearchResults: true });
        });
      })
      .then(function () {
        return runBackgroundMaintenance("startup").catch(function () {});
      })
      .then(function () {
        initVoiceRecentLogs();
      })
      .catch(function (e) {
        console.error(e);
        return showAppAlert(
          "データベースを初期化できませんでした。プライベートブラウズやストレージ制限を確認してください。"
        );
      });
  }

  /* ================================================================
     直近音声認識ログ（確認用）
     音声検索・音声登録の生認識結果を直近10件だけ保持する。
     ================================================================ */

  var VOICE_RECENT_LOGS_KEY = "pansee_recent_voice_logs";
  var VOICE_RECENT_LOGS_LIMIT = 10;

  function loadVoiceRecentLogs() {
    try {
      var raw = localStorage.getItem(VOICE_RECENT_LOGS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, VOICE_RECENT_LOGS_LIMIT) : [];
    } catch (e) {
      return [];
    }
  }

  function saveVoiceRecentLogs(logs) {
    try {
      localStorage.setItem(
        VOICE_RECENT_LOGS_KEY,
        JSON.stringify((logs || []).slice(0, VOICE_RECENT_LOGS_LIMIT))
      );
    } catch (e) {}
  }

  function summarizeVoiceParsed(parsed) {
    if (!parsed) return "解析前";
    if (!parsed.ok) return "サービス名のみ / タイトル: " + (parsed.title || "（空欄）");
    return (
      "冊目: " + (parsed.book || "（空欄）") +
      " / ページ: " + (parsed.page || "（空欄）") +
      " / タイトル: " + (parsed.title || "（空欄）")
    );
  }

  function pushVoiceRecentLog(rawText, parsed, status, note, options) {
    var opts = options || {};
    var logs = loadVoiceRecentLogs();
    logs.unshift({
      at: new Date().toISOString(),
      kind: String(opts.kind || "register"),
      kindLabel: String(opts.kindLabel || "音声登録"),
      rawText: String(rawText || ""),
      processedLabel: String(opts.processedLabel || "解析結果"),
      parsedSummary: summarizeVoiceParsed(parsed),
      processedSummary:
        opts.processedSummary !== undefined && opts.processedSummary !== null
          ? String(opts.processedSummary)
          : summarizeVoiceParsed(parsed),
      status: String(status || ""),
      note: String(note || ""),
    });
    saveVoiceRecentLogs(logs);
    renderVoiceRecentLogs();
  }

  function renderVoiceRecentLogs() {
    var listEl = $("#voice-log-list");
    if (!listEl) return;
    var logs = loadVoiceRecentLogs();
    if (!logs.length) {
      listEl.innerHTML = '<p class="voice-log-empty">まだ音声認識ログはありません。</p>';
      return;
    }
    listEl.innerHTML = logs.map(function (log) {
      var statusClass = log.status === "成功" ? "ok" : "ng";
      var timeText = "不明";
      try {
        timeText = new Date(log.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      } catch (e) {}
      return (
        '<section class="voice-log-item">' +
          '<div class="voice-log-meta">' +
            '<span>' + escapeHtml(timeText) + '</span>' +
            '<span>' + escapeHtml(log.kindLabel || (log.kind === "search" ? "音声検索" : "音声登録")) + "</span>" +
            '<span class="voice-log-status ' + statusClass + '">' + escapeHtml(log.status || "不明") + "</span>" +
          "</div>" +
          '<p class="voice-log-label">生の認識結果</p>' +
          '<p class="voice-log-text mono">' + escapeHtml(log.rawText || "（なし）") + "</p>" +
          '<p class="voice-log-label">' + escapeHtml(log.processedLabel || "解析結果") + "</p>" +
          '<p class="voice-log-text">' + escapeHtml(log.processedSummary || log.parsedSummary || "（なし）") + "</p>" +
          '<p class="voice-log-label">補足</p>' +
          '<p class="voice-log-text">' + escapeHtml(log.note || "（なし）") + "</p>" +
        "</section>"
      );
    }).join("");
  }

  function initVoiceRecentLogs() {
    var toggleBtn = $("#voice-log-toggle-btn");
    var body = $("#voice-log-body");
    var clearBtn = $("#btn-voice-log-clear");
    if (!toggleBtn || !body) return;

    toggleBtn.addEventListener("click", function () {
      var hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggleBtn.textContent = "▼ 直近音声認識ログ（確認用）";
        renderVoiceRecentLogs();
      } else {
        body.setAttribute("hidden", "");
        toggleBtn.textContent = "▶ 直近音声認識ログ（確認用）";
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        saveVoiceRecentLogs([]);
        renderVoiceRecentLogs();
      });
    }

    renderVoiceRecentLogs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
