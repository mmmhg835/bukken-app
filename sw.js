// アプリ本体だけをキャッシュする軽量 Service Worker。
// 物件データと画像は IndexedDB 側でキャッシュしているのでここでは扱わない。
const VERSION = 'v122';
const CACHE = `bukken-app-${VERSION}`;
const SHELL = [
  './', './index.html', './app.css', './skin-v2.css',
  './js/main.js', './js/views.js', './js/store.js', './js/github.js',
  './js/util.js', './js/idb.js', './js/image.js', './js/pairing.js',
  './js/ui.js', './js/gallery.js', './js/loan.js', './js/map.js', './js/migrate.js',
  './js/price.js', './js/market.js', './js/market-view.js', './js/units.js', './js/unit-filter.js', './js/sale.js', './js/sale-view.js', './js/chart.js', './js/sales.js', './js/spec.js', './js/theme.js', './js/skin.js', './js/analysis.js', './js/lifeplan.js', './js/lifeplan-view.js', './js/viewing-view.js',
  './manifest.webmanifest',
];

/** GitHub Pages は max-age=600 を返すため、常にサーバーへ問い合わせて更新を取りこぼさない */
const fresh = (url) => new Request(url, { cache: 'no-cache', credentials: 'same-origin' });

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(fresh(new URL(u, self.registration.scope).href)))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => notify({ type: 'activated', version: VERSION })));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API 通信には触らない

  // ネットワーク優先。取れたものをキャッシュへ入れ、オフライン時だけキャッシュを返す
  e.respondWith((async () => {
    try {
      const res = await fetch(fresh(e.request.url));
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      const hit = await caches.match(e.request);
      return hit || caches.match('./index.html');
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'version') notify({ type: 'version', version: VERSION });
});

async function notify(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
}
