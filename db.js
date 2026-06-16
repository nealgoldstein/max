// @ts-check
// db.js — Max trip database (Round HA: Phase 0 of the engine/UI split)
//
// Single source of truth for trip persistence. Both the picker engine
// and the trip engine call this API; UI calls it for the home-screen
// trip list. No layer reaches past this surface into localStorage or
// IndexedDB directly.
//
// Today this wraps the existing primitives — no behavior change.
// Tomorrow the same API is backed by Supabase. The engines never know.
//
// Phase 0 deliberately ships ONLY the seam. No inline-script callsite
// has been migrated yet; index.html still uses its existing functions.
// Phases 1-3 migrate callsites and introduce engine modules.
//
// ── Stored shapes ───────────────────────────────────────────
//
// Trip envelope (per trip; key = "max-trip-{id}"):
//   {
//     trip            : <full trip object>,
//     activeDest      : string | null,
//     destCtr, sidCtr, bkCtr : counters used to mint new ids,
//     activeDmSection : optional UI-state hint
//   }
// (Counters live on the envelope because they're session-counter
// state, not trip data proper.)
//
// Trips index (key = "max-trips-index"):
//   [{ id, name, dateRange, destCount, savedAt,
//      startDate, endDate, entryDetails, exitDetails,
//      entryCity, exitCity }]
//
// Picker draft (key = "max-draft-{tripId|new}"): reserved for future
// picker-state persistence. Today _tb is in-memory only; the API
// is stubbed so engine code can adopt it later without churn.
//
// LLM cache (IDB; key = "max-llm-cache-v1"): mirrored in memory.
// Synchronous reads from the mirror; writes fire-and-forget to IDB.
//
// Geocode cache (key = "max-coarse-geocode"): localStorage,
// synchronous in both directions.
//
// ── Events ────────────────────────────────────────────────
//   'tripWritten'   { id, envelope } — fired after a successful trip
//                                       write. envelope is the parsed
//                                       object that was just persisted
//                                       (Round HS — preserves dest
//                                       object identity for in-process
//                                       subscribers; cross-tab/storage
//                                       subscribers must re-read).
//   'tripDeleted'   { id }   — fired after a successful trip delete
//   'indexChanged'  null     — fired after the trips index changes
//   'draftWritten'  { tripId } — picker draft written
//
// Subscribers register via MaxDB.on(event, cb) and unsubscribe via
// MaxDB.off(event, cb) or the function returned by .on(...).

