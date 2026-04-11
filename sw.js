const CACHE='max-v3';
const CORE=['/','/manifest.json','/icon-192.svg','/icon-512.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;var url=new URL(e.request.url);if(url.origin!==self.location.origin)return;e.respondWith(caches.open(CACHE).then(cache=>cache.match(e.request).then(cached=>{var net=fetch(e.request).then(r=>{if(r.ok)cache.put(e.request,r.clone());return r;});return cached||net;})));});
