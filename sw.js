// v353: sw.js retired.
//
// This file used to be a long ledger of release notes plus a Service
// Worker scaffold (CACHE constant, install/activate/fetch listeners
// to addAll() core assets). The scaffold was never actually
// registered — there's no navigator.serviceWorker.register('sw.js')
// call anywhere in production code. So every "cache version" bump
// I (and prior contributors) made was symbolic; it never invalidated
// anything for any user. The real cache layer was always the
// browser's HTTP cache, keyed off ?v= query strings on the script
// tags.
//
// Keeping the old file would just mislead the next person to read it.
// So this file is now a stub. If any code in the wild ever tries to
// register it as a service worker, the empty install/activate will
// no-op safely and immediately deactivate. The release-note history
// has been removed; git log is the place for that.
//
// If we ever want a real service worker (offline support, background
// sync), build it fresh with: a registration call in index.html, an
// installed-version check, a controlled message channel for prompting
// the user to reload after upgrade. That's a deliberate decision, not
// something that should creep in via this stub.

self.addEventListener('install', function () {
  // Activate immediately; nothing to cache.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // Best effort: clean up any stale max-v* caches from earlier
  // attempts that did get registered somehow. No-op if there are none.
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return /^max-v/.test(k); })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Pass-through fetch — never cache, never intercept. The HTTP cache
// + ?v= query strings on script tags handle versioning instead.
self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});