(function (global) {
  'use strict';

  // ── Detect iframe / disabled persistence ────────────────────
  // Persistence is suppressed inside iframes (preview frames,
  // embedded views) — matches existing _inIframe check.
  var inIframe = (typeof window !== 'undefined') && (window !== window.top);
  var canPersist = !inIframe && (typeof localStorage !== 'undefined');

  // ── Storage keys ────────────────────────────────────────────
  var KEY_TRIP_PREFIX  = 'max-trip-';
  var KEY_TRIPS_INDEX  = 'max-trips-index';
  var KEY_GEOCODE      = 'max-coarse-geocode';
  var KEY_LLM_CACHE    = 'max-llm-cache-v1';
  var KEY_DRAFT_PREFIX = 'max-draft-';
  var KEY_API_KEY      = 'max-api-key';
  var KEY_MAP_STYLE    = 'max-map-style';
  var KEY_HIDE_INTRO   = 'max-hide-trip-intro';

  // ── IDB primitives (LLM cache lives here) ───────────────────
  var IDB_NAME  = 'max-llm-cache';
  var IDB_STORE = 'kv';

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IDB')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        try { req.result.createObjectStore(IDB_STORE); } catch (_) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx  = db.transaction(IDB_STORE, 'readonly');
          var req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror   = function () { reject(req.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror    = function () { reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function idbDelete(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete(key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror    = function () { reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  // ── Event bus (cross-engine signal) ─────────────────────────
  var listeners = Object.create(null);

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
    return function unsubscribe() { off(event, cb); };
  }

  function off(event, cb) {
    if (!listeners[event]) return;
    var i = listeners[event].indexOf(cb);
    if (i >= 0) listeners[event].splice(i, 1);
  }

  function emit(event, payload) {
    var arr = listeners[event];
    if (!arr) return;
    arr.slice().forEach(function (cb) {
      try { cb(payload); }
      catch (e) { console.warn('[MaxDB] listener for', event, 'threw:', e); }
    });
  }

  // ── Trip persistence ────────────────────────────────────────

  // v359.43: in-memory mirror of trips that live in IDB (not
  // localStorage). Populated by hydrateTripIdbMirror() on init.
  // tripRead/tripReadRaw consult this when localStorage misses.
  // tripWrite updates it on every write so reads stay consistent
  // even before the async IDB write completes.
  var _tripIdbMirror = {};       // id → envelope (parsed)
  var _tripIdbMirrorRaw = {};    // id → JSON string
  var _tripIdbReady = false;     // set true after first hydration completes

  function _writeTripToIdb(id, jsonStr) {
    // Fire-and-forget write to IDB. Updates the mirror synchronously
    // so subsequent reads see the new value even if IDB lags.
    _tripIdbMirrorRaw[id] = jsonStr;
    try { _tripIdbMirror[id] = JSON.parse(jsonStr); } catch (_) {}
    return idbSet(KEY_TRIP_PREFIX + id, jsonStr).catch(function (err) {
      console.warn('[MaxDB] trip IDB write failed for', id, err);
    });
  }

  function tripWrite(id, envelope) {
    if (!canPersist || !id) return false;
    var jsonStr;
    try { jsonStr = JSON.stringify(envelope); }
    catch (e) { console.warn('[MaxDB] tripWrite stringify failed:', e); return false; }

    // v359.43.1: if this trip is already known to live in IDB (from a
    // prior quota failure), skip the localStorage attempt. Saves a
    // doomed setItem() + repeated warning logs on every sync poll.
    if (_tripIdbMirrorRaw[id]) {
      _writeTripToIdb(id, jsonStr);
      emit('tripWritten', { id: id, envelope: envelope });
      return true;
    }

    // Try localStorage first (sync, fast).
    try {
      localStorage.setItem(KEY_TRIP_PREFIX + id, jsonStr);
      emit('tripWritten', { id: id, envelope: envelope });
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || (e.code && e.code === 22))) {
        // v359.42 Phase 2: evict low-priority caches and retry.
        var evicted = _evictLowPriorityKeys();
        if (evicted > 0) {
          try {
            localStorage.setItem(KEY_TRIP_PREFIX + id, jsonStr);
            emit('tripWritten', { id: id, envelope: envelope });
            return true;
          } catch (e2) { /* still over quota — fall through to IDB */ }
        }
        // v359.43 Phase 3: localStorage is full. Fall through to IDB.
        _writeTripToIdb(id, jsonStr);
        // One-time log: only when this trip wasn't already in IDB.
        // After v359.43.1 the mirror check above short-circuits this
        // path on subsequent writes, so each trip logs at most once.
        console.warn('[MaxDB] localStorage full — trip', id, 'now in IDB');
        emit('tripWritten', { id: id, envelope: envelope });
        return true;
      }
      console.warn('[MaxDB] tripWrite failed:', e);
      return false;
    }
  }

  // v359.60.97: opts.silent=true persists without emitting tripWritten.
  // Used by localSave to avoid the engine subscriber re-parsing the
  // envelope and re-assigning global.trip — which would break any
  // code holding refs into the existing trip object (DOM closures,
  // hero-map markers, popup links). Local edits already mutated
  // global.trip in place and emitted tripChange via _emitTripMutation,
  // so the UI is fresh; firing tripWritten would just churn refs.
  // External writers (sync pulls, picker handoffs) deliberately want
  // the event because their job IS to install a new envelope, so
  // they keep the default (silent=false).
  function tripWriteRaw(id, json, opts) {
    if (!canPersist || !id) return false;
    var silent = !!(opts && opts.silent);

    // PD.333 (audit A2): ONE id, ONE key — asserted at the choke
    // point. Every "trip saved but invisible / duplicated / reloaded
    // wrong" bug reduces to the storage key disagreeing with the id
    // INSIDE the envelope (publishTrip's id:null rebuild, fresh-build
    // divergence). Heal a missing body id from the key; flag a
    // conflicting one loudly — the write still happens (refusing
    // would lose data) but the console now names the seam instead of
    // the downstream symptom.
    try {
      var _chk = JSON.parse(json);
      if (_chk && _chk.trip) {
        if (!_chk.trip.id) {
          _chk.trip.id = id;
          json = JSON.stringify(_chk);
          console.warn("[MaxDB] tripWriteRaw: envelope had no trip.id — healed to storage key '" + id + "'");
        } else if (_chk.trip.id !== id) {
          console.error("[MaxDB] ID/KEY MISMATCH: writing slot '" + id +
            "' but envelope.trip.id is '" + _chk.trip.id +
            "'. This WILL surface as a lost or duplicated trip. Stack:", new Error().stack);
        }
      }
    } catch (_) { /* non-JSON payloads pass through untouched */ }

    // v359.43.1: short-circuit for trips already in IDB.
    if (_tripIdbMirrorRaw[id]) {
      _writeTripToIdb(id, json);
      var envEarly = null;
      try { envEarly = JSON.parse(json); } catch (_) {}
      if (!silent) emit('tripWritten', { id: id, envelope: envEarly });
      return true;
    }

    try {
      localStorage.setItem(KEY_TRIP_PREFIX + id, json);
      var envelope = null;
      try { envelope = JSON.parse(json); } catch (_) {}
      if (!silent) emit('tripWritten', { id: id, envelope: envelope });
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || (e.code && e.code === 22))) {
        var evicted = _evictLowPriorityKeys();
        if (evicted > 0) {
          try {
            localStorage.setItem(KEY_TRIP_PREFIX + id, json);
            var env2 = null;
            try { env2 = JSON.parse(json); } catch (_) {}
            if (!silent) emit('tripWritten', { id: id, envelope: env2 });
            return true;
          } catch (e2) { /* fall through */ }
        }
        _writeTripToIdb(id, json);
        var env3 = null;
        try { env3 = JSON.parse(json); } catch (_) {}
        console.warn('[MaxDB] localStorage full — trip', id, 'now in IDB (raw)');
        if (!silent) emit('tripWritten', { id: id, envelope: env3 });
        return true;
      }
      console.warn('[MaxDB] tripWriteRaw failed:', e);
      return false;
    }
  }

  // v359.45 Phase 1 — HARD CUT: no on-read migration. New code writes
  // the new shape (PlanItems with type:dayTrip); legacy trips that
  // never get re-built lose their day-trip chips. Acceptable per
  // Neal's "no need to preserve existing trips." Keeps tripRead
  // simple and predictable: just return whatever's stored.
  function tripRead(id) {
    if (!canPersist || !id) return null;
    try {
      var raw = localStorage.getItem(KEY_TRIP_PREFIX + id);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('[MaxDB] tripRead failed for', id, e);
    }
    if (_tripIdbMirror[id]) return _tripIdbMirror[id];
    return null;
  }

  function tripReadRaw(id) {
    if (!canPersist || !id) return null;
    try {
      var raw = localStorage.getItem(KEY_TRIP_PREFIX + id);
      if (raw) return raw;
    } catch (_) {}
    return _tripIdbMirrorRaw[id] || null;
  }

  function tripDelete(id) {
    if (!canPersist || !id) return false;
    try { localStorage.removeItem(KEY_TRIP_PREFIX + id); } catch (_) {}
    // v359.43: also remove from IDB mirror + storage. Fire-and-forget.
    delete _tripIdbMirror[id];
    delete _tripIdbMirrorRaw[id];
    idbDelete(KEY_TRIP_PREFIX + id).catch(function () {});
    emit('tripDeleted', { id: id });
    return true;
  }

  // PD.250: union of trip IDs known across localStorage AND the IDB
  // mirror. Callers (cleanupOrphanedTrips) use this to detect trips
  // that exist ONLY in IDB — the resurrection vector before PD.250
  // routed deletes through tripDelete. Without this, raw
  // localStorage.removeItem deletes left the IDB copy behind, and the
  // next hydrateTripIdbMirror() resurrected them.
  function tripListIds() {
    var ids = {};
    if (canPersist) {
      try {
        for (var k in localStorage) {
          if (k && k.indexOf(KEY_TRIP_PREFIX) === 0) {
            ids[k.substring(KEY_TRIP_PREFIX.length)] = true;
          }
        }
      } catch (_) {}
    }
    Object.keys(_tripIdbMirrorRaw || {}).forEach(function (id) { ids[id] = true; });
    return Object.keys(ids);
  }

  // PD.250: cache the hydration promise so callers can await it
  // (orphan sweeps need the IDB mirror to be populated before they
  // run, or they'll miss IDB-only trips).
  var _hydrationPromise = null;
  function tripHydrated() {
    return _hydrationPromise || Promise.resolve();
  }

  // v359.43: hydrate the in-memory trip mirror from IDB on init.
  // Walks all IDB keys, picks the ones with the trip prefix, and
  // populates _tripIdbMirror so tripRead can find IDB-only trips
  // synchronously. Async; tripRead before this finishes will miss
  // IDB-only trips (extremely rare — only matters right after
  // localStorage quota was hit on a write).
  function hydrateTripIdbMirror() {
    if (!canPersist || typeof indexedDB === 'undefined') return Promise.resolve();
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readonly');
          var store = tx.objectStore(IDB_STORE);
          var req = store.openCursor();
          var loaded = 0;
          req.onsuccess = function (e) {
            var cursor = e.target.result;
            if (!cursor) {
              _tripIdbReady = true;
              if (loaded > 0) console.log('[MaxDB] hydrated', loaded, 'trip(s) from IDB');
              resolve();
              return;
            }
            var k = cursor.key;
            if (typeof k === 'string' && k.indexOf(KEY_TRIP_PREFIX) === 0) {
              var id = k.substring(KEY_TRIP_PREFIX.length);
              var val = cursor.value;
              try {
                if (typeof val === 'string') {
                  _tripIdbMirrorRaw[id] = val;
                  _tripIdbMirror[id] = JSON.parse(val);
                } else if (val) {
                  _tripIdbMirror[id] = val;
                  _tripIdbMirrorRaw[id] = JSON.stringify(val);
                }
                loaded++;
              } catch (_) {}
            }
            cursor.continue();
          };
          req.onerror = function () { _tripIdbReady = true; resolve(); };
        } catch (e) { _tripIdbReady = true; resolve(); }
      });
    }).catch(function () { _tripIdbReady = true; });
  }

  // ── Trips index ─────────────────────────────────────────────

  function indexLoad() {
    if (!canPersist) return [];
    try {
      var s = localStorage.getItem(KEY_TRIPS_INDEX);
      return s ? JSON.parse(s) : [];
    } catch (e) {
      return [];
    }
  }

  function indexSave(arr) {
    if (!canPersist) return false;
    try {
      localStorage.setItem(KEY_TRIPS_INDEX, JSON.stringify(arr));
      emit('indexChanged', null);
      return true;
    } catch (e) {
      console.warn('[MaxDB] indexSave failed:', e);
      return false;
    }
  }

  function indexEntry(id) {
    var arr = indexLoad();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) return arr[i];
    }
    return null;
  }

  function indexUpsert(entry) {
    if (!canPersist || !entry || !entry.id) return false;
    var arr = indexLoad();
    var found = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === entry.id) { arr[i] = entry; found = true; break; }
    }
    if (!found) arr.push(entry);
    return indexSave(arr);
  }

  function indexRemove(id) {
    if (!canPersist || !id) return false;
    var arr = indexLoad().filter(function (t) { return t && t.id !== id; });
    return indexSave(arr);
  }

  // ── Orphan cleanup ──────────────────────────────────────────
  // Walk all max-trip-* keys; drop any whose id isn't in the index,
  // plus any "empty shell" trips (no destinations and no candidates)
  // that aren't the currently-active trip. Round CL.4 logic, moved
  // into the DB layer where it belongs.

  function cleanupOrphaned(activeId) {
    if (!canPersist) return { removed: 0, reclaimed: 0 };
    try {
      var arr = indexLoad();
      var indexedIds = {};
      arr.forEach(function (t) { if (t && t.id) indexedIds[t.id] = true; });

      var toDelete = [];
      var emptyShells = 0;
      var totalReclaimed = 0;

      for (var k in localStorage) {
        if (k.indexOf(KEY_TRIP_PREFIX) !== 0) continue;
        var id = k.substring(KEY_TRIP_PREFIX.length);
        if (id === activeId) continue;
        var isOrphan = !indexedIds[id];
        var isEmpty  = false;
        if (!isOrphan) {
          try {
            var parsed = JSON.parse(localStorage.getItem(k));
            var t = parsed && parsed.trip;
            // PD.73: a trip is "empty shell" only if it has no
            // destinations, no candidates, AND no placeActivities.
            // placeActivities is set by the first LLM call (must-dos)
            // before candidates arrive — leaving it out of this check
            // would wipe trips caught mid-flow.
            if (t && (!t.destinations || t.destinations.length === 0)
                  && (!t.candidates   || t.candidates.length === 0)
                  && (!t.placeActivities || t.placeActivities.length === 0)) {
              isEmpty = true;
              emptyShells++;
            }
          } catch (_) { isOrphan = true; }
        }
        if (isOrphan || isEmpty) {
          var sz = (localStorage.getItem(k) || '').length;
          toDelete.push({ key: k, id: id, size: sz });
          totalReclaimed += sz;
        }
      }

      toDelete.forEach(function (d) {
        localStorage.removeItem(d.key);
        arr = arr.filter(function (t) { return t.id !== d.id; });
      });

      if (toDelete.length) {
        indexSave(arr);
        console.log('[MaxDB] cleanup removed', toDelete.length, 'trip(s)',
                    '(' + (toDelete.length - emptyShells) + ' orphans,',
                    emptyShells + ' empty),',
                    'freed', (totalReclaimed / 1024).toFixed(0) + 'KB');
      }
      return { removed: toDelete.length, reclaimed: totalReclaimed };
    } catch (e) {
      console.warn('[MaxDB] cleanup failed:', e);
      return { removed: 0, reclaimed: 0 };
    }
  }

  // ── Picker draft (Phase 0 stub) ─────────────────────────────

  function draftRead(tripId) {
    if (!canPersist) return null;
    var key = KEY_DRAFT_PREFIX + (tripId || 'new');
    try {
      var s = localStorage.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  function draftWrite(tripId, draft) {
    if (!canPersist) return false;
    var key = KEY_DRAFT_PREFIX + (tripId || 'new');
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      emit('draftWritten', { tripId: tripId });
      return true;
    } catch (e) {
      console.warn('[MaxDB] draftWrite failed:', e);
      return false;
    }
  }

  function draftDelete(tripId) {
    if (!canPersist) return false;
    var key = KEY_DRAFT_PREFIX + (tripId || 'new');
    try { localStorage.removeItem(key); return true; }
    catch (e) { return false; }
  }

  // ── LLM cache (sync read, async write to IDB) ──────────────
  // Mirrors the existing _maxCacheMem behavior. Reads are
  // synchronous from the in-memory mirror; writes mutate the
  // mirror immediately and persist to IDB fire-and-forget.

  var llmCacheMem = null;

  var llmReady = (async function () {
    if (!canPersist) { llmCacheMem = {}; return; }
    try {
      var fromIdb = await idbGet(KEY_LLM_CACHE);
      if (fromIdb && typeof fromIdb === 'object') {
        llmCacheMem = fromIdb;
        return;
      }
    } catch (_) { /* fall through */ }
    // Round CL.3 migration path: pull from localStorage if a stale
    // copy exists there and push it into IDB once.
    try {
      var raw = localStorage.getItem(KEY_LLM_CACHE);
      if (raw) {
        llmCacheMem = JSON.parse(raw);
        localStorage.removeItem(KEY_LLM_CACHE);
        idbSet(KEY_LLM_CACHE, llmCacheMem).catch(function () {});
        console.log('[MaxDB] LLM cache migrated localStorage → IDB:',
                    Object.keys(llmCacheMem || {}).length, 'entries');
        return;
      }
    } catch (_) {}
    llmCacheMem = {};
  })();

  function llmCacheGet(key) {
    if (!llmCacheMem) llmCacheMem = {};
    return llmCacheMem[key] || null;
  }

  function llmCacheSet(key, value) {
    if (!llmCacheMem) llmCacheMem = {};
    llmCacheMem[key] = value;
    if (!canPersist) return;
    idbSet(KEY_LLM_CACHE, llmCacheMem).catch(function (e) {
      console.warn('[MaxDB] LLM cache IDB save failed:', e);
    });
  }

  function llmCacheAll() { return llmCacheMem || {}; }

  function llmCacheReplace(obj) {
    llmCacheMem = obj || {};
    if (!canPersist) return;
    idbSet(KEY_LLM_CACHE, llmCacheMem).catch(function () {});
  }

  function llmCacheClear() {
    llmCacheMem = {};
    if (!canPersist) return;
    try { localStorage.removeItem(KEY_LLM_CACHE); } catch (_) {}
    idbDelete(KEY_LLM_CACHE).catch(function (e) {
      console.warn('[MaxDB] LLM cache clear failed:', e);
    });
  }

  // ── Wiki cache (v359.42: IDB-backed) ──────────────────────
  // Per-place Wikipedia summary cache used by the picker thumbnails
  // and lightbox. Previously lived in localStorage with prefix
  // "max-wiki:v3:" which contributed to quota pressure once a user
  // accumulated many trips. Moved to IDB (same kv store as the LLM
  // cache; namespaced via key prefix) so localStorage has room for
  // trip envelopes.
  //
  // 7-day TTL applied on read; expired entries surface as misses.
  // wikiCacheMigrate() runs once on module init — copies any
  // existing localStorage entries to IDB then deletes them.
  // v359.46: bumped to v4 so the non-place detector reruns on
  // already-cached entries (Blue Lagoon → 1980 movie, etc.) and
  // they get re-fetched as the actual geographic article.
  var KEY_WIKI_PREFIX = 'max-wiki:v4:';
  var WIKI_TTL_MS = 7 * 24 * 3600 * 1000;
  var KEY_WIKI_MIGRATED = 'max-wiki-migrated-to-idb';

  function wikiCacheGet(key) {
    if (!key) return Promise.resolve(null);
    return idbGet(KEY_WIKI_PREFIX + key).then(function (entry) {
      if (!entry || !entry.ts) return null;
      if (Date.now() - entry.ts > WIKI_TTL_MS) return null;
      return entry.data;
    }).catch(function () { return null; });
  }

  function wikiCacheSet(key, data) {
    if (!key) return Promise.resolve();
    return idbSet(KEY_WIKI_PREFIX + key, { ts: Date.now(), data: data })
      .catch(function () {});
  }

  function wikiCacheMigrate() {
    if (!canPersist) return Promise.resolve();
    try {
      if (localStorage.getItem(KEY_WIKI_MIGRATED) === '1') return Promise.resolve();
    } catch (_) {}
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('max-wiki:') === 0) keys.push(k);
      }
    } catch (_) {}
    if (!keys.length) {
      try { localStorage.setItem(KEY_WIKI_MIGRATED, '1'); } catch (_) {}
      return Promise.resolve();
    }
    var moves = keys.map(function (k) {
      var raw;
      try { raw = localStorage.getItem(k); } catch (_) { raw = null; }
      var entry = null;
      try { entry = raw ? JSON.parse(raw) : null; } catch (_) {}
      // Strip any "max-wiki:vN:" prefix to get the bare cache key
      var bareKey = k.replace(/^max-wiki:v?\d*:/, '');
      if (!entry) {
        try { localStorage.removeItem(k); } catch (_) {}
        return Promise.resolve();
      }
      return idbSet(KEY_WIKI_PREFIX + bareKey, entry)
        .then(function () { try { localStorage.removeItem(k); } catch (_) {} })
        .catch(function () {});
    });
    return Promise.all(moves).then(function () {
      try { localStorage.setItem(KEY_WIKI_MIGRATED, '1'); } catch (_) {}
      console.log('[MaxDB] migrated', keys.length, 'wiki cache entries to IDB');
    });
  }

  // v359.42: low-priority eviction helper. Called when a trip write
  // hits QuotaExceededError. Clears localStorage keys that are pure
  // performance caches (and may not have been migrated yet) so the
  // trip write retry has room. Trip data is never touched here.
  function _evictLowPriorityKeys() {
    if (!canPersist) return 0;
    var removed = 0;
    try {
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        // Wiki cache (pre-migration) — safe to drop, regenerates on demand
        if (k.indexOf('max-wiki:') === 0) toRemove.push(k);
      }
      toRemove.forEach(function (k) {
        try { localStorage.removeItem(k); removed++; } catch (_) {}
      });
    } catch (_) {}
    if (removed) console.warn('[MaxDB] evicted', removed, 'low-priority keys on quota error');
    return removed;
  }

  // ── Geocode cache (sync, localStorage-backed) ──────────────

  var geocodeMem = null;

  function geocodeLoad() {
    if (geocodeMem) return geocodeMem;
    if (!canPersist) { geocodeMem = {}; return geocodeMem; }
    try {
      var raw = localStorage.getItem(KEY_GEOCODE);
      geocodeMem = raw ? JSON.parse(raw) : {};
    } catch (_) { geocodeMem = {}; }
    return geocodeMem;
  }

  function geocodeGet(name) {
    var c = geocodeLoad();
    return c[name] || null;
  }

  function geocodeSet(name, coords) {
    var c = geocodeLoad();
    c[name] = coords;
    if (!canPersist) return;
    try { localStorage.setItem(KEY_GEOCODE, JSON.stringify(c)); } catch (_) {}
  }

  function geocodeAll() { return geocodeLoad(); }

  function geocodeReplace(obj) {
    geocodeMem = obj || {};
    if (!canPersist) return;
    try { localStorage.setItem(KEY_GEOCODE, JSON.stringify(geocodeMem)); } catch (_) {}
  }

  function geocodeFlush() {
    if (!canPersist || !geocodeMem) return;
    try { localStorage.setItem(KEY_GEOCODE, JSON.stringify(geocodeMem)); } catch (_) {}
  }

  // ── City-data cache (Round HU) ──────────────────────────────
  // Per-place pickPlace data: cityCenter coords, suggestions list,
  // restaurant suggestions, hotel info, etc. The inline-script
  // generateCityData(place,destId) writes here on success and reads
  // back to early-return on cache hit. Cross-trip — Geneva is Geneva
  // whether the user is planning Switzerland today or France next
  // month — and intentionally non-persistent: we want a fresh fetch
  // on a fresh page load so the user sees current LLM output.
  //
  // The map is exposed directly via cityDataMap() so legacy callers
  // (`_generatedCityData[key]`) keep working with no behavior change.
  // The structured API (get/set/has/delete/clear) is the new path.
  // Both touch the same underlying object — adopting the new API
  // doesn't require migrating consumers.

  var cityDataMem = {};

  function cityDataMap()        { return cityDataMem; }
  function cityDataGet(key)     { return cityDataMem[key] || null; }
  function cityDataSet(key, v)  { cityDataMem[key] = v; }
  function cityDataHas(key)     { return Object.prototype.hasOwnProperty.call(cityDataMem, key); }
  function cityDataDelete(key)  { delete cityDataMem[key]; }
  function cityDataClear()      { cityDataMem = {}; }

  // ── Settings (key-value localStorage) ───────────────────────
  // Lightweight prefs that aren't trip data — API key, map style,
  // hide-intro flag. Engines mostly don't need these; UI does.

  function settingGet(key) {
    if (!canPersist) return null;
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function settingSet(key, value) {
    if (!canPersist) return false;
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
      return true;
    } catch (_) { return false; }
  }

  function settingRemove(key) {
    if (!canPersist) return false;
    try { localStorage.removeItem(key); return true; }
    catch (_) { return false; }
  }

  // ── Storage stats helper (diagnostics) ──────────────────────

  function storageStats() {
    if (!canPersist) return null;
    var trips = 0, tripCount = 0, indexBytes = 0, otherBytes = 0;
    for (var k in localStorage) {
      var sz = (localStorage.getItem(k) || '').length;
      if (k.indexOf(KEY_TRIP_PREFIX) === 0) { trips += sz; tripCount++; }
      else if (k === KEY_TRIPS_INDEX) indexBytes = sz;
      else otherBytes += sz;
    }
    return {
      trips: tripCount,
      tripBytes: trips,
      indexBytes: indexBytes,
      otherBytes: otherBytes,
      totalBytes: trips + indexBytes + otherBytes
    };
  }

  // ── User preferences ─────────────────────────────────────────
  // v353.2: single JSON blob holds all user-level preferences
  // (paceHours and anything that comes later — defaultTripDuration,
  // preferredCurrency, language, etc.). Single seam so future prefs
  // don't each invent their own localStorage key.
  //
  // v353.3 (Path B): server is the source of truth. localStorage is
  // an offline cache. MaxSync drives the network: on sign-in it calls
  // prefs.replace(obj, 'remote') to hydrate from /user/prefs; on every
  // local set() this layer emits 'prefsChanged' with source='local',
  // and MaxSync write-through-PATCHes the server. We do NOT call the
  // network from db.js — db.js has no tokens, no base URL, and we
  // want it usable in tests without a server.
  //
  // Migration: on first read, if any legacy standalone preference
  // keys exist (max-default-pace-hours), fold them into the blob
  // and remove the standalone. Idempotent — runs once per page
  // load via a memo flag.
  var KEY_PREFS = 'max-prefs';
  var _prefsCache = null;
  var _prefsMigrated = false;

  function _prefsLoad() {
    if (_prefsCache) return _prefsCache;
    var obj = {};
    try {
      var raw = localStorage.getItem(KEY_PREFS);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') obj = parsed;
      }
    } catch (_) {}
    if (!_prefsMigrated) {
      _prefsMigrated = true;
      // Legacy migration: fold standalone keys into the blob.
      try {
        var legacyPace = localStorage.getItem('max-default-pace-hours');
        if (legacyPace != null) {
          var n = parseInt(legacyPace, 10);
          if (isFinite(n) && obj.paceHours == null) obj.paceHours = n;
          // Remove the legacy key so we don't double-store.
          localStorage.removeItem('max-default-pace-hours');
          // Persist immediately so the migration sticks even if the
          // app crashes before the next set().
          try { localStorage.setItem(KEY_PREFS, JSON.stringify(obj)); } catch (_) {}
        }
      } catch (_) {}
    }
    _prefsCache = obj;
    return obj;
  }
  function _prefsPersist(obj) {
    try { localStorage.setItem(KEY_PREFS, JSON.stringify(obj)); }
    catch (e) { console.warn('[MaxDB] prefs save failed:', e); }
  }
  function prefsGet(key, defaultValue) {
    var o = _prefsLoad();
    if (key == null) return o; // dump everything when called with no key
    return (key in o) ? o[key] : defaultValue;
  }
  // prefsSet — write one key. Default source='local' fires the
  // 'prefsChanged' event with source='local' so MaxSync pushes to
  // server. Pass source='remote' from inside the sync layer when
  // we're applying a value we just fetched (no echo back to server).
  function prefsSet(key, value, source) {
    var o = _prefsLoad();
    var prev = o[key];
    if (value === undefined) delete o[key];
    else o[key] = value;
    _prefsPersist(o);
    _prefsCache = o;
    // Skip emit if nothing actually changed — avoids needless server
    // pushes when UI re-saves the same value (e.g., welcome modal
    // re-opened with the slider already at the saved pace).
    var changed = (value !== prev);
    if (changed) {
      emit('prefsChanged', {
        prefs: o,
        key: key,
        value: value,
        source: source || 'local',
      });
    }
    return o;
  }
  // prefsReplace — wholesale replace the local cache. Used by MaxSync
  // when hydrating from /user/prefs on sign-in. Always emits with
  // source='remote' so listeners can re-render without echo-pushing
  // the just-fetched values back to the server.
  function prefsReplace(obj) {
    _prefsCache = (obj && typeof obj === 'object') ? obj : {};
    _prefsPersist(_prefsCache);
    emit('prefsChanged', {
      prefs: _prefsCache,
      key: null,
      value: null,
      source: 'remote',
    });
    return _prefsCache;
  }
  function prefsClear() {
    _prefsCache = {};
    try { localStorage.removeItem(KEY_PREFS); } catch (_) {}
    emit('prefsChanged', { prefs: {}, key: null, value: null, source: 'local' });
  }

  // ── Public surface ──────────────────────────────────────────

  var MaxDB = {
    canPersist: canPersist,

    trip: {
      write:    tripWrite,
      writeRaw: tripWriteRaw,
      read:     tripRead,
      readRaw:  tripReadRaw,
      delete:   tripDelete,
      // PD.250: enumerate trip IDs across localStorage + IDB mirror,
      // and await IDB hydration so the enumeration is complete.
      listIds:  tripListIds,
      hydrated: tripHydrated,
    },

    index: {
      load:   indexLoad,
      save:   indexSave,
      list:   indexLoad,
      entry:  indexEntry,
      upsert: indexUpsert,
      remove: indexRemove,
    },

    draft: {
      read:   draftRead,
      write:  draftWrite,
      delete: draftDelete,
    },

    // v353.2: unified user preferences. Single blob in localStorage
    // (KEY_PREFS), set up to grow as we add more prefs without
    // inventing new top-level keys for each one.
    // v353.3 (Path B): server-backed via MaxSync. db.js owns local
    // cache + change events; sync.js drives the network.
    prefs: {
      get:     prefsGet,
      set:     prefsSet,
      replace: prefsReplace,
      clear:   prefsClear,
    },

    cache: {
      llm: {
        get:     llmCacheGet,
        set:     llmCacheSet,
        all:     llmCacheAll,
        replace: llmCacheReplace,
        clear:   llmCacheClear,
        ready:   llmReady,
      },
      // v359.42: IDB-backed Wikipedia summary cache. Async API
      // (get/set return Promises). Migration from old localStorage
      // entries runs once on module init.
      wiki: {
        get:     wikiCacheGet,
        set:     wikiCacheSet,
        migrate: wikiCacheMigrate,
      },
      geocode: {
        get:     geocodeGet,
        set:     geocodeSet,
        all:     geocodeAll,
        replace: geocodeReplace,
        flush:   geocodeFlush,
      },
      cityData: {
        // Round HU — in-memory per-place city data. Same object is
        // exposed as window._generatedCityData for back-compat with
        // ~20 inline-script call sites.
        map:    cityDataMap,
        get:    cityDataGet,
        set:    cityDataSet,
        has:    cityDataHas,
        delete: cityDataDelete,
        clear:  cityDataClear,
      },
    },

    setting: {
      get:    settingGet,
      set:    settingSet,
      remove: settingRemove,
    },

    cleanupOrphaned: cleanupOrphaned,
    storageStats:    storageStats,

    on:  on,
    off: off,

    // Internal — exposed for tests and migration helpers, not for engines.
    _internal: {
      idbGet:    idbGet,
      idbSet:    idbSet,
      idbDelete: idbDelete,
      keys: {
        trip:      KEY_TRIP_PREFIX,
        index:     KEY_TRIPS_INDEX,
        draft:     KEY_DRAFT_PREFIX,
        llmCache:  KEY_LLM_CACHE,
        geocode:   KEY_GEOCODE,
        apiKey:    KEY_API_KEY,
        mapStyle:  KEY_MAP_STYLE,
        hideIntro: KEY_HIDE_INTRO,
      }
    }
  };

  global.MaxDB = MaxDB;

  // v359.42 + v359.43: kick off async migrations + IDB hydration on
  // module init. Both run fire-and-forget; consumers don't await
  // them. Wiki migration moves stale localStorage entries into IDB
  // (freeing space); trip IDB hydration populates the in-memory
  // mirror so tripRead can find IDB-only trips synchronously.
  if (canPersist) {
    try { wikiCacheMigrate(); } catch (_) {}
    // PD.250: stash the hydration promise so tripHydrated() can resolve
    // when it completes; cleanupOrphanedTrips uses this to sweep
    // IDB-only orphans (the resurrection vector before PD.250).
    try { _hydrationPromise = hydrateTripIdbMirror(); } catch (_) { _hydrationPromise = Promise.resolve(); }
  }
})(typeof window !== 'undefined' ? window : this);
