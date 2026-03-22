/**
 * パンセノート — UI オーケストレーション（Step 1〜5）
 */
(function () {
  "use strict";

  var C = window.PANSEE_CONFIG;
  var db = window.PANSEE_db;
  var norm = window.PANSEE_normalizeForSearch;
  var voice = window.PANSEE_voice;

  var state = {
    idb: null,
    license: null,
    settings: null,
    /** @type {null | { id?: string, title: string, book: string, page: string }} */
    draft: null,
    searchQuery: "",
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
      return { matches: rows, total: rows.length, capped: false };
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
    return { matches: matches, total: total, capped: capped };
  }

  function updatePlanBar() {
    $("#plan-name-display").textContent = state.license.planName || "試用版";
    $("#entry-limit").textContent = String(state.license.itemLimit);
    $("#license-status-label").textContent =
      state.license.licenseStatus === "trial_offline"
        ? "試用（管理サーバー未接続）"
        : String(state.license.licenseStatus || "—");
    var lb = state.settings && state.settings.lastBackupAt;
    $("#last-backup-label").textContent = lb ? lb : "—";
  }

  function refreshCount() {
    return db.countEntries(state.idb).then(function (n) {
      $("#entry-count").textContent = String(n);
      return n;
    });
  }

  function renderSearchMeta(result) {
    var el = $("#search-meta");
    if (!el) return;
    var q = state.searchQuery.trim();
    if (!q) {
      if (result.total > C.MAX_SEARCH_DISPLAY) {
        el.textContent =
          "検索結果が多いため先頭50件のみ表示しています。検索語を入力して絞り込んでください。";
      } else {
        if (result.total === 0 && state.draft) {
          el.textContent = "未保存の行があります。内容を確認して保存してください。";
        } else {
          el.textContent =
            result.total > 0
              ? "全 " + result.total + " 件を表示しています。"
              : "登録はまだありません。";
        }
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
      '<td><input class="inline" type="text" maxlength="' +
      C.MAX_TITLE_LENGTH +
      '" data-field="title" value="' +
      titleEsc +
      '" /></td>' +
      '<td><input class="inline" type="text" data-field="book" value="' +
      bookEsc +
      '" /></td>' +
      '<td><input class="inline" type="text" data-field="page" value="' +
      pageEsc +
      '" /></td>' +
      '<td class="readonly">' +
      escapeHtml(dateLabel) +
      "</td>" +
      '<td class="actions">' +
      '<button type="button" class="sm primary row-save">保存</button>' +
      '<button type="button" class="sm danger row-delete">削除</button>' +
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

  function renderTable() {
    return db.getAllEntries(state.idb).then(function (rows) {
      rows = sortEntries(rows);
      var res = applySearch(rows, state.searchQuery);
      var body = $("#entries-body");
      body.innerHTML = "";

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
        if (n >= state.license.itemLimit) {
          window.alert(
            "登録上限（" + state.license.itemLimit + "件）に達しています。保存できません。"
          );
          return;
        }
        var entry = db.buildNewEntry(vals.title, vals.book, vals.page);
        return db.putEntry(state.idb, entry).then(function () {
          state.draft = null;
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
    state.searchQuery = $("#manual-search").value || "";
    return renderTable();
  }

  function onVoiceSearch() {
    if (!voice.isSpeechSupported()) {
      window.alert("このブラウザでは音声認識を利用できません。手動検索をご利用ください。");
      return;
    }
    return voice.recognizeOnce().then(function (text) {
      $("#manual-search").value = text;
      state.searchQuery = text;
      return renderTable().then(function () {
        if (!text.trim()) {
          toast("音声を認識できませんでした。");
        }
      });
    });
  }

  function onVoiceRegister() {
    if (!voice.isSpeechSupported()) {
      window.alert("このブラウザでは音声認識を利用できません。手入力で登録してください。");
      return;
    }
    return voice.recognizeOnce().then(function (text) {
      var parsed = voice.parseRegisterTranscript(text);
      state.draft = null;
      return refreshCount().then(function (n) {
        var atLimit = n >= state.license.itemLimit;

        if (parsed.ok && !atLimit) {
          var entry = db.buildNewEntry(parsed.title, parsed.book, parsed.page);
          return db.putEntry(state.idb, entry).then(function () {
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
          toast(
            "登録上限に達しているため自動登録できません。データを整理するか、行を編集のうえ空きを作ってください。"
          );
          return renderTable();
        }

        state.draft = { title: "", book: "", page: "" };
        toast("音声から冊数・ページ・見出しを取り出せませんでした。手入力で保存できます。");
        return renderTable();
      });
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
          var limit = lic.itemLimit;
          var items = data.items;
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

    return db
      .openDb()
      .then(function (idb) {
        state.idb = idb;
        return db.ensureSeedDocs(idb);
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
        updatePlanBar();
        state.searchQuery = "";
        return renderTable();
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
