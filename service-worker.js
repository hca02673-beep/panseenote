/* global self, caches, clients, fetch */

"use strict";

var SW_VERSION = "panseenote-v1";
var SW_CACHE_PREFIX = "panseenote-";
var SW_FILE_NAME = "service-worker.js";
var scopeUrl = new URL(self.location.href);
var scopePath = scopeUrl.pathname.replace(new RegExp(SW_FILE_NAME + "$"), "");
var PRECACHE_URLS = [
  scopePath,
  scopePath + "index.html",
  scopePath + "offline.html",
  scopePath + "manifest.webmanifest",
  scopePath + "css/app.css",
  scopePath + "js/config.js",
  scopePath + "js/license.js",
  scopePath + "js/usage.js",
  scopePath + "js/normalize.js",
  scopePath + "js/db.js",
  scopePath + "js/image.js",
  scopePath + "js/voice.js",
  scopePath + "js/app.js",
  scopePath + "img/logo.svg",
  scopePath + "img/icons/apple-touch-icon.png",
  scopePath + "img/icons/icon-192.png",
  scopePath + "img/icons/icon-512.png",
  scopePath + "img/icons/icon-maskable-512.png",
  scopePath + "vendor/jszip.min.js"
];

function isInScope(url) {
  return url.origin === self.location.origin && url.pathname.indexOf(scopePath) === 0;
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

function isAppShellAssetRequest(url) {
  var path = url.pathname;
  if (path === scopePath || path === scopePath + "index.html" || path === scopePath + "offline.html") {
    return true;
  }
  if (path === scopePath + SW_FILE_NAME) return false;
  return /\.(?:css|js|html|webmanifest|svg|png)$/i.test(path);
}

function cacheResponse(cacheKey, response) {
  if (!response || response.status !== 200 || response.type !== "basic") {
    return response;
  }
  var responseClone = response.clone();
  return caches.open(SW_VERSION).then(function (cache) {
    return cache.put(cacheKey, responseClone);
  }).then(function () {
    return response;
  }).catch(function () {
    return response;
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SW_VERSION).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key === SW_VERSION) return Promise.resolve();
          if (key.indexOf(SW_CACHE_PREFIX) !== 0) return Promise.resolve();
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var requestUrl = new URL(request.url);
  if (!isInScope(requestUrl)) return;

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).then(function (response) {
        return cacheResponse(scopePath, response.clone()).then(function () {
          return cacheResponse(scopePath + "index.html", response);
        });
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match(scopePath) || caches.match(scopePath + "offline.html");
        });
      })
    );
    return;
  }

  if (isAppShellAssetRequest(requestUrl)) {
    event.respondWith(
      fetch(request).then(function (response) {
        return cacheResponse(request, response);
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          if (request.destination === "document") {
            return caches.match(scopePath + "offline.html");
          }
          return Promise.reject(new Error("offline_asset_unavailable"));
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        return cacheResponse(request, response);
      });
    }).catch(function () {
      if (request.destination === "document") {
        return caches.match(scopePath + "offline.html");
      }
      return Promise.reject(new Error("offline_asset_unavailable"));
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data === "skip-waiting") {
    self.skipWaiting();
  }
});
