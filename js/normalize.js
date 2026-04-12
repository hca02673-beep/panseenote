/**
 * 検索用正規化（仕様 8.3）
 */
(function (global) {
  "use strict";

  /** 半角カタカナ → 全角カタカナ（主要範囲） */
  var HW_KATA = "｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ";
  var FW_KATA =
    "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜";
  var SEARCH_SEPARATOR_RE = /[\s\u3000・･/／\\＼\-_＿.．,，、]+/g;
  var KANJI_NUMBER_TOKEN_RE = /[零〇一二三四五六七八九十百]+/g;
  var KANJI_DIGIT_MAP = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
  };

  function halfKatakanaToFull(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      var idx = HW_KATA.indexOf(c);
      out += idx >= 0 ? FW_KATA[idx] : c;
    }
    return out;
  }

  function parseKanjiDigitSequence(token) {
    var digits = "";
    for (var i = 0; i < token.length; i++) {
      var d = KANJI_DIGIT_MAP[token.charAt(i)];
      if (d == null) return "";
      digits += String(d);
    }
    if (!digits) return "";
    return String(parseInt(digits, 10));
  }

  function parseKanjiUnitNumber(token) {
    var m = token.match(/^(?:([一二三四五六七八九])?百)?(?:([一二三四五六七八九])?十)?([零〇一二三四五六七八九])?$/);
    if (!m) return "";
    if (!m[0]) return "";
    if (m[1] == null && m[2] == null && m[3] == null) return "";

    var total = 0;
    if (token.indexOf("百") >= 0) {
      total += (m[1] == null ? 1 : KANJI_DIGIT_MAP[m[1]]) * 100;
    }
    if (token.indexOf("十") >= 0) {
      total += (m[2] == null ? 1 : KANJI_DIGIT_MAP[m[2]]) * 10;
    }
    if (m[3] != null) {
      total += KANJI_DIGIT_MAP[m[3]];
    }
    return total <= 999 ? String(total) : "";
  }

  function replaceKanjiNumbers(s) {
    return s.replace(KANJI_NUMBER_TOKEN_RE, function (token) {
      var n = token.indexOf("十") >= 0 || token.indexOf("百") >= 0
        ? parseKanjiUnitNumber(token)
        : parseKanjiDigitSequence(token);
      return n !== "" ? n : token;
    });
  }

  /**
   * @param {string} raw
   * @returns {string}
   */
  function normalizeForSearch(raw) {
    if (raw == null) return "";
    var s = String(raw);
    // Unicode 正規化で幅などを揃えたうえで、仕様どおり補正
    s = s.normalize("NFKC");
    s = halfKatakanaToFull(s);
    s = replaceKanjiNumbers(s);
    // ひらがな → カタカナ（U+3041〜U+3096）
    s = s.replace(/[\u3041-\u3096]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) + 0x60);
    });
    // 英字は大文字・半角相当に（NFKC 後の ASCII）
    s = s.replace(/[a-z]/g, function (ch) {
      return ch.toUpperCase();
    });
    s = s.trim();
    // 区切り文字の有無に左右されずヒットさせる
    s = s.replace(SEARCH_SEPARATOR_RE, "");
    return s;
  }

  global.PANSEE_normalizeForSearch = normalizeForSearch;
})(typeof window !== "undefined" ? window : globalThis);
