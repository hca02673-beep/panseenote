/**
 * パンセノート — UI オーケストレーション（Step 1〜5）
 */
(function () {
  "use strict";

  var C = window.PANSEE_CONFIG;
  var db = window.PANSEE_db;
  var norm = window.PANSEE_normalizeForSearch;
  var voice = window.PANSEE_voice;
  var imageUtil = window.PANSEE_image;
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
    /** 音声登録モード突入時のレイアウトを固定（回転・リサイズでも維持） */
    voiceRegisterLayoutLock: null,
    /** 音声登録データ編集ペインのタイトル種別 */
    voiceRegisterEditorMode: "",
    voicePreviewEntry: null,
    voicePreviewBaseEntry: null,
    /** 音声登録モード中に #search-meta へ表示するメッセージ（空なら既定文言） */
    voiceRegisterMetaMsg: "",
    /** 音声検索フローで #search-meta へ表示するカスタムメッセージ（空なら通常表示） */
    voiceSearchMsg: "",
    /** @type {Set<string>} 展開中のメモ行のエントリID */
    openMemoIds: new Set(),
    /** 画面幅に応じた一覧レイアウト切替用 */
    isCompactTable: false,
    detachedActionsCol: null,
    detachedActionsTh: null,
    /** 直近の明示検索で確定した表示中サブセット */
    searchSnapshot: null,
    homeSearchQuery: "",
    mobileEditEntryId: "",
    mobileBackGuardReady: false,
    exportBusy: false,
    importBusy: false,
    forceRefreshBusy: false,
    backupRecommendBusy: false,
    usageSessionStarted: false,
    usageSentThisSession: false,
    usageSendBusy: false,
    photoPickerContext: null,
  };

  var AI_LOOKUP_CATEGORIES = [
    {
      value: "appliance",
      label: "家電・住宅設備",
      templates: [
        "使い方",
        "不具合・故障かも",
        "ランプ・エラー表示",
        "掃除・お手入れ",
        "取扱説明書・公式情報",
        "その他",
      ],
      placeholder: [
        "例：ランプが点滅するようになった",
        "例：エラー番号 H51 が出た",
        "例：ハンバーグの焼き方を知りたい",
      ].join("\n"),
    },
    {
      value: "food",
      label: "料理・食品",
      templates: [
        "レシピ・作り方",
        "分量",
        "保存方法・期限",
        "代用品",
        "失敗原因",
        "その他",
      ],
      placeholder: [
        "例：オイスターソースの代わりを知りたい",
        "例：レンジの加熱時間を知りたい",
        "例：冷凍のまま調理出来るか知りたい",
      ].join("\n"),
    },
    {
      value: "service",
      label: "契約・ID・サービス",
      templates: [
        "ログイン方法",
        "料金・契約内容",
        "解約・変更方法",
        "問い合わせ先",
        "トラブル対応",
        "その他",
      ],
      placeholder: [
        "例：ログインできない",
        "例：解約方法を知りたい",
        "例：利用履歴を知りたい",
      ].join("\n"),
    },
    {
      value: "general",
      label: "その他・一般",
      templates: [
        "使い方を知りたい",
        "困りごとを解決したい",
        "公式情報を探したい",
        "比較・判断したい",
        "その他",
      ],
      placeholder: [
        "例：使い方を知りたい",
        "例：治し方を知りたい",
        "例：公式情報を探したい",
      ].join("\n"),
    },
  ];

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var MOBILE_LAYOUT_MAX_WIDTH = 1024;

  function matchesMaxWidth(px) {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: " + String(px) + "px)").matches
    );
  }

  function bindPress(el, handler) {
    if (!el || typeof handler !== "function") return;
    var lastPointerUpAt = 0;

    function invoke(ev) {
      if (ev) {
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        if (typeof ev.stopPropagation === "function") ev.stopPropagation();
      }
      return handler(ev);
    }

    if (typeof window !== "undefined" && window.PointerEvent) {
      el.addEventListener("pointerup", function (ev) {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        lastPointerUpAt = Date.now();
        invoke(ev);
      });
      el.addEventListener("click", function (ev) {
        if (Date.now() - lastPointerUpAt < 450) return;
        invoke(ev);
      });
      return;
    }

    el.addEventListener("click", invoke);
  }

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
    updateFloatingUiTop();
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      el.classList.remove("show");
    }, 3200);
  }

  function warnOfflineVoiceUsage() {
    if (navigator.onLine) return;
    var now = Date.now();
    if (
      warnOfflineVoiceUsage._lastAt &&
      now - warnOfflineVoiceUsage._lastAt < 4000
    ) {
      return;
    }
    warnOfflineVoiceUsage._lastAt = now;
    toast(
      "オフライン時は音声認識が利用できない場合があります。必要に応じて手動入力をご利用ください。"
    );
  }

  function isAbortError(err) {
    return !!(err && (err.name === "AbortError" || err.code === 20));
  }

  function isVisibleForFloatingUi(el) {
    if (!el || el.hidden) return false;
    if (typeof window === "undefined" || !window.getComputedStyle) return true;
    var style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function updateFloatingUiTop() {
    if (typeof document === "undefined") return 0;
    var docEl = document.documentElement;
    if (!docEl) return 0;

    var anchorBottom = 0;
    var candidates = [
      $(".app-header"),
      $("#license-warning-banner"),
      $("#entry-limit-warning-inline"),
      $("#search-meta"),
    ];

    candidates.forEach(function (el) {
      if (!isVisibleForFloatingUi(el)) return;
      var rect = el.getBoundingClientRect();
      if (rect.bottom > anchorBottom) {
        anchorBottom = rect.bottom;
      }
    });

    var gap = matchesMaxWidth(MOBILE_LAYOUT_MAX_WIDTH) ? 8 : 10;
    var top = Math.max(16, Math.round(anchorBottom + gap));
    docEl.style.setProperty("--floating-ui-top", top + "px");
    return top;
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
    return "panseenote-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".zip";
  }

  function normalizeFileLabel(name, fallback) {
    var s = String(name || "").trim();
    if (s) return s;
    return String(fallback || "ブラウザ管理");
  }

  function buildBackupFilePayload() {
    return ensureZipLibReady().then(function (ZipLib) {
      return Promise.all([
        db.getAllEntries(state.idb),
        db.getLicense(state.idb),
        db.getAllPhotoAssets(state.idb),
      ]).then(function (triple) {
        var rows = sortEntries(triple[0]);
        var lic = triple[1];
        var assets = triple[2];
        var photoMap = Object.create(null);
        for (var i = 0; i < assets.length; i++) {
          var asset = assets[i];
          if (!photoMap[asset.entryId]) photoMap[asset.entryId] = {};
          photoMap[asset.entryId][asset.kind] = asset;
        }
        var payload = {
          app: C.APP_ID,
          version: C.EXPORT_JSON_VERSION,
          exportedAt: new Date().toISOString(),
          planCode: lic.planCode,
          itemLimit: lic.itemLimit,
          items: rows.map(function (e) {
            var item = {
              title: e.title,
              book: e.book,
              page: e.page,
              memo: e.memo || "",
              createdAt: e.createdAt,
              updatedAt: e.updatedAt,
            };
            if (e.photoAttached && photoMap[e.id] && photoMap[e.id].full && photoMap[e.id].thumb) {
              item.photo = {
                fullFileName: "photos/" + String(e.id) + ".jpg",
                thumbFileName: "thumbs/" + String(e.id) + ".jpg",
                mimeType: photoMap[e.id].full.mimeType || C.PHOTO_MIME_TYPE,
                thumbMimeType: photoMap[e.id].thumb.mimeType || C.PHOTO_MIME_TYPE,
                width: Number(photoMap[e.id].full.width || 0),
                height: Number(photoMap[e.id].full.height || 0),
                thumbWidth: Number(photoMap[e.id].thumb.width || 0),
                thumbHeight: Number(photoMap[e.id].thumb.height || 0),
              };
            }
            return item;
          }),
        };
        var zip = new ZipLib();
        zip.file(C.BACKUP_JSON_NAME, JSON.stringify(payload, null, 2));
        for (var j = 0; j < rows.length; j++) {
          var row = rows[j];
          if (!row.photoAttached || !photoMap[row.id] || !photoMap[row.id].full || !photoMap[row.id].thumb) {
            continue;
          }
          zip.file("photos/" + String(row.id) + ".jpg", photoMap[row.id].full.blob);
          zip.file("thumbs/" + String(row.id) + ".jpg", photoMap[row.id].thumb.blob);
        }
        return zip.generateAsync({
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        }).then(function (blob) {
          return {
            blob: blob,
            name: buildBackupFileName(),
          };
        });
      });
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

  function parseBackupJsonText(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return null;
    }
    if (!data || data.app !== C.APP_ID || !Array.isArray(data.items)) {
      return null;
    }
    return data;
  }

  function prepareJsonBackupImport(file) {
    return readFileAsText(file, "utf-8").then(function (text) {
      var data = parseBackupJsonText(text);
      if (!data) {
        return showAppAlert("バックアップファイルの形式が正しくありません。").then(function () {
          return null;
        });
      }
      var fileLabel = normalizeFileLabel(file && file.name, "ブラウザ管理");
      return {
        fileName: fileLabel,
        itemCount: data.items.length,
        execute: function (options) {
          return importBackupPayload(data, fileLabel, null, options);
        },
      };
    });
  }

  function prepareZipBackupImport(file) {
    return ensureZipLibReady().then(function (ZipLib) {
      return readFileAsArrayBuffer(file).then(function (buffer) {
        return ZipLib.loadAsync(buffer).then(function (zip) {
          var jsonFile = zip.file(C.BACKUP_JSON_NAME);
          if (!jsonFile) {
            return showAppAlert("バックアップファイルの形式が正しくありません。").then(function () {
              return null;
            });
          }
          return jsonFile.async("string").then(function (text) {
            var data = parseBackupJsonText(text);
            if (!data) {
              return showAppAlert("バックアップファイルの形式が正しくありません。").then(function () {
                return null;
              });
            }
            var fileLabel = normalizeFileLabel(file && file.name, "ブラウザ管理");
            return {
              fileName: fileLabel,
              itemCount: data.items.length,
              execute: function (options) {
                return importBackupPayload(data, fileLabel, function (photoMeta) {
                  if (!photoMeta || !photoMeta.fullFileName || !photoMeta.thumbFileName) {
                    return Promise.resolve(null);
                  }
                  var fullFile = zip.file(String(photoMeta.fullFileName));
                  var thumbFile = zip.file(String(photoMeta.thumbFileName));
                  if (!fullFile || !thumbFile) return Promise.resolve(null);
                  return Promise.all([
                    fullFile.async("blob"),
                    thumbFile.async("blob"),
                  ]).then(function (pair) {
                    return {
                      full: {
                        blob: pair[0],
                        mimeType: photoMeta.mimeType || C.PHOTO_MIME_TYPE,
                        width: Number(photoMeta.width || 0),
                        height: Number(photoMeta.height || 0),
                        sizeBytes: pair[0].size,
                      },
                      thumb: {
                        blob: pair[1],
                        mimeType: photoMeta.thumbMimeType || C.PHOTO_MIME_TYPE,
                        width: Number(photoMeta.thumbWidth || 0),
                        height: Number(photoMeta.thumbHeight || 0),
                        sizeBytes: pair[1].size,
                      },
                    };
                  });
                }, options);
              },
            };
          });
        });
      });
    });
  }

  function prepareImportJob(file) {
    if (!file) return Promise.resolve(null);
    return /\.zip$/i.test(String(file.name || ""))
      ? prepareZipBackupImport(file)
      : prepareJsonBackupImport(file);
  }

  function requestSaveFileHandle(name) {
    return window.showSaveFilePicker({
      suggestedName: name,
      types: [
        {
          description: "ZIP ファイル",
          accept: {
            "application/zip": [".zip"],
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
      return requestSaveFileHandle(name).then(function (saveHandle) {
        return writeBackupToHandle(saveHandle, blob).then(function () {
          return {
            mode: "saved",
            fileLabel: normalizeFileLabel(saveHandle.name || name, "ブラウザ管理"),
          };
        });
      });
    }
    var file = null;
    try {
      file = new File([blob], name, { type: "application/zip" });
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
          description: "バックアップファイル",
          accept: {
            "application/json": [".json"],
            "application/zip": [".zip"],
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

      var alignToMeta = !!(options && options.alignToMeta);
      overlay.classList.toggle("app-dialog-overlay-flow", alignToMeta);
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKeyDown, true);
      if (alignToMeta) {
        updateFloatingUiTop();
      }
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

  function showImportConfirmDialog(options) {
    return new Promise(function (resolve) {
      var overlay = $("#import-confirm-dialog");
      var fileNameEl = $("#import-confirm-file-name");
      var itemCountEl = $("#import-confirm-item-count");
      var modeWrap = $("#import-confirm-mode-wrap");
      var noteEl = $("#import-confirm-note");
      var okBtn = $("#import-confirm-ok");
      var cancelBtn = $("#import-confirm-cancel");
      if (
        !overlay ||
        !fileNameEl ||
        !itemCountEl ||
        !modeWrap ||
        !noteEl ||
        !okBtn ||
        !cancelBtn
      ) {
        resolve(null);
        return;
      }

      var existingCount = Number((options && options.existingCount) || 0);
      if (!isFinite(existingCount) || existingCount < 0) existingCount = 0;
      var hasExisting = existingCount > 0;
      var prevActive = document.activeElement;
      var done = false;
      var modeEls = overlay.querySelectorAll('input[name="import-confirm-mode"]');

      fileNameEl.textContent = formatTextDisplay(options && options.fileName);
      itemCountEl.textContent = formatCountDisplay(options && options.itemCount) + "件";
      modeWrap.hidden = !hasExisting;
      noteEl.textContent = hasExisting
        ? "現在の登録データは" + formatCountDisplay(existingCount) + "件です。"
        : "";
      noteEl.hidden = !hasExisting;

      for (var i = 0; i < modeEls.length; i++) {
        modeEls[i].checked = modeEls[i].value === "append";
      }

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

      function selectedMode() {
        for (var i = 0; i < modeEls.length; i++) {
          if (modeEls[i].checked) {
            return modeEls[i].value === "replace" ? "replace" : "append";
          }
        }
        return "append";
      }

      function onOk(ev) {
        if (ev) ev.preventDefault();
        close({
          mode: hasExisting ? selectedMode() : "append",
        });
      }

      function onCancel(ev) {
        if (ev) ev.preventDefault();
        close(null);
      }

      function onKeyDown(ev) {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        close(null);
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

  function setEntryLimitInlineWarning(msg) {
    var el = $("#entry-limit-warning-inline");
    if (!el) return;
    var text = String(msg || "").trim();
    el.textContent = text;
    el.hidden = text === "";
    updateFloatingUiTop();
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

  function createLocalId(prefix) {
    var head = prefix || "id";
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return head + "-" + window.crypto.randomUUID();
    }
    return head + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function buildEmptyVoiceRegisterDraft() {
    return {
      title: "",
      book: "",
      page: "",
      memo: "",
      photoAttached: false,
      photoId: "",
      photoThumbId: "",
      photoPending: null,
      photoThumbDataUrl: "",
      photoFullDataUrl: "",
      photoMarkedForRemoval: false,
    };
  }

  function hasPersistedPhoto(entry) {
    return !!(entry && (entry.photoId || entry.photoThumbId));
  }

  function hasPhotoAttached(entry) {
    return !!(
      entry &&
      (
        entry.photoAttached ||
        entry.photoPending ||
        entry.photoId ||
        entry.photoThumbId ||
        entry.photoThumbDataUrl
      )
    );
  }

  function hasMemoLikeContent(entry) {
    return !!(
      entry &&
      (
        String(entry.memo || "").trim() !== "" ||
        hasPhotoAttached(entry)
      )
    );
  }

  function cloneDraftWithPhotoMeta(source, patch) {
    return Object.assign(buildEmptyVoiceRegisterDraft(), source || {}, patch || {});
  }

  function buildClearedPhotoState() {
    return {
      photoAttached: false,
      photoId: "",
      photoThumbId: "",
      photoPending: null,
      photoThumbDataUrl: "",
      photoFullDataUrl: "",
      photoMarkedForRemoval: false,
    };
  }

  function buildPendingPhotoRemovalState() {
    var next = buildClearedPhotoState();
    next.photoMarkedForRemoval = true;
    return next;
  }

  function normalizeVoiceEditorEntry(entry) {
    return entry ? Object.assign(buildEmptyVoiceRegisterDraft(), entry) : null;
  }

  function hasPendingPhotoChange(prev, entry) {
    if (!entry) return false;
    if (entry.photoPending) return true;
    return !!(entry.photoMarkedForRemoval && hasPersistedPhoto(prev));
  }

  function getVoiceRegisterEditorPaneTitle() {
    if (state.voiceRegisterEditorMode === "manual_pref") {
      return "手動入力データ編集（新規データ登録）";
    }
    if (state.voiceRegisterEditorMode === "voice_success") {
      return "音声データ編集（登録済みデータの編集）";
    }
    return "音声データ編集（新規データ登録）";
  }

  function getZipLib() {
    return window.JSZip || null;
  }

  function ensureZipLibReady() {
    if (getZipLib()) return Promise.resolve(getZipLib());
    if (ensureZipLibReady._pending) return ensureZipLibReady._pending;
    ensureZipLibReady._pending = new Promise(function (resolve, reject) {
      var ZipLib = getZipLib();
      if (ZipLib) {
        resolve(ZipLib);
        return;
      }
      reject(new Error("zip_library_unavailable"));
    }).catch(function (err) {
      return showAppAlert(
        "ZIP処理ライブラリを読み込めませんでした。アプリを再読み込みしてから再度お試しください。"
      ).then(function () {
        return Promise.reject(err);
      });
    }).finally(function () {
      ensureZipLibReady._pending = null;
    });
    return ensureZipLibReady._pending;
  }

  function buildPhotoAssetsForEntry(entryId, processed) {
    var photoId = createLocalId("photo");
    var thumbId = createLocalId("thumb");
    return {
      photoId: photoId,
      thumbId: thumbId,
      assets: [
        {
          id: photoId,
          entryId: entryId,
          kind: "full",
          mimeType: processed.full.mimeType,
          blob: processed.full.blob,
          width: processed.full.width,
          height: processed.full.height,
          sizeBytes: processed.full.sizeBytes,
        },
        {
          id: thumbId,
          entryId: entryId,
          kind: "thumb",
          mimeType: processed.thumb.mimeType,
          blob: processed.thumb.blob,
          width: processed.thumb.width,
          height: processed.thumb.height,
          sizeBytes: processed.thumb.sizeBytes,
        },
      ],
    };
  }

  function getPendingPhotoData(entry) {
    return entry && entry.photoPending ? entry.photoPending : null;
  }

  function canAttachPhotoToEntry(entry, isDraft) {
    if (!state.voiceRegisterMode) return false;
    if (!entry || hasPhotoAttached(entry)) return false;
    if (isDraft) return true;
    return !!(state.voicePreviewEntry && state.voicePreviewEntry.id && entry.id === state.voicePreviewEntry.id);
  }

  function ensurePhotoLimitAvailable() {
    return db.countPhotoAttachments(state.idb).then(function (count) {
      if (count >= C.PHOTO_LIMIT) {
        return showAppAlert("写真登録上限（" + C.PHOTO_LIMIT + "枚）に達しています。", {
          alignToMeta: true,
        }).then(function () {
          return Promise.reject(new Error("photo_limit_reached"));
        });
      }
      return count;
    });
  }

  function buildPhotoThumbButtonHtml(entry, options) {
    options = options || {};
    var pending = getPendingPhotoData(entry);
    var thumbSrc = options.thumbSrc || entry.photoThumbDataUrl || (pending && pending.thumbDataUrl) || "";
    var fullSrc = options.fullSrc || entry.photoFullDataUrl || (pending && pending.fullDataUrl) || "";
    var thumbId = entry && entry.photoThumbId ? String(entry.photoThumbId) : "";
    var fullId = entry && entry.photoId ? String(entry.photoId) : "";
    if (!hasPhotoAttached(entry) && !thumbSrc && !thumbId) return "";
    var attrs = "";
    if (thumbSrc) attrs += ' data-photo-thumb-src="' + escapeAttr(thumbSrc) + '"';
    if (fullSrc) attrs += ' data-photo-full-src="' + escapeAttr(fullSrc) + '"';
    if (thumbId) attrs += ' data-photo-thumb-id="' + escapeAttr(thumbId) + '"';
    if (fullId) attrs += ' data-photo-full-id="' + escapeAttr(fullId) + '"';
    return (
      '<div class="photo-thumb-wrap">' +
      '<button type="button" class="photo-thumb-button"' + attrs + '>' +
      (thumbSrc
        ? '<img src="' + escapeAttr(thumbSrc) + '" alt="登録写真サムネイル" class="photo-thumb-image" />'
        : '<span class="photo-thumb-placeholder">写真</span>') +
      "</button>" +
      "</div>"
    );
  }

  function openPhotoViewerFromSources(fullSrc, fullId) {
    var overlay = $("#photo-viewer-overlay");
    var img = $("#photo-viewer-image");
    var closeBtn = $("#photo-viewer-close");
    if (!overlay || !img) return Promise.resolve();
    if (fullSrc) {
      updateFloatingUiTop();
      img.src = fullSrc;
      overlay.removeAttribute("hidden");
      if (closeBtn) {
        window.setTimeout(function () {
          closeBtn.focus();
        }, 0);
      }
      return Promise.resolve();
    }
    if (!fullId) return Promise.resolve();
    return db.getPhotoAsset(state.idb, fullId).then(function (asset) {
      if (!asset || !asset.blob || !imageUtil || typeof imageUtil.blobToDataUrl !== "function") return;
      return imageUtil.blobToDataUrl(asset.blob).then(function (src) {
        updateFloatingUiTop();
        img.src = src;
        overlay.removeAttribute("hidden");
        if (closeBtn) {
          window.setTimeout(function () {
            closeBtn.focus();
          }, 0);
        }
      });
    });
  }

  function closePhotoViewer() {
    var overlay = $("#photo-viewer-overlay");
    var img = $("#photo-viewer-image");
    if (overlay) overlay.setAttribute("hidden", "");
    if (img) img.removeAttribute("src");
  }

  function hydratePhotoThumbButtons() {
    if (!imageUtil || typeof imageUtil.blobToDataUrl !== "function") return;
    var buttons = document.querySelectorAll(".photo-thumb-button[data-photo-thumb-id]:not([data-photo-hydrated='1'])");
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.setAttribute("data-photo-hydrated", "1");
        var thumbId = btn.getAttribute("data-photo-thumb-id");
        if (!thumbId) return;
        db.getPhotoAsset(state.idb, thumbId).then(function (asset) {
          if (!asset || !asset.blob) return;
          return imageUtil.blobToDataUrl(asset.blob).then(function (src) {
            btn.setAttribute("data-photo-thumb-src", src);
            btn.innerHTML =
              '<img src="' + escapeAttr(src) + '" alt="登録写真サムネイル" class="photo-thumb-image" />';
          });
        }).catch(function () {});
      })(buttons[i]);
    }
  }

  function openPhotoPicker(context) {
    var input = $("#photo-file");
    if (!input) return;
    state.photoPickerContext = context || null;
    input.value = "";
    input.click();
  }

  function continueManualVoiceRegister() {
    return enterVoiceRegisterResultMode({
      draft: buildEmptyVoiceRegisterDraft(),
      metaMsg: "引き続き、手動で登録が出来ます。",
      editorMode: isManualRegisterPreferred() ? "manual_pref" : "voice_failed",
    });
  }

  function applyPreviewPhoto(processed, currentValues) {
    if (!state.voicePreviewEntry || !state.voicePreviewEntry.id) return Promise.resolve();
    state.voicePreviewEntry = Object.assign({}, state.voicePreviewEntry, currentValues || {}, {
      photoAttached: true,
      photoId: "",
      photoThumbId: "",
      photoPending: processed,
      photoThumbDataUrl: processed.thumbDataUrl,
      photoFullDataUrl: processed.fullDataUrl,
    });
    toast("登録ボタンで写真が保存されます");
    return renderTable();
  }

  function applyDraftPhoto(processed, currentValues) {
    state.draft = cloneDraftWithPhotoMeta(
      state.draft,
      Object.assign({}, currentValues || {}, {
        photoAttached: true,
        photoPending: processed,
        photoThumbDataUrl: processed.thumbDataUrl,
        photoFullDataUrl: processed.fullDataUrl,
        photoMarkedForRemoval: false,
      })
    );
    toast("登録ボタンで写真が保存されます");
    return renderTable();
  }

  function syncVoiceEditorValuesFromRow(tr) {
    if (!state.voiceRegisterMode || !tr) return;
    var vals = readRowFromTr(tr);
    if (tr.getAttribute("data-draft") === "1") {
      state.draft = cloneDraftWithPhotoMeta(state.draft, vals);
      return;
    }
    if (state.voicePreviewEntry) {
      state.voicePreviewEntry = Object.assign({}, state.voicePreviewEntry, vals);
    }
  }

  function deletePhotoFromVoiceEditorRow(tr) {
    if (!tr) return Promise.resolve();
    syncVoiceEditorValuesFromRow(tr);
    if (tr.getAttribute("data-draft") === "1") {
      state.draft = cloneDraftWithPhotoMeta(state.draft, buildClearedPhotoState());
      toast("登録ボタンで写真の変更が保存されます。");
      return renderTable();
    }
    if (!state.voicePreviewEntry || !state.voicePreviewEntry.id) return Promise.resolve();
    var currentValues = readRowFromTr(tr);
    var current = state.voicePreviewEntry;
    var nextPhotoState =
      current && (current.photoMarkedForRemoval || hasPersistedPhoto(current))
        ? buildPendingPhotoRemovalState()
        : buildClearedPhotoState();
    state.voicePreviewEntry = Object.assign({}, current, currentValues, nextPhotoState);
    toast("登録ボタンで写真の変更が保存されます。");
    return renderTable();
  }

  function saveEntryWithPendingPhotoChanges(prev, next, editorEntry) {
    var pendingPhoto = editorEntry && editorEntry.photoPending ? editorEntry.photoPending : null;
    var markedForRemoval = !!(editorEntry && editorEntry.photoMarkedForRemoval);
    if (pendingPhoto) {
      var persistPhoto = function () {
        var bundle = buildPhotoAssetsForEntry(prev.id, pendingPhoto);
        var withPhoto = db.patchEntry(next, {
          photoAttached: true,
          photoId: bundle.photoId,
          photoThumbId: bundle.thumbId,
        });
        if (hasPersistedPhoto(prev)) {
          return db.replaceEntryPhoto(state.idb, withPhoto, bundle.assets);
        }
        return db.putEntryWithPhotoAssets(state.idb, withPhoto, bundle.assets);
      };
      if (hasPersistedPhoto(prev)) {
        return persistPhoto();
      }
      return ensurePhotoLimitAvailable().then(persistPhoto);
    }
    if (markedForRemoval && hasPersistedPhoto(prev)) {
      return db.deleteEntryPhoto(state.idb, db.patchEntry(next, {
        photoAttached: false,
        photoId: "",
        photoThumbId: "",
      }));
    }
    return db.putEntry(state.idb, next);
  }

  function onPhotoFileSelected(file) {
    var ctx = state.photoPickerContext || null;
    state.photoPickerContext = null;
    if (!file || !ctx) return Promise.resolve();
    if (!imageUtil || typeof imageUtil.processPhotoFile !== "function") {
      return showAppAlert("写真処理を開始できませんでした。", {
        alignToMeta: true,
      });
    }
    return imageUtil.processPhotoFile(file)
      .then(function (processed) {
        if (ctx.kind === "draft") {
          return applyDraftPhoto(processed, ctx.currentValues);
        }
        if (ctx.kind === "preview") {
          return applyPreviewPhoto(processed, ctx.currentValues);
        }
      })
      .catch(function (err) {
        console.error("Photo processing failed:", err);
        return showAppAlert("写真の取り込みに失敗しました。", {
          alignToMeta: true,
        });
      });
  }

  function isManualRegisterPreferred() {
    return !!(state.settings && state.settings.preferManualRegister);
  }

  function normalizeSpeechTimeoutMs(value) {
    var n = Number(value);
    return n === 5000 || n === 10000 ? n : C.SPEECH_TIMEOUT_MS;
  }

  function getSpeechTimeoutMs() {
    return normalizeSpeechTimeoutMs(state.settings && state.settings.speechTimeoutMs);
  }

  function getSpeechTimeoutSecondsLabel() {
    return String(Math.round(getSpeechTimeoutMs() / 1000)) + "秒";
  }

  function buildSpeechTimeoutMessage(suffix) {
    return "音声認識がタイムアウト（" + getSpeechTimeoutSecondsLabel() + "）しました。" + String(suffix || "");
  }

  function enterManualRegisterMode(metaMsg) {
    return enterVoiceRegisterResultMode({
      draft: buildEmptyVoiceRegisterDraft(),
      metaMsg: String(metaMsg || "手動で登録ができます。"),
      editorMode: isManualRegisterPreferred() ? "manual_pref" : "voice_failed",
    });
  }

  function updateVoiceRegisterButtonUi() {
    var titleEl = $("#voice-register-title");
    var subPrimaryEl = $("#voice-register-sub-primary");
    var subSecondaryEl = $("#voice-register-sub-secondary");
    var manual = isManualRegisterPreferred();
    if (titleEl) titleEl.textContent = manual ? "データ登録" : "音声登録";
    if (subPrimaryEl) {
      subPrimaryEl.textContent = manual ? "（手動入力）" : "（サービス名）";
    }
    if (subSecondaryEl) {
      subSecondaryEl.hidden = manual;
    }
  }

  function updateClientSettingsUi() {
    var manualEl = $("#setting-prefer-manual-register");
    if (manualEl) manualEl.checked = isManualRegisterPreferred();
    var timeoutEl = $("#setting-speech-timeout");
    if (timeoutEl) timeoutEl.value = String(getSpeechTimeoutMs());
    updateVoiceRegisterButtonUi();
  }

  function setAccordionExpanded(toggleBtn, body, label, expanded, onOpen) {
    if (!toggleBtn || !body) return;
    if (expanded) {
      body.removeAttribute("hidden");
      toggleBtn.textContent = "▼ " + label;
      if (typeof onOpen === "function") onOpen();
      return;
    }
    body.setAttribute("hidden", "");
    toggleBtn.textContent = "▶ " + label;
  }

  function openAccordionByIds(toggleId, bodyId, label, onOpen) {
    setAccordionExpanded($(toggleId), $(bodyId), label, true, onOpen);
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
    var entering = !state.voiceRegisterMode;
    if (entering) {
      state.homeSearchQuery = state.searchQuery;
    }
    state.voiceRegisterMode = true;
    if (entering || !state.voiceRegisterLayoutLock) {
      state.voiceRegisterLayoutLock = snapshotViewportLayoutFlags();
    }
    if (options.editorMode !== undefined) {
      state.voiceRegisterEditorMode = String(options.editorMode || "");
    }
    state.voicePreviewBaseEntry = normalizeVoiceEditorEntry(options.previewEntry || null);
    state.voicePreviewEntry = normalizeVoiceEditorEntry(options.previewEntry || null);
    state.draft = normalizeVoiceEditorEntry(options.draft || null);
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

  function resetVoiceRegisterState() {
    state.voiceRegisterMode = false;
    state.voiceRegisterLayoutLock = null;
    state.voiceRegisterEditorMode = "";
    state.voicePreviewBaseEntry = null;
    state.voicePreviewEntry = null;
    state.draft = null;
    state.voiceRegisterMetaMsg = "";
    state.openMemoIds = new Set();
  }

  function goHomeScreen() {
    closeSettingsIfOpen();
    resetVoiceRegisterState();
    state.voiceSearchMsg = "";
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
    if ($("#ai-lookup-overlay") && !$("#ai-lookup-overlay").hasAttribute("hidden")) {
      closeAiLookupDialog();
      rearmMobileBackGuard();
      return;
    }
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

  function hasEntryContentChanged(prev, next) {
    if (!prev || !next) return true;
    return (
      String(prev.title || "") !== String(next.title || "") ||
      String(prev.book || "") !== String(next.book || "") ||
      String(prev.page || "") !== String(next.page || "") ||
      String(prev.memo || "") !== String(next.memo || "")
    );
  }

  function hasSearchableEntryText(entry) {
    if (!entry) return false;
    return (
      String(entry.title || "").trim() !== "" ||
      String(entry.memo || "").trim() !== ""
    );
  }

  function isVoiceRegisterEditorRow(tr) {
    return !!(
      tr &&
      tr.tagName === "TR" &&
      tr.classList.contains("mobile-inline-editor-row")
    );
  }

  function getVoiceRegisterEditorBaseEntry(tr) {
    if (!isVoiceRegisterEditorRow(tr)) return null;
    if (tr.getAttribute("data-draft") === "1") {
      return buildEmptyVoiceRegisterDraft();
    }
    return normalizeVoiceEditorEntry(state.voicePreviewBaseEntry || null);
  }

  function getVoiceRegisterEditorCurrentEntry(tr) {
    if (!isVoiceRegisterEditorRow(tr)) return null;
    var vals = readRowFromTr(tr);
    if (tr.getAttribute("data-draft") === "1") {
      return cloneDraftWithPhotoMeta(state.draft, vals);
    }
    return Object.assign({}, normalizeVoiceEditorEntry(state.voicePreviewEntry || null) || {}, vals);
  }

  function isVoiceRegisterEditorDirty(tr) {
    var base = getVoiceRegisterEditorBaseEntry(tr);
    var current = getVoiceRegisterEditorCurrentEntry(tr);
    if (!base || !current) return false;
    return hasEntryContentChanged(base, current) || hasPendingPhotoChange(base, current);
  }

  function canSubmitVoiceRegisterEditor(tr) {
    var current = getVoiceRegisterEditorCurrentEntry(tr);
    return !!(current && isVoiceRegisterEditorDirty(tr) && hasSearchableEntryText(current));
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
    if (String(msg || "").trim()) {
      openAccordionByIds(
        "#internal-settings-toggle-btn",
        "#internal-settings-body",
        "内部情報・診断"
      );
    }
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
      updateFloatingUiTop();
      return;
    }
    ban.hidden = false;
    ban.textContent = msg;
    updateFloatingUiTop();
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
    return matchesMaxWidth(MOBILE_LAYOUT_MAX_WIDTH);
  }

  /** スマホ寄りレイアウト幅（1024px 以下） */
  function isPhoneViewport() {
    return matchesMaxWidth(MOBILE_LAYOUT_MAX_WIDTH);
  }

  function isPhoneSearchSheetMode() {
    return isPhoneViewport();
  }

  function snapshotViewportLayoutFlags() {
    var phone = isPhoneViewport();
    return {
      phone: phone,
      compact: isCompactTableViewport(),
      phoneSheet: phone,
    };
  }

  function ensureVoiceRegisterLayoutLock() {
    if (!state.voiceRegisterMode) return null;
    if (!state.voiceRegisterLayoutLock) {
      state.voiceRegisterLayoutLock = snapshotViewportLayoutFlags();
    }
    return state.voiceRegisterLayoutLock;
  }

  function isCompactTableViewport() {
    return matchesMaxWidth(MOBILE_LAYOUT_MAX_WIDTH);
  }

  /**
   * スマホ検索シート時は操作列を DOM から外し、列構成を合わせる。
   * display:none では Chrome の colspan 再計算に負けるため、列そのものを脱着する。
   * @returns {boolean} 構造が変わった場合 true
   */
  function syncTableStructure() {
    var table = document.querySelector("table.entries-table");
    if (!table) return false;
    var lock = ensureVoiceRegisterLayoutLock();
    var compact = lock ? !!lock.compact : isCompactTableViewport();
    var phoneSheet = lock ? !!lock.phoneSheet : isPhoneSearchSheetMode();
    var changed = state.isCompactTable !== compact;
    var colgroup = table.querySelector("colgroup");
    var headRow = table.querySelector("thead tr");
    if (!colgroup || !headRow) {
      state.isCompactTable = compact;
      return changed;
    }

    var colActions = colgroup.querySelector("col.col-actions");
    var thActions = headRow.querySelector("th.th-actions");

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
    updateClientSettingsUi();
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
      updateFloatingUiTop();
      return;
    }
    var parts = [];
    parts.push("「" + q + "」で検索");
    parts.push("— 該当 " + result.total + " 件");
    if (result.capped) {
      parts.push(
        "（検索結果が多いため先頭50件のみ表示。検索語を長くしてください）"
      );
    } else if (result.total === 0) {
      parts.push("（ヒットなし）");
    }
    if (isPhoneSearchSheetMode() && result.total > 0) {
      parts.push("（行タップで詳細画面（メモ欄）が開きます）");
    }
    el.textContent = parts.join(" ");
    el.classList.add("has-result");
    updateFloatingUiTop();
  }

  function rowHtml(entry, isDraft, options) {
    options = options || {};
    var phoneSheetRow = !!options.phoneSheetRow;
    var showMemoButton = options.showMemoButton !== false;
    var showExitButton = !!options.showExitButton;
    var allowPhotoButton = !!options.allowPhotoButton;
    var initialValues = options.initialValues || null;
    var saveDisabled = !!options.saveDisabled;
    var id = entry.id ? String(entry.id) : "";
    var dr = isDraft ? ' data-draft="1"' : "";
    var titleEsc = escapeAttr(entry.title || "");
    var bookEsc = escapeAttr(entry.book || "");
    var pageEsc = escapeAttr(entry.page || "");
    var memoEsc = escapeAttr(entry.memo || "");
    var hasMemo = hasMemoLikeContent(entry);
    var memoInitiallyOpen = !!options.memoInitiallyOpen;
    var saveLabel = options.saveLabel || "登録";
    var deleteLabel = options.deleteLabel || "削除";
    var exitLabel = options.exitLabel || "終了";
    var rowClass = phoneSheetRow ? ' class="row-tappable"' : "";
    var photoButtonHtml = allowPhotoButton && !hasPhotoAttached(entry)
      ? '<button type="button" class="sm row-photo">写真選択</button>'
      : "";
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
          '" data-field="title" title="' + titleEsc + '" placeholder="情報を入力（サービス名空欄のデータ登録はできません）...">' +
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
      (phoneSheetRow
        ? ""
        : '<td class="actions col-actions' + (showExitButton ? " voice-register-actions" : "") + '">' +
          (showExitButton
            ? '<button type="button" class="sm row-exit">' + escapeHtml(exitLabel) + "</button>"
            : "") +
          photoButtonHtml +
          '<button type="button" class="sm row-ai-search btn-action-ai">AIで調べる</button>' +
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
      '<td colspan="3" class="memo-cell">' +
      '<div class="memo-photo-layout">' +
      '<textarea class="memo-textarea" rows="2" maxlength="500" placeholder="メモを入力（登録ボタンで確定）...">' +
      escapeHtml(entry.memo || "") +
      "</textarea>" +
      buildPhotoThumbButtonHtml(entry) +
      "</div>" +
      "</td>" +
      "</tr>";

    return mainTr + memoTr;
  }

  function mobileVoiceEditorRowHtml(entry, isDraft, options) {
    options = options || {};
    var id = entry.id ? String(entry.id) : "";
    var dr = isDraft ? ' data-draft="1"' : "";
    var lock = ensureVoiceRegisterLayoutLock();
    var phoneSheetMode = lock ? !!lock.phoneSheet : isPhoneSearchSheetMode();
    var colSpan = phoneSheetMode ? 2 : 3;
    var allowPhotoButton = !!options.allowPhotoButton;
    var saveDisabled = !!options.saveDisabled;
    var saveLabel = options.saveLabel || "登録";
    var deleteLabel = options.deleteLabel || "削除";
    var exitLabel = options.exitLabel || "閉じる";
    var photoActionLabel = hasPhotoAttached(entry) ? "写真削除" : "写真選択";

    return (
      '<tr class="mobile-inline-editor-row"' +
      dr +
      (id ? ' data-id="' + escapeAttr(id) + '"' : "") +
      ">" +
      '<td colspan="' + colSpan + '" class="mobile-inline-editor-cell">' +
      '<div class="mobile-inline-editor">' +
      '<h2 class="mobile-edit-sheet-title">' + escapeHtml(getVoiceRegisterEditorPaneTitle()) + "</h2>" +
      '<label class="mobile-edit-field">' +
      "<span>サービス名</span>" +
      '<textarea class="mobile-inline-title" rows="2" maxlength="' +
      C.MAX_TITLE_LENGTH +
      '" data-field="title" placeholder="情報を入力（サービス名空欄のデータ登録はできません）...">' +
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
      '<div class="mobile-edit-field memo-photo-field">' +
      "<span>メモ</span>" +
      '<div class="memo-photo-layout">' +
      '<textarea class="memo-photo-textarea" rows="5" maxlength="500" data-field="memo" placeholder="メモを入力（登録ボタンで確定）...">' +
      escapeHtml(entry.memo || "") +
      "</textarea>" +
      buildPhotoThumbButtonHtml(entry) +
      "</div>" +
      "</div>" +
      '<div class="mobile-edit-sheet-actions mobile-inline-editor-actions">' +
      '<button type="button" class="app-dialog-btn app-dialog-btn-secondary row-exit">' +
      escapeHtml(exitLabel) +
      "</button>" +
      (allowPhotoButton
        ? '<button type="button" class="app-dialog-btn app-dialog-btn-secondary row-photo" data-photo-action="' +
          (hasPhotoAttached(entry) ? "remove" : "select") +
          '">' + photoActionLabel + "</button>"
        : "") +
      '<button type="button" class="app-dialog-btn btn-action-green row-save"' + (saveDisabled ? " disabled" : "") + ">" +
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

  function getAiLookupCategoryDef(categoryValue) {
    var value = String(categoryValue || "");
    for (var i = 0; i < AI_LOOKUP_CATEGORIES.length; i++) {
      if (AI_LOOKUP_CATEGORIES[i].value === value) {
        return AI_LOOKUP_CATEGORIES[i];
      }
    }
    return AI_LOOKUP_CATEGORIES[0];
  }

  function fillAiLookupCategoryOptions() {
    var categoryEl = $("#ai-lookup-category");
    if (!categoryEl || categoryEl.options.length > 0) return;
    for (var i = 0; i < AI_LOOKUP_CATEGORIES.length; i++) {
      var def = AI_LOOKUP_CATEGORIES[i];
      categoryEl.insertAdjacentHTML(
        "beforeend",
        '<option value="' + escapeAttr(def.value) + '">' + escapeHtml(def.label) + "</option>"
      );
    }
  }

  function updateAiLookupTemplateOptions() {
    var categoryEl = $("#ai-lookup-category");
    var templateEl = $("#ai-lookup-template");
    var userTextEl = $("#ai-lookup-user-text");
    if (!categoryEl || !templateEl) return;
    var def = getAiLookupCategoryDef(categoryEl.value);
    var prev = templateEl.value;
    templateEl.innerHTML = "";
    for (var i = 0; i < def.templates.length; i++) {
      var label = def.templates[i];
      templateEl.insertAdjacentHTML(
        "beforeend",
        '<option value="' + escapeAttr(label) + '">' + escapeHtml(label) + "</option>"
      );
    }
    if (prev) {
      templateEl.value = prev;
    }
    if (!templateEl.value && def.templates.length) {
      templateEl.value = def.templates[0];
    }
    if (userTextEl) {
      userTextEl.placeholder = def.placeholder || "";
    }
  }

  function buildAiLookupBaseText(values) {
    if (!values) return "";
    var parts = [];
    var title = String(values.title || "").trim();
    var memo = String(values.memo || "").trim();
    if (title) parts.push(title);
    if (memo) parts.push(memo);
    return parts.join("。");
  }

  function normalizeAiLookupText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function openAiLookupDialog(values) {
    var overlay = $("#ai-lookup-overlay");
    var baseTextEl = $("#ai-lookup-base-text");
    var categoryEl = $("#ai-lookup-category");
    var userTextEl = $("#ai-lookup-user-text");
    if (!overlay || !baseTextEl || !categoryEl || !userTextEl) return;
    fillAiLookupCategoryOptions();
    baseTextEl.value = buildAiLookupBaseText(values);
    userTextEl.value = "";
    if (!categoryEl.value) {
      categoryEl.value = AI_LOOKUP_CATEGORIES[0].value;
    }
    updateAiLookupTemplateOptions();
    overlay.removeAttribute("hidden");
  }

  function closeAiLookupDialog() {
    var overlay = $("#ai-lookup-overlay");
    if (overlay) overlay.setAttribute("hidden", "");
  }

  function buildAiLookupQueryText() {
    var baseText = normalizeAiLookupText($("#ai-lookup-base-text") && $("#ai-lookup-base-text").value);
    var userText = normalizeAiLookupText($("#ai-lookup-user-text") && $("#ai-lookup-user-text").value);
    var template = normalizeAiLookupText($("#ai-lookup-template") && $("#ai-lookup-template").value);
    if (!baseText) {
      return "";
    }
    if (userText) {
      return baseText + " について、" + userText + "。" + template;
    }
    return baseText + " について。" + template;
  }

  function openAiLookupSearch() {
    var queryText = buildAiLookupQueryText();
    if (!queryText) {
      return showAppAlert("検索結果を入力してください。", {
        okLabel: "閉じる",
      });
    }
    var url = "https://www.google.com/search?q=" + encodeURIComponent(queryText);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openAiLookupDialogForRow(tr) {
    if (!tr) return;
    openAiLookupDialog(readRowFromTr(tr));
  }

  function openAiLookupDialogForMobileEditSheet() {
    openAiLookupDialog(getMobileEditSheetValues());
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
    var saveBtn = tr.querySelector("button.row-save");
    if (!saveBtn) return;
    if (isVoiceRegisterEditorRow(tr)) {
      saveBtn.disabled = !canSubmitVoiceRegisterEditor(tr);
      return;
    }
    if (!isDirtyTrackedDesktopListRow(tr)) return;
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
      memoBtn.classList.toggle("has-memo", hasMemoLikeContent(entry));
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
      var lock = ensureVoiceRegisterLayoutLock();
      var phoneSheetMode = state.voiceRegisterMode ? true : (lock ? !!lock.phoneSheet : isPhoneSearchSheetMode());
      // 音声登録中は端末幅に関係なくデータ編集ペイン（スマホUI）へ統一
      var phoneVoiceRegisterMode = !!state.voiceRegisterMode;
      var desktopVoiceRegisterMode = state.voiceRegisterMode && !phoneVoiceRegisterMode;
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
        if (state.draft) {
          var dv = state.draft;
          body.insertAdjacentHTML(
            "afterbegin",
            mobileVoiceEditorRowHtml(
              {
                id: dv.id || "",
                title: dv.title,
                book: dv.book,
                page: dv.page,
                memo: dv.memo || "",
                photoAttached: !!dv.photoAttached,
                photoId: dv.photoId || "",
                photoThumbId: dv.photoThumbId || "",
                photoThumbDataUrl: dv.photoThumbDataUrl || "",
                photoFullDataUrl: dv.photoFullDataUrl || "",
                photoPending: dv.photoPending || null,
                createdAt: "（未保存）",
              },
              true,
              {
                saveLabel: "登録",
                deleteLabel: "削除",
                exitLabel: "閉じる",
                allowPhotoButton: true,
                saveDisabled: !hasSearchableEntryText(dv),
              }
            )
          );
        } else if (state.voicePreviewEntry) {
          body.insertAdjacentHTML(
            "afterbegin",
            mobileVoiceEditorRowHtml(state.voicePreviewEntry, false, {
              saveLabel: "登録",
              deleteLabel: "削除",
              exitLabel: "閉じる",
              allowPhotoButton: true,
              saveDisabled:
                !(
                  state.voicePreviewBaseEntry &&
                  (hasEntryContentChanged(
                    state.voicePreviewBaseEntry,
                    state.voicePreviewEntry
                  ) ||
                    hasPendingPhotoChange(
                      state.voicePreviewBaseEntry,
                      state.voicePreviewEntry
                    )) &&
                  hasSearchableEntryText(state.voicePreviewEntry)
                ),
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
        hydratePhotoThumbButtons();
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
      hydratePhotoThumbButtons();
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
    var photoSlot = $("#mobile-edit-photo-slot");
    if (photoSlot) {
      photoSlot.setAttribute("hidden", "");
      photoSlot.innerHTML = "";
    }
    state.mobileEditEntryId = "";
  }

  function openMobileEditSheet(entry) {
    var overlay = $("#mobile-edit-sheet-overlay");
    if (!overlay || !entry) return;
    var title = $("#mobile-edit-title");
    var book = $("#mobile-edit-book");
    var page = $("#mobile-edit-page");
    var memo = $("#mobile-edit-memo");
    var photoSlot = $("#mobile-edit-photo-slot");
    if (title) title.value = entry.title || "";
    if (book) book.value = entry.book || "";
    if (page) page.value = entry.page || "";
    if (memo) memo.value = entry.memo || "";
    if (photoSlot) {
      if (hasPhotoAttached(entry)) {
        photoSlot.innerHTML = buildPhotoThumbButtonHtml(entry);
        photoSlot.removeAttribute("hidden");
        hydratePhotoThumbButtons();
      } else {
        photoSlot.innerHTML = "";
        photoSlot.setAttribute("hidden", "");
      }
    }
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
      alignToMeta: true,
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
      var photoThumbBtn = t.closest("button.photo-thumb-button");
      if (photoThumbBtn && body.contains(photoThumbBtn)) {
        openPhotoViewerFromSources(
          photoThumbBtn.getAttribute("data-photo-full-src") || "",
          photoThumbBtn.getAttribute("data-photo-full-id") || ""
        );
        return;
      }
      var tr = t.closest("tr");
      if (!tr || !body.contains(tr)) return;
      if (tr.classList.contains("memo-row")) return;

      if (t.classList.contains("row-save")) {
        onSaveRow(tr);
      } else if (t.classList.contains("row-ai-search")) {
        openAiLookupDialogForRow(tr);
      } else if (t.classList.contains("row-photo")) {
        if (t.getAttribute("data-photo-action") === "remove") {
          deletePhotoFromVoiceEditorRow(tr);
        } else {
          openPhotoPicker({
            kind: tr.getAttribute("data-draft") === "1" ? "draft" : "preview",
            entryId: tr.getAttribute("data-id") || "",
            currentValues: readRowFromTr(tr),
          });
        }
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
    if (isVoiceRegisterEditorRow(tr) && !canSubmitVoiceRegisterEditor(tr)) {
      return Promise.resolve();
    }
    if (!isRowDirty(tr) && isDirtyTrackedDesktopListRow(tr)) {
      return Promise.resolve();
    }
    var vals = readRowFromTr(tr);
    if (draft) {
      return refreshCount().then(function (n) {
        if (n >= Number(state.license.itemLimit)) {
          return showAppAlert(
            "登録上限（" + state.license.itemLimit + "件）に達しています。保存できません。",
            { alignToMeta: true }
          ).then(function () {
            setEntryLimitInlineWarning(
              "登録上限（" + state.license.itemLimit + "件）に達しているため保存できません。"
            );
          });
        }
        var entry = db.buildNewEntry(vals.title, vals.book, vals.page, vals.memo);
        var draftPhoto = state.draft && state.draft.photoPending ? state.draft.photoPending : null;
        if (!draftPhoto) {
          return db.putEntry(state.idb, entry);
        }
        return ensurePhotoLimitAvailable().then(function () {
          var bundle = buildPhotoAssetsForEntry(entry.id, draftPhoto);
          entry = db.patchEntry(entry, {
            photoAttached: true,
            photoId: bundle.photoId,
            photoThumbId: bundle.thumbId,
          });
          return db.putEntryWithPhotoAssets(state.idb, entry, bundle.assets);
        }).catch(function (err) {
          if (err && err.message === "photo_limit_reached") return Promise.reject(err);
          throw err;
        });
      }).then(function (entry) {
          return incrementUnsavedChangeCount().then(function () {
            return incrementRegisterCount();
          }).then(function () {
            toast("保存しました。重要情報がある場合は、重要情報は手動で削除してください。");
            if (state.voiceRegisterMode) {
              return continueManualVoiceRegister();
            }
            return renderTable();
          });
        }).catch(function (err) {
          if (err && err.message === "photo_limit_reached") return;
          throw err;
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
      var changed = hasEntryContentChanged(prev, next) || hasPendingPhotoChange(prev, state.voicePreviewEntry);
      return saveEntryWithPendingPhotoChanges(prev, next, state.voicePreviewEntry).then(function (saved) {
        return (changed ? incrementUnsavedChangeCount() : Promise.resolve()).then(function () {
          updateEntryInSearchSnapshot(saved || next);
          toast("保存しました。重要情報がある場合は、重要情報は手動で削除してください。");
          if (state.voiceRegisterMode) {
            return continueManualVoiceRegister();
          }
          if (isDirtyTrackedDesktopListRow(tr)) {
            syncDesktopListRowAfterSave(tr, saved || next);
            return;
          }
          return renderTable();
        });
      }).catch(function (err) {
        if (err && err.message === "photo_limit_reached") return;
        throw err;
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
        alignToMeta: true,
      }).then(function (ok) {
        if (!ok) return;
        return continueManualVoiceRegister();
      });
    }
    var id = tr.getAttribute("data-id");
    if (!id) return;
    return showAppConfirm("この登録を削除しますか？", {
      detail: detail,
      detailAsChip: true,
      okLabel: "削除する",
      danger: true,
      alignToMeta: true,
    }).then(function (ok) {
      if (!ok) return;
      return db.deleteEntry(state.idb, id).then(function () {
        removeEntryFromSearchSnapshot(id);
        toast("削除しました。");
        if (state.voiceRegisterMode) {
          return continueManualVoiceRegister();
        }
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
    resetVoiceRegisterState();
    state.voiceSearchMsg = "";
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
    var timeoutMs = getSpeechTimeoutMs();
    trace.mark("onVoiceSearch_enter");
    closeSettingsIfOpen();
    trace.mark("closeSettingsIfOpen_done");
    if (!voice.isSpeechSupported()) {
      trace.mark("speech_support_checked", { code: "unsupported" });
      resetVoiceRegisterState();
      state.voiceSearchMsg = "このブラウザでは音声認識を利用できません。手動検索をご利用ください。";
      state.searchQuery = "";
      if ($("#manual-search")) $("#manual-search").value = "";
      return saveSearchQueryToSettings("").then(function () {
        return renderTable({ refreshSearchResults: true });
      });
    }
    trace.mark("speech_support_checked", { code: "supported" });
    warnOfflineVoiceUsage();
    trace.mark("recognizeOnce_call");
    return voice.recognizeOnce({ trace: trace, timeoutMs: timeoutMs }).then(function (text) {
      trace.mark("onVoiceSearch_recognize_resolved", {
        empty: !String(text || "").trim(),
      });
      resetVoiceRegisterState();
      state.voiceSearchMsg = "";
        if (!text.trim()) {
          pushVoiceRecentLog("", null, "無音/タイムアウト", appendVoiceTimingNote(buildSpeechTimeoutMessage(""), trace), {
            kind: "search",
            kindLabel: "音声検索",
            processedLabel: "正規化後",
            processedSummary: "（空欄）",
          });
        state.voiceSearchMsg = buildSpeechTimeoutMessage("手動検索も利用可能です。");
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
            toast(buildSpeechTimeoutMessage(""));
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
    var timeoutMs = getSpeechTimeoutMs();
    trace.mark("onVoiceRegister_enter");
    if (!voice.isSpeechSupported()) {
      trace.mark("speech_support_checked", { code: "unsupported" });
      return enterVoiceRegisterResultMode({
        draft: buildEmptyVoiceRegisterDraft(),
        metaMsg: "このブラウザでは音声認識を利用できません。手動での登録をご利用ください。",
      }).then(function () {
        return refreshCount().then(function () {
          trace.mark("unsupported_register_rendered");
        });
      });
    }
    trace.mark("speech_support_checked", { code: "supported" });
    warnOfflineVoiceUsage();
    var displayedCount = readDisplayedEntryCount();
    trace.mark("displayed_count_checked", { count: displayedCount });
    if (
      displayedCount != null &&
      displayedCount >= Number(state.license.itemLimit)
    ) {
      trace.mark("register_limit_reached");
      resetVoiceRegisterState();
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
    return voice.recognizeOnce({ trace: trace, timeoutMs: timeoutMs }).then(function (text) {
      trace.mark("onVoiceRegister_recognize_resolved", {
        empty: !String(text || "").trim(),
      });

      if (!text.trim()) {
        pushVoiceRecentLog("", null, "無音/タイムアウト", appendVoiceTimingNote(buildSpeechTimeoutMessage(""), trace));
        return enterManualRegisterMode(buildSpeechTimeoutMessage("手動で登録ができます。"));
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
            editorMode: "voice_success",
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
      return enterManualRegisterMode(buildSpeechTimeoutMessage("手動で登録ができます。"));
    });
  }

  function onManualRegister() {
    var displayedCount = readDisplayedEntryCount();
    if (
      displayedCount != null &&
      displayedCount >= Number(state.license.itemLimit)
    ) {
      resetVoiceRegisterState();
      state.searchQuery = "";
      if ($("#manual-search")) $("#manual-search").value = "";
      setEntryLimitInlineWarning(
        "登録上限（" + state.license.itemLimit + "件）です。プラン変更で件数増加をご検討ください"
      );
      return saveSearchQueryToSettings("").then(function () {
        return renderTable();
      });
    }
    return enterManualRegisterMode("手動で登録ができます。");
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
          toast("認証ありがとうございます。パンセノートの準備が整いました。");
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

  function readFileAsText(file, encoding) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(String(fr.result || ""));
      };
      fr.onerror = function () {
        reject(fr.error);
      };
      fr.readAsText(file, encoding || "utf-8");
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result);
      };
      fr.onerror = function () {
        reject(fr.error);
      };
      fr.readAsArrayBuffer(file);
    });
  }

  function importBackupPayload(data, fileLabel, photoResolver, options) {
    if (!data || data.app !== C.APP_ID || !Array.isArray(data.items)) {
      return showAppAlert("バックアップファイルの形式が正しくありません。");
    }
    var replaceExisting = !options || options.replaceExisting !== false;
    return db.getLicense(state.idb).then(function (lic) {
      var items = data.items;
      var effectiveLicense = state.license || lic || {};
      var limit = Number(effectiveLicense.itemLimit);
      if (isNaN(limit) || limit < 0) limit = C.DEFAULT_ITEM_LIMIT;
      return Promise.all([
        replaceExisting ? Promise.resolve(0) : db.countEntries(state.idb),
        replaceExisting ? Promise.resolve(0) : db.countPhotoAttachments(state.idb),
      ]).then(function (counts) {
        var existingEntryCount = Number(counts[0] || 0);
        var existingPhotoCount = Number(counts[1] || 0);
        if (!isFinite(existingEntryCount) || existingEntryCount < 0) existingEntryCount = 0;
        if (!isFinite(existingPhotoCount) || existingPhotoCount < 0) existingPhotoCount = 0;

        var remainingEntryCapacity = replaceExisting
          ? limit
          : Math.max(0, limit - existingEntryCount);
        var remainingPhotoCapacity = replaceExisting
          ? C.PHOTO_LIMIT
          : Math.max(0, C.PHOTO_LIMIT - existingPhotoCount);
        var truncated = items.length > remainingEntryCapacity;
        var slice = items.slice(0, remainingEntryCapacity);
        var importedCount = slice.length;
        var importedPhotoCount = 0;
        var photoOverflow = false;
        var beforeImport = replaceExisting
          ? db.clearPhotoAssets(state.idb).then(function () {
              return db.clearEntries(state.idb);
            })
          : Promise.resolve();

        return beforeImport.then(function () {
          var chain = Promise.resolve();
          for (var i = 0; i < slice.length; i++) {
            (function (item) {
              chain = chain.then(function () {
                var e = db.buildNewEntry(item.title, item.book, item.page, item.memo || "");
                if (item.createdAt) e.createdAt = String(item.createdAt);
                if (item.updatedAt) e.updatedAt = String(item.updatedAt);
                if (
                  !item.photo ||
                  typeof photoResolver !== "function" ||
                  importedPhotoCount >= remainingPhotoCapacity
                ) {
                  if (item.photo && importedPhotoCount >= remainingPhotoCapacity) {
                    photoOverflow = true;
                  }
                  return db.putEntry(state.idb, e);
                }
                return photoResolver(item.photo).then(function (resolved) {
                  if (!resolved || !resolved.full || !resolved.thumb) {
                    return db.putEntry(state.idb, e);
                  }
                  var bundle = buildPhotoAssetsForEntry(e.id, resolved);
                  e = db.patchEntry(e, {
                    photoAttached: true,
                    photoId: bundle.photoId,
                    photoThumbId: bundle.thumbId,
                  });
                  importedPhotoCount += 1;
                  return db.putEntryWithPhotoAssets(state.idb, e, bundle.assets);
                });
              });
            })(slice[i]);
          }
          return chain.then(function () {
            resetVoiceRegisterState();
            state.searchQuery = ($("#manual-search") && $("#manual-search").value) || "";
            return persistBackupImportInfo(fileLabel).then(function () {
              return saveSearchQueryToSettings(state.searchQuery);
            }).then(function () {
              return renderTable({ refreshSearchResults: true }).then(function () {
                if (truncated && !replaceExisting && importedCount === 0) {
                  toast("登録上限件数に達しているため、追加読み込みは行われませんでした。");
                  return;
                }
                if (truncated) {
                  toast("バックアップファイルの先頭から、登録上限件数まで読み込みました。");
                  return;
                }
                if (photoOverflow) {
                  toast("バックアップファイルを読み込みました。写真は上限2000枚まで復元しました。");
                  return;
                }
                toast("バックアップファイルを読み込みました。");
              });
            });
          });
        });
      });
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

  function runPreparedImport(job, options) {
    if (!job || typeof job.execute !== "function") return Promise.resolve();
    if (state.importBusy || state.exportBusy) return Promise.resolve();
    setDataTransferBusyUi("import", true);
    return job.execute(options)
      .catch(function () {
        return showAppAlert("バックアップファイルの読み込みに失敗しました。");
      })
      .finally(function () {
        setDataTransferBusyUi("import", false);
      });
  }

  function onImportRequest() {
    if (state.importBusy || state.exportBusy) return Promise.resolve();
    return requestImportFile()
      .then(function (file) {
        if (!file) return null;
        return prepareImportJob(file);
      })
      .then(function (job) {
        if (!job) return;
        return db.countEntries(state.idb).then(function (existingCount) {
          return showImportConfirmDialog({
            fileName: job.fileName,
            itemCount: job.itemCount,
            existingCount: existingCount,
          }).then(function (result) {
            if (!result) return;
            return runPreparedImport(job, {
              replaceExisting: result.mode === "replace",
            });
          });
        });
      })
      .finally(function () {
        var input = $("#import-file");
        if (input) input.value = "";
      });
  }

  function refreshAppToLatest() {
    if (state.forceRefreshBusy) return Promise.resolve();
    if (typeof window === "undefined") return Promise.resolve();
    if (!navigator.onLine) {
      return showAppAlert("オンライン時のみ実行できます。");
    }
    if (!("serviceWorker" in navigator) || typeof caches === "undefined") {
      window.location.replace(C.getBasePath() + "?refresh=" + Date.now());
      return Promise.resolve();
    }

    return showAppConfirm(
      "最新版を読み込み直しますか？",
      {
        detail:
          "保存していない変更がある場合は、先にデータ保存を行ってください。キャッシュを更新してから再読み込みします。",
        okLabel: "更新する",
        cancelLabel: "キャンセル",
        alignToMeta: true,
      }
    ).then(function (ok) {
      if (!ok) return;
      state.forceRefreshBusy = true;
      toast("最新版を確認しています...");

      var scope = (C && typeof C.getBasePath === "function")
        ? C.getBasePath()
        : "/";
      var reloaded = false;
      function reloadOnce() {
        if (reloaded) return;
        reloaded = true;
        window.location.replace(scope + "?refresh=" + Date.now());
      }

      var controllerChangeHandler = function () {
        reloadOnce();
      };
      navigator.serviceWorker.addEventListener("controllerchange", controllerChangeHandler, { once: true });

      function cleanupControllerListener() {
        try {
          navigator.serviceWorker.removeEventListener("controllerchange", controllerChangeHandler);
        } catch (e) {}
      }

      return navigator.serviceWorker.getRegistration(scope)
        .then(function (reg) {
          if (!reg) return null;
          return reg.update().catch(function () {
            return reg;
          }).then(function () {
            return navigator.serviceWorker.getRegistration(scope).catch(function () {
              return reg;
            });
          });
        })
        .then(function (reg) {
          return caches.keys().then(function (keys) {
            return Promise.all(
              keys.map(function (key) {
                if (String(key).indexOf("panseenote-") !== 0) return Promise.resolve();
                return caches.delete(key);
              })
            ).then(function () {
              return reg;
            });
          });
        })
        .then(function (reg) {
          if (reg && reg.waiting) {
            reg.waiting.postMessage("skip-waiting");
            window.setTimeout(reloadOnce, 1500);
            return;
          }
          if (reg && reg.installing) {
            reg.installing.addEventListener("statechange", function () {
              if (reg.waiting) {
                reg.waiting.postMessage("skip-waiting");
              }
            });
            window.setTimeout(reloadOnce, 1800);
            return;
          }
          reloadOnce();
        })
        .catch(function (err) {
          cleanupControllerListener();
          console.error("Force refresh failed:", err);
          state.forceRefreshBusy = false;
          return showAppAlert(
            "最新版の読み込み直しに失敗しました。通信状況をご確認ください。",
            { alignToMeta: true }
          );
        });
    });
  }

  if (typeof window !== "undefined") {
    window.PANSEE_forceRefreshApp = refreshAppToLatest;
  }

  function init() {
    window.addEventListener("popstate", function () {
      handleMobileBackNavigation();
    });
    window.addEventListener("offline", function () {
      toast(
        "オフラインです。検索・登録は継続できますが、初回ライセンス認証と音声認識は利用できない場合があります。"
      );
    });
    window.addEventListener("online", function () {
      toast("オンラインに戻りました。");
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
      if (isManualRegisterPreferred()) {
        onManualRegister();
        return;
      }
      onVoiceRegister();
    });
    $("#btn-license-activate").addEventListener("click", function () {
      onActivateLicense();
    });
    if ($("#btn-force-refresh")) {
      bindPress($("#btn-force-refresh"), function () {
        refreshAppToLatest();
      });
    }
    if ($("#setting-prefer-manual-register")) {
      $("#setting-prefer-manual-register").addEventListener("change", function () {
        persistSettingsPatch({
          preferManualRegister: !!this.checked,
        }).catch(function (err) {
          console.warn("Manual register setting update failed:", err);
        });
      });
    }
    if ($("#setting-speech-timeout")) {
      $("#setting-speech-timeout").addEventListener("change", function () {
        persistSettingsPatch({
          speechTimeoutMs: normalizeSpeechTimeoutMs(this.value),
        }).catch(function (err) {
          console.warn("Speech timeout setting update failed:", err);
        });
      });
    }
    if ($("#photo-file")) {
      $("#photo-file").addEventListener("change", function () {
        var file = this.files && this.files[0] ? this.files[0] : null;
        onPhotoFileSelected(file);
        this.value = "";
      });
    }
    if ($("#photo-viewer-close")) {
      $("#photo-viewer-close").addEventListener("click", function () {
        closePhotoViewer();
      });
    }
    if ($("#photo-viewer-overlay")) {
      $("#photo-viewer-overlay").addEventListener("click", function (ev) {
        if (ev.target === $("#photo-viewer-overlay")) {
          closePhotoViewer();
        }
      });
    }
    if ($("#mobile-edit-photo-slot")) {
      $("#mobile-edit-photo-slot").addEventListener("click", function (ev) {
        var target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        var btn = target.closest("button.photo-thumb-button");
        if (!btn) return;
        openPhotoViewerFromSources(
          btn.getAttribute("data-photo-full-src") || "",
          btn.getAttribute("data-photo-full-id") || ""
        );
      });
    }
    var mobileEditOverlay = $("#mobile-edit-sheet-overlay");
    if (mobileEditOverlay) {
      mobileEditOverlay.addEventListener("click", function (ev) {
        if (ev.target === mobileEditOverlay) {
          closeMobileEditSheet();
        }
      });
    }
    if ($("#mobile-edit-close")) {
      bindPress($("#mobile-edit-close"), function () {
        closeMobileEditSheet();
      });
    }
    if ($("#mobile-edit-ai")) {
      bindPress($("#mobile-edit-ai"), function () {
        openAiLookupDialogForMobileEditSheet();
      });
    }
    if ($("#mobile-edit-save")) {
      bindPress($("#mobile-edit-save"), function () {
        saveMobileEditSheet();
      });
    }
    if ($("#mobile-edit-delete")) {
      bindPress($("#mobile-edit-delete"), function () {
        deleteMobileEditSheet();
      });
    }
    fillAiLookupCategoryOptions();
    updateAiLookupTemplateOptions();
    var aiLookupOverlay = $("#ai-lookup-overlay");
    if (aiLookupOverlay) {
      aiLookupOverlay.addEventListener("click", function (ev) {
        if (ev.target === aiLookupOverlay) {
          closeAiLookupDialog();
        }
      });
    }
    if ($("#ai-lookup-category")) {
      $("#ai-lookup-category").addEventListener("change", function () {
        updateAiLookupTemplateOptions();
      });
    }
    if ($("#ai-lookup-close")) {
      bindPress($("#ai-lookup-close"), function () {
        closeAiLookupDialog();
      });
    }
    if ($("#ai-lookup-search")) {
      bindPress($("#ai-lookup-search"), function () {
        openAiLookupSearch();
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
      if (state.voiceRegisterMode) {
        return;
      }
      updatePlanSummaryLine();
      updateFloatingUiTop();
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
      var narrowMq = window.matchMedia("(max-width: " + String(MOBILE_LAYOUT_MAX_WIDTH) + "px)");
      if (narrowMq.addEventListener) {
        narrowMq.addEventListener("change", onViewportLayoutChange);
      } else if (narrowMq.addListener) {
        narrowMq.addListener(onViewportLayoutChange);
      }
      // スマホ寄り幅変化でコンパクト表示切替
      var phoneMq = window.matchMedia("(max-width: " + String(MOBILE_LAYOUT_MAX_WIDTH) + "px)");
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
        updateFloatingUiTop();
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
        initInternalSettingsAccordion();
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
      setAccordionExpanded(
        toggleBtn,
        body,
        "直近音声認識ログ（確認用）",
        body.hasAttribute("hidden"),
        renderVoiceRecentLogs
      );
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        saveVoiceRecentLogs([]);
        renderVoiceRecentLogs();
      });
    }

    renderVoiceRecentLogs();
  }

  function initInternalSettingsAccordion() {
    var toggleBtn = $("#internal-settings-toggle-btn");
    var body = $("#internal-settings-body");
    if (!toggleBtn || !body) return;
    toggleBtn.addEventListener("click", function () {
      setAccordionExpanded(
        toggleBtn,
        body,
        "内部情報・診断",
        body.hasAttribute("hidden")
      );
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
