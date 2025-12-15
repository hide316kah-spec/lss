// ランプシャッター SW（CACHE_NAMEを変えると強制更新）
const CACHE_NAME = 'lamp-shutter-v6-20251215';
const URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './mode_day.png',
  './mode_night.png',
  './mode_inspect.png',
  './camera.png',
  './ok.mp3'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(URLS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
