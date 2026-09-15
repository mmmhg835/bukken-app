// 新デザイン版専用。従来版のキャッシュには触れない。
const VERSION = 'preview-v2';
const CACHE = `bukken-app-${VERSION}`;
const SHELL = [
  './', './index.html', './preview.css', './preview-shell.js',
  '../app.css',
  '../js/main.js', '../js/views.js', '../js/store.js', '../js/github.js',
  '../js/util.js', '../js/idb.js', '../js/image.js', '../js/pairing.js',
  '../js/ui.js', '../js/gallery.js', '../js/loan.js', '../js/map.js', '../js/migrate.js',
  '../js/price.js', '../js/chart.js', '../js/sales.js', '../js/spec.js', '../js/theme.js',
  '../js/analysis.js', '../js/analytics-view.js', '../js/lifeplan.js', '../js/lifeplan-view.js',
];

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
    .then((keys) => Promise.all(keys
      .filter((k) => k.startsWith('bukken-app-preview-') && k !== CACHE)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
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
