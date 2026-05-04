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

  function tripWrite(id, envelope) {
    if (!canPersist || !id) return false;
    try {
      localStorage.setItem(KEY_TRIP_PREFIX + id, JSON.stringify(envelope));
      // Round HS: include the envelope in the payload so in-process
      // subscribers (e.g., the trip engine's HQ subscriber) can adopt
      // without a JSON re-parse that would lose dest object identity.
      emit('tripWritten', { id: id, envelope: envelope });
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || (e.code && e.code === 22))) {
        // Round CL.3 + GA: caller should surface this so the user knows
        // to delete old trips. We log and return false; we never throw
        // out of the storage layer.
        console.warn('[MaxDB] localStorage full when writing trip', id);
        return false;
      }
      console.warn('[MaxDB] tripWrite failed:', e);
      return false;
    }
  }

  function tripWriteRaw(id, json) {
    // Convenience for callers that already have a serialized JSON
    // string (e.g., the existing serializeTrip()). Functionally the
    // same as tripWrite but skips a parse + re-stringify.
    if (!canPersist || !id) return false;
    try {
      localStorage.setItem(KEY_TRIP_PREFIX + id, json);
      // Round HS: parse once here so the in-process subscriber gets the
      // envelope object instead of having to re-read+parse from storage.
      // If the JSON is malformed we still emit (without envelope) so
      // tripWritten remains a reliable "something landed in storage"
      // signal — subscribers fall back to MaxDB.trip.read().
      var envelope = null;
      try { envelope = JSON.parse(json); } catch (_) {}
      emit('tripWritten', { id: id, envelope: envelope });
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || (e.code && e.code === 22))) {
        console.warn('[MaxDB] localStorage full when writing trip', id);
        return false;
      }
      console.warn('[MaxDB] tripWriteRaw failed:', e);
      return false;
    }
  }

  function tripRead(id) {
    if (!canPersist || !id) return null;
    try {
      var raw = localStorage.getItem(KEY_TRIP_PREFIX + id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[MaxDB] tripRead failed for', id, e);
      return null;
    }
  }

  function tripReadRaw(id) {
    // Returns the raw JSON string. Callers like the existing
    // restoreTrip() take a string directly; this lets them keep
    // their current shape during migration.
    if (!canPersist || !id) return null;
    try {
      return localStorage.getItem(KEY_TRIP_PREFIX + id);
    } catch (e) { return null; }
  }

  function tripDelete(id) {
    if (!canPersist || !id) return false;
    try {
      localStorage.removeItem(KEY_TRIP_PREFIX + id);
      emit('tripDeleted', { id: id });
      return true;
    } catch (e) {
      console.warn('[MaxDB] tripDelete failed:', e);
      return false;
    }
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
            if (t && (!t.destinations || t.destinations.length === 0)
                  && (!t.candidates   || t.candidates.length === 0)) {
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

  // ── Public surface ──────────────────────────────────────────

  var MaxDB = {
    canPersist: canPersist,

    trip: {
      write:    tripWrite,
      writeRaw: tripWriteRaw,
      read:     tripRead,
      readRaw:  tripReadRaw,
      delete:   tripDelete,
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

    cache: {
      llm: {
        get:     llmCacheGet,
        set:     llmCacheSet,
        all:     llmCacheAll,
        replace: llmCacheReplace,
        clear:   llmCacheClear,
        ready:   llmReady,
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
})(typeof window !== 'undefined' ? window : this);
