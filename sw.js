const CACHE = 'record-v11';
const ASSETS = [
  './',
  './index.html',
  './i18n.js',
  './manifest.json',
  './icon.svg',
  './og-image.jpg',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (response && response.ok && request.method === 'GET') {
    const clone = response.clone();
    caches.open(CACHE).then(c => c.put(request, clone)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Exchange-rate fetches: always prefer fresh data online, fall back to cache offline.
  if (url.hostname.includes('currency-api') || url.hostname.includes('frankfurter') || url.hostname.includes('cloudflare')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // App shell / navigations: NETWORK-FIRST. The entire app lives inside index.html,
  // so a cache-first shell would strand users on a stale build (including stale
  // security fixes) until two reloads. Online → fetch fresh + update cache;
  // offline → fall back to the cached shell.
  // i18n.js ships in lockstep with the shell (a fresh build may use new keys), so keep it
  // network-first too — otherwise a cached dictionary could lag the updated index.html.
  const isShell = e.request.mode === 'navigate' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/i18n.js');
  if (isShell) {
    e.respondWith(
      fetch(e.request)
        .then(res => putInCache(e.request, res))
        .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Other static assets (icons, manifest, CDN Chart.js): cache-first + background refresh.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request)
        .then(res => putInCache(e.request, res))
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
