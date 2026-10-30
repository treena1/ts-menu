// Ts Menu service worker: the app shell loads instantly and offline. Data comes from
// localStorage (see js/store.js); this only caches files, fonts, and recipe photos.
// Bump VERSION whenever any shell file changes so phones pick up the new copy.
const VERSION = 'ts-menu-v1';
const SHELL = [
  './', 'index.html', 'manifest.json', 'css/app.css',
  'js/core.js', 'js/app.js', 'js/api.js', 'js/config.js', 'js/store.js', 'js/ui.js',
  'js/views/home.js', 'js/views/recipes.js', 'js/views/detail.js', 'js/views/edit.js',
  'js/views/grocery.js', 'js/views/pantry.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const RUNTIME = VERSION + '-runtime';
const MAX_RUNTIME = 120;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k)),
  )).then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_RUNTIME; i++) await cache.delete(keys[i]);
}

// Serve from cache, refresh in the background.
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: cacheName === VERSION });
  const net = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
      if (cacheName === RUNTIME) trim(cache);
    }
    return res;
  }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/api')) return; // local dev API
    e.respondWith(staleWhileRevalidate(req, VERSION));
    return;
  }
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isPhoto = req.destination === 'image';
  if (isFont || isPhoto) e.respondWith(staleWhileRevalidate(req, RUNTIME));
  // Everything else (the Apps Script API) goes straight to the network.
});
