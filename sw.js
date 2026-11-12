// HQ service worker: network-first so updates show up right away,
// with a cached copy so the app still opens offline.
const CACHE = 'hq-v11';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/store.js', 'js/api.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // 'no-cache' makes the browser re-check each file with the server, so a new version is never hidden by its HTTP cache.
  const fresh = req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' });
  e.respondWith(
    fresh
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
