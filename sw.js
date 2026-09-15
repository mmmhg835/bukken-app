// アプリ本体だけをキャッシュする軽量 Service Worker。
// 物件データと画像は IndexedDB 側でキャッシュしているのでここでは扱わない。
const CACHE = 'bukken-app-v3';
const SHELL = [
  './', './index.html', './app.css',
  './js/main.js', './js/views.js', './js/store.js', './js/github.js',
  './js/util.js', './js/idb.js', './js/image.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API 通信には触らない
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
