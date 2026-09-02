// =============================================
// sw.js - PWA Service Worker (app shell only)
//
// Makes the portal installable on phones and lets the shell open offline.
// Everything is fetched from the network first so browser and installed-app
// users always run the deployed version; the cache is only a fallback when
// the device is offline. Authenticated data is NEVER cached: /api/* and
// anything Supabase go straight to the network because they carry session
// tokens and must never be served stale.
// =============================================

const CACHE_VERSION = 'coe-pwa-v6.0';

// Relative paths resolve against the service worker scope
const APP_SHELL = [
  './',
  './index.html',
  './officer.html',
  './manifest.json',
  './styles/main.css',
  './styles/officer.css',
  './styles/ai.css',
  './js/config.js',
  './js/api.js',
  './js/ui.js',
  './js/auth.js',
  './js/app.js',
  './js/dashboard.js',
  './js/events.js',
  './js/transactions.js',
  './js/reports.js',
  './js/income.js',
  './js/units.js',
  './js/receipt-capture.js',
  './js/dropdown.js',
  './js/admin.js',
  './js/ai-assistant.js',
  './js/profile.js',
  './js/notifications.js',
  './js/officer/officer-app.js',
  './assets/coe-logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // allSettled: one missing optional asset must not break the install
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Authenticated API traffic: network only, no cache, no fallback
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  if (url.hostname.includes('supabase')) return;

  // Page navigations: network first so updates ship immediately,
  // cached shell when the device is offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req, { ignoreSearch: true }))
          || (await cache.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  // Everything else (assets, CDN scripts, fonts): network first —
  // users always get the deployed version, cached copy only when offline
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_VERSION);
      if (fresh.ok || fresh.type === 'opaque') cache.put(req, fresh.clone());
      return fresh;
    } catch {
      const cache = await caches.open(CACHE_VERSION);
      return (await cache.match(req)) || Response.error();
    }
  })());
});
