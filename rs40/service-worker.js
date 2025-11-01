// ==============================
// Service Worker for PWA (ランプシャッター判定用)
// ==============================

const CACHE_NAME = "lamp-shutter-v3";
const urlsToCache = [
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./assets/img_camera.png",
  "./assets/img_worker.png",
  "./assets/voice_ok.mp3",
  "./assets/voice_ng.mp3"
];

// インストール時：キャッシュ登録
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// 有効化時：古いキャッシュ削除
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
});

// fetch：キャッシュ優先でレスポンス
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
