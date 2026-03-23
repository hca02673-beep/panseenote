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
    /** @type {null | { id?: string, title: string, book: string, page: string }} */
    draft: null,
    searchQuery: "",
    voiceRegisterMode: false,
    voicePreviewEntry: null,
  };

  var $ = function (sel) {
    return document.querySelector(sel);
  };

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
        "登録上限（" + limit + "件）に達しています。新規登録には既存データの削除またはプラン変更が必要です。"
      );
      return;
    }
    setEntryLimitInlineWarning("");
  }

  function startVoiceRegisterSingleRowMode() {
    state.voiceRegisterMode = true;
    state.voicePreviewEntry = null;
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
      var prev = el.textContent.match(/^(\d+)件登録済/);
      n = prev ? Number(prev[1]) : 0;
    }
    var label = formatPlanLabelForSummary(lic);
    el.textContent = n + "件登録済／上限" + limit + "件（" + label + "）";
  }

  function updatePlanBar() {
    var lb = state.settings && state.settings.lastBackupAt;
    var lbEl = $("#last-backup-label");
    if (lbEl) lbEl.textContent = lb ? lb : "—";
    var vb = $("#app-version-label");
    if (vb) vb.textContent = String(C.APP_VERSION || "—");
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
      if (result.total === 0 && state.draft) {
        el.textContent = "未保存の行があります。内容を確認して保存してください。";
      } else if (result.total > 0) {
        el.textContent =
          "検索語を入力して検索してください。前回検索語は保存され、次回起動時に復元されます。";
      } else {
        el.textContent = "登録はまだありません。";
      }
      return;
    }
    var parts = [];
    parts.push("「" + q + "」で検索");
    parts.push("該当 " + result.total + " 件");
    if (result.capped) {
      parts.push(
        "検索結果が多いため先頭50件のみ表示しています。検索語を追加して絞り込んでください。"
      );
    } else if (result.total === 0) {
      parts.push("（ヒットなし）");
    }
    el.textContent = parts.join(" — ");
  }

  function rowHtml(entry, isDraft) {
    var id = entry.id ? String(entry.id) : "";
    var dr = isDraft ? ' data-draft="1"' : "";
    var titleEsc = escapeAttr(entry.title || "");
    var bookEsc = escapeAttr(entry.book || "");
    var pageEsc = escapeAttr(entry.page || "");
    var dateLabel = entry.createdAt || "—";
    return (
      "<tr" +
      dr +
      (id ? ' data-id="' + escapeAttr(id) + '"' : "") +
      ">" +
      '<td class="col-title"><input class="inline" type="text" maxlength="' +
      C.MAX_TITLE_LENGTH +
      '" data-field="title" value="' +
      titleEsc +
      '" /></td>' +
      '<td class="col-book"><input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="book" value="' +
      bookEsc +
      '" /></td>' +
      '<td class="col-page"><input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="page" value="' +
      pageEsc +
      '" /></td>' +
      '<td class="readonly col-date">' +
      escapeHtml(dateLabel) +
      "</td>" +
      '<td class="actions col-actions">' +
      '<button type="button" class="sm row-save btn-action-green">保存</button>' +
      '<button type="button" class="sm row-delete btn-action-delete">削除</button>' +
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
    var inputs = tr.querySelectorAll("input[data-field]");
    var o = { title: "", book: "", page: "" };
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var f = inp.getAttribute("data-field");
      if (f === "title" || f === "book" || f === "page") {
        o[f] = inp.value;
      }
    }
    return o;
  }

  function closeSettingsIfOpen() {
    var det = document.querySelector("details.settings");
    if (det && det.open) {
      det.removeAttribute("open");
    }
  }

  function renderTable() {
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
          metaEl.textContent =
            "音声登録モードです。表示中の1行を確認して保存・削除できます。";
        }
        wireTableHandlers();
        return refreshCount();
      }

      if (state.draft) {
        var d = state.draft;
        body.insertAdjacentHTML(
          "afterbegin",
          rowHtml(
            {
              id: d.id || "",
              title: d.title,
              book: d.book,
              page: d.page,
              createdAt: "（未保存）",
            },
            true
          )
        );
      }

      for (var i = 0; i < res.matches.length; i++) {
        body.insertAdjacentHTML("beforeend", rowHtml(res.matches[i], false));
      }

      renderSearchMeta(res);
      wireTableHandlers();
      return refreshCount();
    });
  }

  function wireTableHandlers() {
    var body = $("#entries-body");
    body.onclick = function (ev) {
      var t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      var tr = t.closest("tr");
      if (!tr || !body.contains(tr)) return;

      if (t.classList.contains("row-save")) {
        onSaveRow(tr);
      } else if (t.classList.contains("row-delete")) {
        onDeleteRow(tr);
      }
    };
  }

  function onSaveRow(tr) {
    var draft = tr.getAttribute("data-draft") === "1";
    var vals = readRowFromTr(tr);
    if (!window.confirm("編集内容を保存しますか？")) return;

    if (draft) {
      return refreshCount().then(function (n) {
        if (n >= Number(state.license.itemLimit)) {
          window.alert(
            "登録上限（" + state.license.itemLimit + "件）に達しています。保存できません。"
          );
          setEntryLimitInlineWarning(
            "登録上限（" + state.license.itemLimit + "件）に達しているため保存できません。"
          );
          return;
        }
        var entry = db.buildNewEntry(vals.title, vals.book, vals.page);
        return db.putEntry(state.idb, entry).then(function () {
          state.draft = null;
          if (state.voiceRegisterMode) {
            state.voicePreviewEntry = entry;
          }
          toast("保存しました。");
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
        toast("保存しました。");
        return renderTable();
      });
    });
  }

  function onDeleteRow(tr) {
    var draft = tr.getAttribute("data-draft") === "1";
    if (draft) {
      if (!window.confirm("この行を破棄しますか？")) return;
      state.draft = null;
      return renderTable();
    }
    var id = tr.getAttribute("data-id");
    if (!id) return;
    if (!window.confirm("この登録を削除しますか？")) return;
    return db.deleteEntry(state.idb, id).then(function () {
      toast("削除しました。");
      return renderTable();
    });
  }

  function runSearch() {
    state.voiceRegisterMode = false;
    state.voicePreviewEntry = null;
    state.searchQuery = $("#manual-search").value || "";
    return saveSearchQueryToSettings(state.searchQuery).then(function () {
      return renderTable();
    });
  }

  function onVoiceSearch() {
    if (!voice.isSpeechSupported()) {
      window.alert("このブラウザでは音声認識を利用できません。手動検索をご利用ください。");
      return;
    }
    return voice.recognizeOnce().then(function (text) {
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      $("#manual-search").value = text;
      state.searchQuery = text;
      return saveSearchQueryToSettings(state.searchQuery).then(function () {
        return renderTable().then(function () {
          if (!text.trim()) {
            toast("音声を認識できませんでした。");
          }
        });
      });
    });
  }

  function onVoiceRegister() {
    if (!voice.isSpeechSupported()) {
      window.alert("このブラウザでは音声認識を利用できません。手入力で登録してください。");
      return;
    }
    return startVoiceRegisterSingleRowMode().then(function () {
      return voice.recognizeOnce();
    }).then(function (text) {
      var parsed = voice.parseRegisterTranscript(text);
      state.draft = null;
      state.voicePreviewEntry = null;
      return refreshCount().then(function (n) {
        var atLimit = n >= Number(state.license.itemLimit);

        if (parsed.ok && !atLimit) {
          var entry = db.buildNewEntry(parsed.title, parsed.book, parsed.page);
          return db.putEntry(state.idb, entry).then(function () {
            state.voicePreviewEntry = entry;
            toast("音声から登録しました。");
            return renderTable();
          });
        }

        if (parsed.ok && atLimit) {
          state.draft = {
            title: parsed.title,
            book: parsed.book,
            page: parsed.page,
          };
          setEntryLimitInlineWarning(
            "登録上限（" + state.license.itemLimit + "件）のため自動登録できません。表示中の1行を編集し、空きを作ってから保存してください。"
          );
          toast(
            "登録上限に達しているため自動登録できません。データを整理するか、行を編集のうえ空きを作ってください。"
          );
          return renderTable();
        }

        state.draft = { title: "", book: "", page: "" };
        toast("音声から冊数・ページ・見出しを取り出せませんでした。手入力で保存できます。");
        return renderTable();
      });
    }).catch(function () {
      state.draft = { title: "", book: "", page: "" };
      state.voicePreviewEntry = null;
      return renderTable();
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
      window.alert("ライセンスキーを入力してください。");
      return Promise.resolve();
    }
    setLicenseDiagnostics("");
    if (!lic.isValidLicenseKeyFormat(key)) {
      window.alert(
        "ライセンスキー形式が不正です（PN1-XXXX-XXXX-XXXX・英数字大文字）。"
      );
      return Promise.resolve();
    }
    if (!navigator.onLine) {
      window.alert("初回認証はオンライン環境で行ってください。");
      return Promise.resolve();
    }
    var url = getLicenseApiUrl();
    if (!url) {
      window.alert(
        "管理サーバーURLが未設定です。js/config.js の LICENSE_API_URL を設定してください。"
      );
      return Promise.resolve();
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
          window.alert(msg);
          return;
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
        window.alert(
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
          window.alert("バックアップファイルの形式が正しくありません。");
          return;
        }
        if (!data || data.app !== C.APP_ID || !Array.isArray(data.items)) {
          window.alert("バックアップファイルの形式が正しくありません。");
          return;
        }
        return db.getLicense(state.idb).then(function (lic) {
          var items = data.items;
          if (
            isUnauthenticatedTrial() &&
            items.length > C.DEFAULT_ITEM_LIMIT
          ) {
            window.alert(
              "このブラウザではライセンス認証が完了していません。このデータを取り込むにはオンライン認証が必要です。"
            );
            return;
          }
          var limit = Number(lic.itemLimit);
          if (isNaN(limit) || limit < 0) limit = C.DEFAULT_ITEM_LIMIT;
          var truncated = items.length > limit;
          var slice = items.slice(0, limit);

          return db.clearEntries(state.idb).then(function () {
            var chain = Promise.resolve();
            for (var i = 0; i < slice.length; i++) {
              (function (item) {
                chain = chain.then(function () {
                  var e = db.buildNewEntry(item.title, item.book, item.page);
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
                    window.alert(
                      "このプランの登録上限を超えるため、先頭から取り込める分のみ登録しました。超過分は登録されていません。"
                    );
                  } else {
                    window.alert(
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
        window.alert("バックアップファイルの読み込みに失敗しました。");
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
    window.addEventListener("online", function () {
      maybeCheckLicenseOnline();
    });

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
        state.searchQuery = String((state.settings && state.settings.lastSearchQuery) || "");
        if ($("#manual-search")) {
          $("#manual-search").value = state.searchQuery;
        }
        updatePlanBar();
        return renderTable();
      })
      .then(function () {
        return maybeCheckLicenseOnline().catch(function () {});
      })
      .catch(function (e) {
        console.error(e);
        window.alert(
          "データベースを初期化できませんでした。プライベートブラウズやストレージ制限を確認してください。"
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
