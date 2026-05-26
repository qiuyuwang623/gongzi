const CACHE_NAME = 'salary-calc-v4';
const STATIC_ASSETS = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Install: pre-cache static assets (not HTML, which changes often)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for HTML, cache-first for static, network-first for API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHTML = event.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '';

  // API calls: network-first, fallback to cache
  if (url.hostname === 'timor.tech') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // HTML: network-first (always get latest), fallback to cache for offline
  if (isHTML) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
    )
  );
});

function networkFirst(request) {
  return fetch(request)
    .then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      return response;
    })
    .catch(() => caches.match(request));
}
