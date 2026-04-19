/**
 * 利用状況モニタリング API 呼び出し
 */
(function (global) {
  "use strict";

  function clipText(text, max) {
    var s = String(text == null ? "" : text);
    if (s.length <= max) return s;
    return s.slice(0, max) + "...";
  }

  function buildApiError(kind, message, extra) {
    var err = new Error(message || "API request failed");
    err.name = "UsageApiError";
    err.kind = kind || "unknown";
    if (extra && typeof extra === "object") {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) {
          err[k] = extra[k];
        }
      }
    }
    return err;
  }

  function postUsagePing(url, payload) {
    var timeoutMs = 15000;
    var ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var tid = null;
    if (ctrl) {
      tid = global.setTimeout(function () {
        ctrl.abort();
      }, timeoutMs);
    }

    var params = [];
    payload = payload || {};
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) {
        params.push(
          encodeURIComponent(k) + "=" + encodeURIComponent(String(payload[k] == null ? "" : payload[k]))
        );
      }
    }
    var getUrl = url + (url.indexOf("?") >= 0 ? "&" : "?") + params.join("&");

    return fetch(getUrl, {
      method: "GET",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        return res.text().then(function (raw) {
          if (!res.ok) {
            throw buildApiError(
              "http",
              "HTTP " + res.status + " " + (res.statusText || ""),
              {
                status: res.status,
                statusText: res.statusText || "",
                responseText: clipText(raw, 400),
              }
            );
          }
          var data;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (e) {
            throw buildApiError("invalid_json", "JSON parse error", {
              responseText: clipText(raw, 400),
            });
          }
          return data;
        });
      })
      .catch(function (e) {
        if (e && e.name === "AbortError") {
          throw buildApiError("timeout", "Request timeout", { timeoutMs: timeoutMs });
        }
        if (e && e.name === "UsageApiError") throw e;
        throw buildApiError("network", (e && e.message) || "Network error");
      })
      .finally(function () {
        if (tid) global.clearTimeout(tid);
      });
  }

  global.PANSEE_usage = {
    postUsagePing: postUsagePing,
  };
})(typeof window !== "undefined" ? window : globalThis);
