// v353.1: real service worker. Replaces the stub from earlier in
// v353. Goals:
//   1. Offline read access. User in Lisbon with no signal can still
//      open Max and read their trip — trips already live in
//      localStorage (MaxDB), this just keeps the app shell loadable.
//   2. Faster repeat loads. App shell served from cache.
//   3. Robust upgrade flow. When a deploy lands, the new SW takes
//      over and posts a message to clients prompting reload —
//      avoiding the classic "stuck on stale code" trap.
//
// Strategy
// --------
//   - Precache the app shell on install (index.html + JS + CSS).
//   - Cache-first for static assets (the ?v=<stamp> query string is
//     part of the cache key, so cache-first never serves stale code
//     after a deploy: the new index.html requests new ?v= URLs
//     which aren't cached, so they fetch from network).
//   - Network-first for navigation requests (HTML), so a fresh
//     deploy is picked up the next page load.
//   - On activate: delete old caches, claim clients, post 'reload'
//     message so any open tabs prompt the user to refresh.
//
// Note on the version constant
// ----------------------------
// The CACHE name below is bumped per-deploy by deploy.sh — same
// substitution that updates ?v=DEV in index.html. Keeps cache
// scoping aligned with the asset versions the page actually
// requests.

const CACHE = 'max-sw-DEV';
const CORE = [
  '/',
  '/index.html',
];
// Static assets are cached lazily as they're requested (since their
// URLs include ?v=<stamp>, hardcoding them here would be brittle).

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(CORE); })
      // Activate immediately; the activate handler will claim
      // clients and tell them to reload.
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        // Delete any cache that isn't the current version. Catches
        // both old max-v* (from when the SW was a phantom and never
        // ran) and old max-sw-* from previous deploys.
        return Promise.all(
          keys
            .filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
      .then(function () {
        // Tell every open client a new version is in control. The
        // page-side listener (in index.html) shows a non-blocking
        // "new version available" toast.
        return self.clients.matchAll({ type: 'window' }).then(function (clients) {
          clients.forEach(function (c) {
            try { c.postMessage({ type: 'sw-updated', version: CACHE }); } catch (_) {}
          });
        });
      })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  // Only handle GETs. POST/PUT/DELETE go through to the network.
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // Skip the API host — we never want to cache trip bodies, LLM
  // responses, or magic-link redirects.
  if (url.hostname === 'api.travelingwithmax.app') return;

  // Skip cross-origin requests we don't own (Leaflet tiles, fonts,
  // CDN libs). The browser's HTTP cache handles those fine.
  if (url.origin !== self.location.origin) return;

  // Navigation requests (HTML) — network-first so deploys propagate.
  // If the network is down, fall back to whatever HTML is cached so
  // the user can still see the app shell offline.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      // PD.443: no-store so a deploy ALWAYS wins. Plain network-first
      // still let Cloudflare's edge / the HTTP cache hand back a stale
      // index.html for a window after deploy — which is exactly why
      // "I deployed but don't see it" kept happening. Bypass both;
      // fall back to the cached shell only when the network is down.
      fetch(req, { cache: 'no-store' })
        .then(function (resp) {
          // Stash a copy in cache for offline next time. Only if 200.
          if (resp && resp.status === 200) {
            var copy = resp.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return resp;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // DEV (localhost): NETWORK-FIRST for same-origin assets. In dev the asset
  // URLs carry a constant ?v=DEV stamp (deploy.sh only bumps it in prod), so
  // cache-first below would serve a stale discovery-model.js / index script
  // forever even though the file on disk changed — the "my edits don't show
  // up, do I need a new trip?" trap. Network-first fetches the current file
  // every time and only falls back to cache when the dev server is down.
  var _devHost = (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1');
  if (_devHost) {
    event.respondWith(
      // no-store so the browser's own HTTP disk cache can't hand back a stale
      // ?v=DEV asset either (same reason the navigation handler uses no-store).
      fetch(req, { cache: 'no-store' }).then(function (resp) {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // Static assets (JS, CSS, images) — cache-first in PROD. The ?v=<stamp>
  // query string makes cache invalidation automatic: a new deploy
  // changes the URL → URL not in cache → network fetch → cached
  // for next time. Old URLs eventually age out via the activate
  // step above (which deletes old caches wholesale per version).
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});

// Allow the page to ask "skip waiting" if the user opts to reload
// immediately when the toast appears.
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'skip-waiting') {
    self.skipWaiting();
  }
});
