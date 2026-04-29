// max-v56 — Round CU: thread the brief's personal preferences (party,
// pace, accommodation, dietary/safety avoidances, hardlimits) into the
// picker activity prompt, narrative + what-to-do prompts, and restaurant
// suggestion prompts. So "vegetarian," "no hostels," "traveling with
// elderly parents" actually shape what gets recommended at each step,
// not just the final candidate search.
const CACHE = 'max-v56';
const CORE = ['/', '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first: try the network, update the cache on success, fall back
  // to cache only if the network is unavailable.
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
