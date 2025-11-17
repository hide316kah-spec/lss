// ------------------------------------------------------
// LampShutter Service Worker (安全版・キャッシュ腐敗防止)
// ------------------------------------------------------

const CACHE_NAME = "lampshutter-v1";

// 事前キャッシュする最低限のファイル
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./mode_day.png",
  "./mode_night.png",
  "./mode_inspect.png",
  "./camera.png"
];

// インストール
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// fetch（必ず最新取得優先）
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => response)            // 常にネット優先
      .catch(() => caches.match(event.request)) // オフライン時キャッシュ
  );
});
