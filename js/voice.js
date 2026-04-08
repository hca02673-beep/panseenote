/**
 * Web Speech API + 終了ビープ + 音声登録用パース（仕様 7, 11）
 */
(function (global) {
  "use strict";

  var C = global.PANSEE_CONFIG;

  function getSpeechRecognitionCtor() {
    return (
      global.SpeechRecognition ||
      global.webkitSpeechRecognition ||
      null
    );
  }

  function isSpeechSupported() {
    return !!getSpeechRecognitionCtor();
  }

  /**
   * 音声認識フェーズ終了の合図（成功失敗に依存しない）
   */
  function playEndBeep() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      var t0 = ctx.currentTime;
      osc.start(t0);
      osc.stop(t0 + 0.12);
      window.setTimeout(function () {
        try {
          ctx.close();
        } catch (e) {}
      }, 400);
    } catch (e) {
      /* ビープ不可環境は無視 */
    }
  }

  /**
   * @returns {Promise<string>} 認識テキスト（空の場合あり）
   */
  function recognizeOnce() {
    var Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      return Promise.resolve("");
    }
    return new Promise(function (resolve) {
      var rec = new Ctor();
      rec.lang = C.SPEECH_LANG;
      rec.continuous = false;
      rec.interimResults = false;
      var settled = false;
      var timer = global.setTimeout(function () {
        if (settled) return;
        settled = true;
        try {
          rec.stop();
        } catch (e) {}
        resolve("");
      }, C.SPEECH_TIMEOUT_MS);

      function finish(text) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        resolve(text || "");
      }

      var bestText = "";

      rec.onerror = function () {
        finish(bestText);
      };
      rec.onresult = function (ev) {
        if (!ev.results || !ev.results.length) return;
        var last = ev.results[ev.results.length - 1];
        if (!last || !last[0]) return;
        bestText = last[0].transcript || "";
      };
      rec.onend = function () {
        finish(bestText);
      };

      try {
        rec.start();
      } catch (e) {
        finish("");
      }
    }).then(function (text) {
      playEndBeep();
      return text;
    });
  }

  function normalizeSpeechText(text) {
    return String(text == null ? "" : text)
      .normalize("NFKC")
      .replace(/\u3000/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toHiragana(text) {
    return String(text || "").replace(/[ァ-ヶ]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
  }

  function buildNumberTokenMap() {
    var map = Object.create(null);
    var unitReadings = {
      0: ["ぜろ", "れい"],
      1: ["いち", "いっ"],
      2: ["に"],
      3: ["さん"],
      4: ["よん", "し"],
      5: ["ご"],
      6: ["ろく", "ろっ"],
      7: ["なな", "しち"],
      8: ["はち", "はっ"],
      9: ["きゅう", "きゅ", "く"],
    };
    var kanjiDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

    function addToken(token, value) {
      var key = normalizeSpeechText(token).replace(/\s+/g, "");
      if (key) map[key] = String(value);
    }

    function buildKanjiNumber(n) {
      if (n < 10) return kanjiDigits[n];
      if (n === 10) return "十";
      var tens = Math.floor(n / 10);
      var ones = n % 10;
      var head = tens === 1 ? "十" : kanjiDigits[tens] + "十";
      return head + (ones ? kanjiDigits[ones] : "");
    }

    for (var n = 0; n <= 99; n++) {
      addToken(String(n), n);
      addToken(buildKanjiNumber(n), n);
      addToken(String(n).replace(/\d/g, function (d) {
        return String.fromCharCode(d.charCodeAt(0) + 0xFEE0);
      }), n);

      if (n < 10) {
        unitReadings[n].forEach(function (reading) {
          addToken(reading, n);
        });
        continue;
      }

      var tens = Math.floor(n / 10);
      var ones = n % 10;
      var tensReadings = tens === 1
        ? ["じゅう", "じゅっ"]
        : unitReadings[tens].map(function (reading) {
            return reading + "じゅう";
          }).concat(unitReadings[tens].map(function (reading) {
            return reading + "じゅっ";
          }));

      if (ones === 0) {
        tensReadings.forEach(function (reading) {
          addToken(reading, n);
        });
        continue;
      }

      tensReadings.forEach(function (tReading) {
        unitReadings[ones].forEach(function (oReading) {
          // 「にじゅっ」系は 20 / 30 / ... のみで使う。21 以上は標準読みを優先する。
          if (/じゅっ$/.test(tReading)) return;
          addToken(tReading + oReading, n);
        });
      });
    }

    return map;
  }

  var NUMBER_TOKEN_MAP = buildNumberTokenMap();

  function parseLooseNumber(token) {
    var normalized = normalizeSpeechText(token).replace(/\s+/g, "");
    if (!normalized) return "";

    if (/^\d{1,2}$/.test(normalized)) {
      return String(parseInt(normalized, 10));
    }

    var hira = toHiragana(normalized);
    var softened = hira
      .replace(/ゔ/g, "ぶ")
      .replace(/ぺいじ/g, "")
      .replace(/ぺーじ/g, "")
      .replace(/ページ/g, "")
      .replace(/冊目/g, "")
      .replace(/冊の/g, "")
      .replace(/さつめ/g, "")
      .replace(/さつの/g, "");

    if (NUMBER_TOKEN_MAP[softened] != null) {
      return NUMBER_TOKEN_MAP[softened];
    }
    if (NUMBER_TOKEN_MAP[normalized] != null) {
      return NUMBER_TOKEN_MAP[normalized];
    }

    return "";
  }

  /**
   * 仕様形式A: （数字）冊目（数字）ページ（見出し）
   * それ以外は title に生の認識結果を入れて ok:false を返す。
   * @param {string} transcript
   * @returns {{ ok: boolean, book: string, page: string, title: string, isMemo: boolean }}
   */
  function parseRegisterTranscript(transcript) {
    var raw = normalizeSpeechText(transcript);
    if (!raw) {
      return { ok: false, book: "", page: "", title: "", isMemo: false };
    }
    // 形式A: 「○冊目○ページ名前」
    // 旧版で効いていた「冊の」「さつめ」「ぺいじ」等の揺れも受ける。
    var re =
      /^(.+?)\s*(?:冊目|冊の|さつめ|さつの)\s*(?:の)?\s*(.+?)\s*(?:ページ|頁|ぺーじ|ぺいじ|ぺえじ)\s*(.*)$/;
    var m = raw.match(re);
    if (!m) {
      return { ok: false, book: "", page: "", title: raw, isMemo: false };
    }
    var book = parseLooseNumber(m[1]);
    var page = parseLooseNumber(m[2]);
    var title = (m[3] || "").trim();
    if (!book || !page || !title) {
      return { ok: false, book: "", page: "", title: raw, isMemo: false };
    }
    return { ok: true, book: book, page: page, title: title, isMemo: false };
  }

  global.PANSEE_voice = {
    isSpeechSupported: isSpeechSupported,
    recognizeOnce: recognizeOnce,
    parseRegisterTranscript: parseRegisterTranscript,
    playEndBeep: playEndBeep,
  };
})(typeof window !== "undefined" ? window : globalThis);
