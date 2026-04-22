/**
 * パンセノート — 写真取り込み・圧縮・サムネイル生成
 */
(function (global) {
  "use strict";

  var C = global.PANSEE_CONFIG;

  function loadImageElementFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(blob);
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("image_load_failed"));
      };
      img.src = url;
    });
  }

  function fitSize(width, height, maxEdge) {
    var w = Number(width) || 0;
    var h = Number(height) || 0;
    if (!w || !h) return { width: 1, height: 1 };
    var edge = Number(maxEdge) || Math.max(w, h);
    if (Math.max(w, h) <= edge) {
      return { width: w, height: h };
    }
    var scale = edge / Math.max(w, h);
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    };
  }

  function renderBlobFromImage(img, maxEdge, quality) {
    var size = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxEdge);
    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error("image_encode_failed"));
            return;
          }
          resolve({
            blob: blob,
            mimeType: C.PHOTO_MIME_TYPE,
            width: size.width,
            height: size.height,
            sizeBytes: blob.size,
          });
        },
        C.PHOTO_MIME_TYPE,
        quality
      );
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(String(fr.result || ""));
      };
      fr.onerror = function () {
        reject(fr.error || new Error("blob_read_failed"));
      };
      fr.readAsDataURL(blob);
    });
  }

  function processPhotoFile(file) {
    return loadImageElementFromBlob(file).then(function (img) {
      return Promise.all([
        renderBlobFromImage(img, C.PHOTO_FULL_MAX_EDGE, C.PHOTO_FULL_QUALITY),
        renderBlobFromImage(img, C.PHOTO_THUMB_MAX_EDGE, C.PHOTO_THUMB_QUALITY),
      ]).then(function (pair) {
        return Promise.all([
          blobToDataUrl(pair[0].blob),
          blobToDataUrl(pair[1].blob),
        ]).then(function (urls) {
          return {
            full: pair[0],
            thumb: pair[1],
            fullDataUrl: urls[0],
            thumbDataUrl: urls[1],
          };
        });
      });
    });
  }

  global.PANSEE_image = {
    processPhotoFile: processPhotoFile,
    blobToDataUrl: blobToDataUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
