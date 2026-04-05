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
  };

  var $ = function (sel) {
    return document.querySelector(sel);
  };

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
        if (cancelable && options && options.danger) {
          cancelBtn.focus();
        } else {
          okBtn.focus();
        }
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

  function startVoiceRegisterSingleRowMode() {
    state.voiceRegisterMode = true;
    state.voicePreviewEntry = null;
    state.voiceRegisterMetaMsg = "";
    state.searchQuery = "";
    if ($("#manual-search")) {
      $("#manual-search").value = "";
    }
    return saveSearchQueryToSettings("").then(function () {
      return refreshCount().then(function () {
        return renderTable();
      });
    });
  }

  function sortEntries(rows) {
    return rows.slice().sort(function (a, b) {
      var ua = String(a.updatedAt || a.createdAt || "");
      var ub = String(b.updatedAt || b.createdAt || "");
      if (ua === ub) return String(b.id).localeCompare(String(a.id));
      return ub.localeCompare(ua);
    });
  }

  function applySearch(rows, q) {
    var qq = norm(q);
    if (!qq) {
      return { matches: [], total: rows.length, capped: false, emptyQuery: true };
    }
    var all = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tn = r.titleNormalized || norm(r.title);
      if (tn.indexOf(qq) >= 0) all.push(r);
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

  function formatIsoDisplay(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  }

  function isUnauthenticatedTrial() {
    var licDoc = state.license;
    if (!licDoc) return true;
    return !licDoc.licenseKey || String(licDoc.licenseKey).trim() === "";
  }

  function getLicenseApiUrl() {
    return C.getLicenseApiUrl();
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
    var lb = state.settings && state.settings.lastBackupAt;
    var lbEl = $("#last-backup-label");
    if (lbEl) lbEl.textContent = lb ? lb : "—";
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
        el.textContent = "検索語を入力して検索してください。検索語は短くするのがコツです";
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
    el.textContent = parts.join(" ");
    el.classList.add("has-result");
  }

  function rowHtml(entry, isDraft) {
    var compactTable = state.isCompactTable || isCompactTableViewport();
    var id = entry.id ? String(entry.id) : "";
    var dr = isDraft ? ' data-draft="1"' : "";
    var titleEsc = escapeAttr(entry.title || "");
    var bookEsc = escapeAttr(entry.book || "");
    var pageEsc = escapeAttr(entry.page || "");
    var memoEsc = escapeAttr(entry.memo || "");
    var dateLabel = entry.createdAt || "—";
    var hasMemo = (entry.memo || "").trim() !== "";

    var mainTr =
      "<tr" +
      dr +
      (id ? ' data-id="' + escapeAttr(id) + '"' : "") +
      ">" +
      '<td class="col-title">' +
      '<div class="title-cell">' +
      '<input class="inline" type="text" maxlength="' +
      C.MAX_TITLE_LENGTH +
      '" data-field="title" value="' +
      titleEsc +
      '" title="' + titleEsc + '" />' +
      '<button type="button" class="sm row-memo btn-memo' + (hasMemo ? " has-memo" : "") + '">▼メモ</button>' +
      '</div>' +
      '</td>' +
      '<td class="col-booknum">' +
      '<div class="booknum-wrap">' +
      '<input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="book" value="' + bookEsc + '" />' +
      '<input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="page" value="' + pageEsc + '" />' +
      '</div>' +
      '</td>' +
      (compactTable
        ? ""
        : '<td class="readonly col-date">' +
          escapeHtml(dateLabel) +
          "</td>") +
      '<td class="actions col-actions">' +
      '<button type="button" class="sm row-save btn-action-green">登録</button>' +
      (isDraft
        ? '<button type="button" class="sm row-delete btn-action-delete" disabled>削除</button>'
        : '<button type="button" class="sm row-delete btn-action-delete">削除</button>') +
      '<input type="hidden" data-field="memo" value="' + memoEsc + '" />' +
      "</td>" +
      "</tr>";

    var memoTr =
      '<tr class="memo-row"' +
      (id ? ' data-for="' + escapeAttr(id) + '"' : "") +
      " hidden>" +
      '<td colspan="' + (compactTable ? "3" : "4") + '" class="memo-cell">' +
      '<textarea class="memo-textarea" rows="2" maxlength="500" placeholder="メモを入力（保存ボタンで確定）...">' +
      escapeHtml(entry.memo || "") +
      "</textarea>" +
      "</td>" +
      "</tr>";

    return mainTr + memoTr;
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
    var inputs = tr.querySelectorAll("input[data-field]");
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

  function renderTable() {
    syncTableStructure();
    return db.getAllEntries(state.idb).then(function (rows) {
      closeSettingsIfOpen();
      rows = sortEntries(rows);
      var res = applySearch(rows, state.searchQuery);
      var body = $("#entries-body");
      body.innerHTML = "";

      if (state.voiceRegisterMode) {
        if (state.draft) {
          var dv = state.draft;
          body.insertAdjacentHTML(
            "afterbegin",
            rowHtml(
              {
                id: dv.id || "",
                title: dv.title,
                book: dv.book,
                page: dv.page,
                memo: dv.memo || "",
                createdAt: "（未保存）",
              },
              true
            )
          );
        } else if (state.voicePreviewEntry) {
          body.insertAdjacentHTML("afterbegin", rowHtml(state.voicePreviewEntry, false));
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
        restoreOpenMemoRows();
        return refreshCount();
      }

      for (var i = 0; i < res.matches.length; i++) {
        body.insertAdjacentHTML("beforeend", rowHtml(res.matches[i], false));
      }

      renderSearchMeta(res);
      wireTableHandlers();
      restoreOpenMemoRows();
      return refreshCount();
    });
  }

  function updateMemoBtnColor(btn, hasContent) {
    if (!btn) return;
    if (hasContent) {
      btn.classList.add("has-memo");
    } else {
      btn.classList.remove("has-memo");
    }
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
      // メモボタンの背景色をリアルタイムで更新
      var tr = ta.closest("tr.memo-row");
      if (tr) {
        var dataTr = tr.previousElementSibling;
        if (dataTr) {
          var btn = dataTr.querySelector("button.row-memo");
          updateMemoBtnColor(btn, ta.value.trim() !== "");
        }
      }
    };
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
      } else if (t.classList.contains("row-delete")) {
        onDeleteRow(tr);
      } else if (t.classList.contains("row-memo")) {
        onToggleMemo(tr, t);
      }
    };

  }

  function onSaveRow(tr) {
    var draft = tr.getAttribute("data-draft") === "1";
    var vals = readRowFromTr(tr);
    return showAppConfirm("編集内容を保存しますか？", {
      okLabel: "保存する",
    }).then(function (ok) {
      if (!ok) return;

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
            state.draft = null;
            if (state.voiceRegisterMode) {
              state.voicePreviewEntry = entry;
            }
            toast("編集内容を保存しました。重要情報がある場合は、重要情報部分を手動で削除してください。");
            return renderTable();
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
        return db.putEntry(state.idb, next).then(function () {
          // 5.2: voiceRegisterMode中に保存した場合、voicePreviewEntryを最新データで更新
          // しないと renderTable が古い entry（memo空）で再描画してしまう
          if (state.voiceRegisterMode && state.voicePreviewEntry && state.voicePreviewEntry.id === id) {
            state.voicePreviewEntry = next;
          }
          toast("編集内容を保存しました。重要情報がある場合は、重要情報部分を手動で削除してください。");
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
        toast("削除しました。");
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
    return saveSearchQueryToSettings(state.searchQuery).then(function () {
      return renderTable();
    });
  }

  function onVoiceSearch() {
    if (!voice.isSpeechSupported()) {
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      state.draft = null;
      state.voiceRegisterMetaMsg = "";
      state.voiceSearchMsg = "このブラウザでは音声認識を利用できません。手動検索をご利用ください。";
      state.searchQuery = "";
      state.openMemoIds = new Set();
      if ($("#manual-search")) $("#manual-search").value = "";
      return saveSearchQueryToSettings("").then(function () {
        return renderTable();
      });
    }
    return voice.recognizeOnce().then(function (text) {
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      state.draft = null;
      state.voiceRegisterMetaMsg = "";
      state.voiceSearchMsg = "";
      state.openMemoIds = new Set();
      if (!text.trim()) {
        state.voiceSearchMsg = "音声認識がタイムアウト（10秒）しました。手動検索もご利用可能です";
      }
      $("#manual-search").value = text;
      state.searchQuery = text;
      return saveSearchQueryToSettings(state.searchQuery).then(function () {
        return renderTable().then(function () {
          if (!text.trim()) {
            toast("音声認識がタイムアウトしました。");
          }
        });
      });
    });
  }

  function onVoiceRegister() {
    if (!voice.isSpeechSupported()) {
      state.voiceRegisterMode = true;
      state.voicePreviewEntry = null;
      state.voiceRegisterMetaMsg = "このブラウザでは音声認識を利用できません。手動での登録をご利用ください。";
      state.voiceSearchMsg = "";
      state.searchQuery = "";
      state.draft = { title: "", book: "", page: "", memo: "" };
      if ($("#manual-search")) $("#manual-search").value = "";
      return saveSearchQueryToSettings("").then(function () {
        return refreshCount().then(function () {
          return renderTable();
        });
      });
    }

    var PARSE_FAIL_MSG = "音声認識失敗（「○\"冊目\"○\"ページ\" サービス名」または「\"メモ\" サービス名」と発話）。手動で登録ができます。";

    // 上限チェックを音声認識開始前に行う
    return refreshCount().then(function (n) {
      var atLimit = n >= Number(state.license.itemLimit);
      if (atLimit) {
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

      // 上限未達: 音声登録モード開始 → 認識
      return startVoiceRegisterSingleRowMode().then(function () {
        return voice.recognizeOnce();
      }).then(function (text) {
        state.draft = null;
        state.voicePreviewEntry = null;

        // タイムアウト／無音
        if (!text.trim()) {
          state.draft = { title: "", book: "", page: "", memo: "" };
          setVoiceRegisterMeta("音声認識がタイムアウト（10秒）しました。手動で登録ができます。");
          return renderTable();
        }

        var parsed = voice.parseRegisterTranscript(text);

        // パース失敗
        if (!parsed.ok) {
          state.draft = { title: "", book: "", page: "", memo: "" };
          setVoiceRegisterMeta(PARSE_FAIL_MSG);
          return renderTable();
        }

        // サービス名なし（形式A・形式B共通）
        if (!parsed.title.trim()) {
          state.draft = { title: "", book: parsed.book, page: parsed.page, memo: "" };
          setVoiceRegisterMeta(PARSE_FAIL_MSG);
          return renderTable();
        }

        // 登録成功
        var entry = db.buildNewEntry(parsed.title, parsed.book, parsed.page, "");
        return db.putEntry(state.idb, entry).then(function () {
          state.voicePreviewEntry = entry;
          var msg = parsed.isMemo
            ? "音声メモ（冊・ページは空欄）を登録しました。手動で修正登録ができます。"
            : "音声から登録しました。手動で修正登録ができます。";
          setVoiceRegisterMeta(msg);
          toast("音声登録内容を保存しました。重要情報がある場合は、重要情報部分を手動で削除してください。");
          return renderTable();
        });
      }).catch(function () {
        state.draft = { title: "", book: "", page: "", memo: "" };
        state.voicePreviewEntry = null;
        setVoiceRegisterMeta("音声認識がタイムアウト（10秒）しました。手動で登録ができます。");
        return renderTable();
      });
    });
  }

  function shouldRunPeriodicCheck(licDoc) {
    if (!licDoc || !licDoc.nextCheckAfter) return true;
    var t = new Date(licDoc.nextCheckAfter).getTime();
    if (isNaN(t)) return true;
    return Date.now() >= t;
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
    if (btn) btn.disabled = true;
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
          closeSettingsIfOpen();
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
        if (btn) btn.disabled = false;
      });
  }

  function onExport() {
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
      var blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      var a = document.createElement("a");
      var name =
        "panseenote-backup-" +
        new Date().toISOString().replace(/[:.]/g, "-") +
        ".json";
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 500);

      var iso = new Date().toISOString();
      return db.updateSettings(state.idb, { lastBackupAt: iso }).then(function (s) {
        state.settings = s;
        updatePlanBar();
        closeSettingsIfOpen();
        toast("バックアップファイルを保存しました。");
      });
    });
  }

  function onImportFile(file) {
    if (!file) return Promise.resolve();
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
          var limit = Number(lic.itemLimit);
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
                  e.titleNormalized = norm(e.title);
                  return db.putEntry(state.idb, e);
                });
              })(slice[i]);
            }
            return chain.then(function () {
              state.draft = null;
              state.searchQuery = $("#manual-search").value || "";
              return saveSearchQueryToSettings(state.searchQuery).then(function () {
                return renderTable().then(function () {
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
      });
  }

  function init() {
    $("#btn-export").addEventListener("click", function () {
      onExport();
    });
    $("#btn-import-trigger").addEventListener("click", function () {
      $("#import-file").click();
    });
    $("#import-file").addEventListener("change", function () {
      var f = $("#import-file").files && $("#import-file").files[0];
      onImportFile(f).finally(function () {
        $("#import-file").value = "";
      });
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
    var settingsToggle = $("#btn-settings-toggle");
    if (settingsToggle) {
      settingsToggle.addEventListener("click", function () {
        var panel = $("#settings-panel");
        var mainSection = $("#main-section");
        if (!panel) return;
        var isOpen = !panel.hasAttribute("hidden");
        if (isOpen) {
          panel.setAttribute("hidden", "");
          if (mainSection) mainSection.removeAttribute("hidden");
          updateSettingsToggleUi(false);
        } else {
          panel.removeAttribute("hidden");
          if (mainSection) mainSection.setAttribute("hidden", "");
          updateSettingsToggleUi(true);
          panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }
    window.addEventListener("online", function () {
      maybeCheckLicenseOnline();
    });

    var layoutResizeTimer = null;
    function onViewportLayoutChange() {
      updatePlanSummaryLine();
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
        if ($("#manual-search")) {
          $("#manual-search").value = state.searchQuery;
        }
        updatePlanBar();
        syncTableStructure();
        return checkTerms().then(function () {
          return renderTable();
        });
      })
      .then(function () {
        return maybeCheckLicenseOnline().catch(function () {});
      })
      .then(function () {
        initSttTest();
      })
      .catch(function (e) {
        console.error(e);
        return showAppAlert(
          "データベースを初期化できませんでした。プライベートブラウズやストレージ制限を確認してください。"
        );
      });
  }

  /* ================================================================
     音声認識テストツール（開発者用）
     促音（っ）系と通常系の発音の認識精度を計測するためのツール。
     設定・ライセンスパネル内に配置。
     ================================================================ */

  /** 発話テスト原稿リスト
   *  ★ = 促音（っ）が含まれ認識ミスが起きやすい候補
   *  原稿は必ず「冊目」「ページ」文脈で発話させる（単独数字は発音が変わるため）
   */
  var STT_PROMPTS = [
    // ── 1冊目 × 1桁ページ（基準値） ──
    "1冊目1ページ テスト",
    "1冊目2ページ テスト",
    "1冊目3ページ テスト",
    "1冊目4ページ テスト",
    "1冊目5ページ テスト",
    "1冊目6ページ テスト",
    "1冊目7ページ テスト",
    "1冊目8ページ テスト",
    "1冊目9ページ テスト",
    // ── 1冊目 × 10台 ──
    "1冊目10ページ テスト",
    "1冊目11ページ テスト",
    "1冊目12ページ テスト",
    "1冊目15ページ テスト",
    "1冊目18ページ テスト",
    "1冊目19ページ テスト",
    // ── 1冊目 × 20台（★促音：にじゅっ） ──
    "1冊目20ページ テスト",
    "1冊目21ページ テスト",
    "1冊目22ページ テスト",
    "1冊目23ページ テスト",
    "1冊目25ページ テスト",
    "1冊目28ページ テスト",
    "1冊目29ページ テスト",
    // ── 1冊目 × 30台（★促音：さんじゅっ） ──
    "1冊目30ページ テスト",
    "1冊目31ページ テスト",
    "1冊目38ページ テスト",
    // ── 1冊目 × 40～90（促音混在） ──
    "1冊目40ページ テスト",
    "1冊目41ページ テスト",
    "1冊目50ページ テスト",
    "1冊目51ページ テスト",
    "1冊目60ページ テスト",
    "1冊目61ページ テスト",
    "1冊目70ページ テスト",
    "1冊目71ページ テスト",
    "1冊目80ページ テスト",
    "1冊目81ページ テスト",
    "1冊目90ページ テスト",
    "1冊目91ページ テスト",
    "1冊目99ページ テスト",
    // ── 冊目側の促音テスト（ページは1で固定） ──
    "20冊目1ページ テスト",
    "30冊目1ページ テスト",
    "40冊目1ページ テスト",
    "50冊目1ページ テスト",
    "60冊目1ページ テスト",
    "70冊目1ページ テスト",
    "80冊目1ページ テスト",
    "90冊目1ページ テスト",
    // ── 冊目・ページ両方に促音 ──
    "20冊目20ページ テスト",
    "20冊目21ページ テスト",
    "21冊目20ページ テスト",
    "20冊目28ページ テスト",
    "28冊目20ページ テスト",
    "30冊目30ページ テスト",
    "40冊目40ページ テスト",
    "80冊目80ページ テスト",
    "90冊目90ページ テスト",
    // ── 桁数ミスを誘発しやすい組み合わせ ──
    "8冊目80ページ テスト",
    "80冊目8ページ テスト",
    "2冊目20ページ テスト",
    "20冊目2ページ テスト",
    "9冊目90ページ テスト",
    "90冊目9ページ テスト",
    // ── 端値 ──
    "99冊目99ページ テスト",
    "0冊目0ページ テスト",
  ];

  function initSttTest() {
    var toggleBtn = $("#stt-toggle-btn");
    var body = $("#stt-body");
    var startBtn = $("#btn-stt-start");
    var stopBtn = $("#btn-stt-stop");
    var clearBtn = $("#btn-stt-clear");
    var copyBtn = $("#btn-stt-copy");
    var statusEl = $("#stt-status");
    var resultEl = $("#stt-result");
    var promptListEl = $("#stt-prompt-list");

    if (!toggleBtn || !body || !startBtn || !stopBtn) return;

    // 原稿リストを描画
    if (promptListEl) {
      var frag = document.createDocumentFragment();
      for (var pi = 0; pi < STT_PROMPTS.length; pi++) {
        var li = document.createElement("li");
        li.textContent = STT_PROMPTS[pi];
        frag.appendChild(li);
      }
      promptListEl.appendChild(frag);
    }

    // セクション開閉
    toggleBtn.addEventListener("click", function () {
      var hidden = body.hasAttribute("hidden");
      if (hidden) {
        body.removeAttribute("hidden");
        toggleBtn.textContent = "▼ 音声認識テスト（開発者用）";
      } else {
        body.setAttribute("hidden", "");
        toggleBtn.textContent = "▶ 音声認識テスト（開発者用）";
      }
    });

    var rec = null;
    var isRecording = false;
    var accumulated = "";

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = "stt-status" + (isError ? " stt-status-error" : "");
    }

    function buildOutput() {
      var promptLines = STT_PROMPTS.map(function (p, i) {
        return (i + 1) + ". " + p;
      }).join("\n");
      return (
        "=== STT テスト結果 ===\n" +
        "取得日時: " + new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) + "\n\n" +
        "[STT 出力（連続認識テキスト）]\n" +
        (accumulated.trim() || "（なし）") + "\n\n" +
        "[原稿リスト（" + STT_PROMPTS.length + " 件）]\n" +
        promptLines
      );
    }

    function startRecognition() {
      var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) {
        setStatus("このブラウザは音声認識に対応していません。", true);
        return;
      }
      rec = new Ctor();
      rec.lang = "ja-JP";
      rec.continuous = true;
      rec.interimResults = true;

      var currentInterim = "";

      rec.onresult = function (ev) {
        var newFinals = "";
        currentInterim = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var r = ev.results[i];
          if (r.isFinal) {
            newFinals += r[0].transcript;
          } else {
            currentInterim += r[0].transcript;
          }
        }
        if (newFinals) accumulated += newFinals;
        if (resultEl) {
          resultEl.value = accumulated + (currentInterim ? "\n[認識中...] " + currentInterim : "");
        }
      };

      rec.onerror = function (ev) {
        if (ev.error === "no-speech" || ev.error === "aborted") return;
        setStatus("認識エラー: " + ev.error, true);
      };

      rec.onend = function () {
        if (!isRecording) return;
        try {
          rec.start();
        } catch (e) {
          setStatus("録音が途切れました。再度「録音開始」を押してください。", true);
          stopRecording();
        }
      };

      try {
        rec.start();
        setStatus("● 録音中... 原稿を上から順に読み上げてください");
      } catch (e) {
        setStatus("録音を開始できませんでした。", true);
      }
    }

    function stopRecording() {
      isRecording = false;
      if (rec) {
        try { rec.stop(); } catch (e) {}
        rec = null;
      }
      startBtn.disabled = false;
      stopBtn.disabled = true;
      if (resultEl) resultEl.value = buildOutput();
      setStatus("録音停止。「コピー」ボタンで Cursor に貼り付けてください。");
    }

    startBtn.addEventListener("click", function () {
      accumulated = "";
      if (resultEl) resultEl.value = "";
      setStatus("");
      isRecording = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      startRecognition();
    });

    stopBtn.addEventListener("click", function () {
      stopRecording();
    });

    clearBtn.addEventListener("click", function () {
      accumulated = "";
      if (resultEl) resultEl.value = "";
      setStatus("");
    });

    copyBtn.addEventListener("click", function () {
      if (!resultEl || !resultEl.value) {
        setStatus("コピーする内容がありません。");
        return;
      }
      var text = resultEl.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          setStatus("クリップボードにコピーしました。");
        }).catch(function () {
          resultEl.select();
          document.execCommand("copy");
          setStatus("クリップボードにコピーしました。");
        });
      } else {
        resultEl.select();
        document.execCommand("copy");
        setStatus("クリップボードにコピーしました。");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
