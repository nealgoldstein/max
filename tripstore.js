// ─────────────────────────────────────────────────────────────────────
// TripStore — single source of truth for trip state.
//
// Architecture (see architecture-rewrite.md):
//
//   • One in-memory `trip` object. Everything else (renderers, LLM,
//     sync, paste import) reads from TripStore.trip and writes
//     through TripStore.<mutator>(...).
//
//   • Every mutator: validates input → mutates state → bumps version
//     → persists atomically via MaxDB → emits `tripChange`.
//
//   • Subscribers (picker, trip view, map) listen for `tripChange`
//     and re-render against current state. No render captures a
//     snapshot. No render computes off stale data.
//
//   • Schema is versioned. Every load runs migrations.
//
//   • Persistence is push-only to sync (local always wins) — see
//     `replace()`.
//
// Rule: NOTHING outside TripStore mutates `_trip`. If you find
// `_trip.X =` anywhere except inside a mutator in this file, that's
// a bug.
// ─────────────────────────────────────────────────────────────────────

(function (global) {
  "use strict";

  // ── Schema version ─────────────────────────────────────────────────
  // Bump whenever the trip object shape changes. Add a migrator below.
  var SCHEMA_VERSION = 1;

  // ── In-memory state ────────────────────────────────────────────────
  var _trip = null;          // the canonical trip object (null when no trip loaded)
  var _version = 0;          // bumped on every mutation, exposed for change detection
  var _listeners = {};       // event name → array of callbacks

  // Mirror the canonical trip to legacy globals so existing code that
  // reads `trip.X` directly sees the same object. This is the strangler-
  // pattern bridge: TripStore owns the state, legacy code reads through
  // the global alias, and migration to TripStore mutators happens
  // incrementally across phases 3-5. Once all reads/writes go through
  // mutators, we can drop the global aliases (Phase 6).
  // `global` is the IIFE parameter — `window` in browser, Node `global`
  // in tests.
  function _setTripRef(t) {
    _trip = t;
    global.trip = t;
  }

  // ── Event bus ──────────────────────────────────────────────────────
  function on(event, fn) {
    if (typeof event !== "string" || typeof fn !== "function") return function(){};
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
    return function unsubscribe() { off(event, fn); };
  }
  function off(event, fn) {
    var arr = _listeners[event];
    if (!arr) return;
    var i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  function emit(event, payload) {
    var arr = _listeners[event];
    if (arr) {
      // Copy to allow listeners to unsubscribe during iteration.
      arr.slice().forEach(function (fn) {
        try { fn(payload); }
        catch (e) { console.warn("[TripStore] listener error on " + event + ":", e); }
      });
    }
    // Bridge to MaxEngineTrip's pre-existing event bus so legacy
    // renderers (index.html:42235 tripChange listener, etc.) re-render
    // when TripStore mutators fire. Without this, the existing app
    // wouldn't react to TripStore.setName et al. — Phase 3 migrates
    // them to subscribe to TripStore directly; until then we cross-
    // emit so the rewrite delivers value immediately.
    if (event === "tripChange") {
      try {
        if (global.MaxEngineTrip && typeof global.MaxEngineTrip.emit === "function") {
          global.MaxEngineTrip.emit("tripChange");
          global.MaxEngineTrip.emit("mapDataChange");
        }
      } catch (e) {
        console.warn("[TripStore] bridge emit failed:", e && e.message);
      }
    }
  }

  // ── Persistence ────────────────────────────────────────────────────
  // Wraps MaxDB. All persistence flows through here. Push-only sync
  // policy is enforced in replace() — sync pulls cannot overwrite
  // local state without explicit user action.
  function _persist() {
    if (!_trip || !_trip.id) return false;
    try {
      _trip.__saved__ = Date.now();
      var envelope = { trip: _trip, _schemaVersion: SCHEMA_VERSION };
      // Prefer writeRaw with silent:true to suppress MaxDB's tripWritten
      // event. The engine-trip.js subscriber (engine-trip.js ~line 2955)
      // listens for tripWritten and replaces global.trip from the envelope.
      // For our own writes that's a redundant round-trip — and worse, the
      // replacement reference would diverge from TripStore._trip. The
      // silent flag breaks the feedback loop.
      if (typeof MaxDB !== "undefined" && MaxDB.trip && typeof MaxDB.trip.writeRaw === "function") {
        var raw = JSON.stringify(envelope);
        var ok = MaxDB.trip.writeRaw(_trip.id, raw, { silent: true });
        if (!ok) {
          console.warn("[TripStore] MaxDB.trip.writeRaw returned false for", _trip.id);
          emit("persistError", { id: _trip.id });
          return false;
        }
        return true;
      }
      if (typeof MaxDB !== "undefined" && MaxDB.trip && typeof MaxDB.trip.write === "function") {
        // Older API path (no silent support) — used in tests with the
        // mock. The mock doesn't dispatch tripWritten so the feedback
        // loop doesn't exist.
        var ok2 = MaxDB.trip.write(_trip.id, envelope);
        if (!ok2) {
          console.warn("[TripStore] MaxDB.trip.write returned false for", _trip.id);
          emit("persistError", { id: _trip.id });
          return false;
        }
        return true;
      }
      // Fallback if MaxDB isn't loaded yet (very early bootstrap).
      try {
        localStorage.setItem("max-trip-" + _trip.id, JSON.stringify(envelope));
        return true;
      } catch (e) {
        console.warn("[TripStore] localStorage fallback write failed:", e && e.message);
        emit("persistError", { id: _trip.id, error: e });
        return false;
      }
    } catch (e) {
      console.warn("[TripStore] _persist threw:", e && e.message);
      emit("persistError", { id: _trip && _trip.id, error: e });
      return false;
    }
  }

  // Batch-mutation context. When non-zero, individual mutators skip
  // their persist+emit; the batch call does one persist + emit at
  // the end. Used by multi-step flows like _initialTripSave which
  // would otherwise fire 5+ tripChange events for a single logical
  // operation (mint → setName → setCandidates → setPlaceActivities →
  // updateBrief).
  var _batchDepth = 0;
  var _batchDirty = false;

  function batch(fn, batchName) {
    if (typeof fn !== "function") {
      throw new Error("[TripStore] batch() requires a function");
    }
    _batchDepth++;
    var result;
    try {
      result = fn();
    } finally {
      _batchDepth--;
      // Top-level batch exit. Persist + emit if anything changed.
      if (_batchDepth === 0 && _batchDirty && _trip) {
        _batchDirty = false;
        _persist();
        emit("tripChange", {
          mutator: "batch:" + (batchName || "anonymous"),
          payload: null,
          version: _version
        });
      }
    }
    return result;
  }

  // The core mutation primitive. Every named mutator below calls this.
  // Guarantees outside a batch: mutation → version bump → persist →
  // emit, in order, atomically (synchronously — no caller can observe
  // a partial state).
  // Guarantees inside a batch: mutation → version bump; persist + emit
  // deferred until the outermost batch() returns.
  function _mutate(name, fn, payload) {
    if (!_trip) {
      throw new Error("[TripStore] cannot mutate (" + name + ") — no trip loaded");
    }
    try {
      fn(_trip);
    } catch (e) {
      console.warn("[TripStore] mutator '" + name + "' threw:", e && e.message);
      throw e;
    }
    _version++;
    _trip._version = _version;
    if (_batchDepth > 0) {
      _batchDirty = true;
      return _trip;
    }
    _persist();
    emit("tripChange", { mutator: name, payload: payload, version: _version });
    return _trip;
  }

  // ── Migrations ─────────────────────────────────────────────────────
  // Runs on every load. Each migrator is a pure function (trip) → void
  // that mutates trip in place. Order matters: v0→v1, v1→v2, etc.
  function _migrate(trip, storageKey) {
    if (!trip || typeof trip !== "object") return trip;
    var v = trip._schemaVersion || 0;
    if (v < 1) _migrateV0ToV1(trip, storageKey);
    // Future: if (v < 2) _migrateV1ToV2(trip);
    trip._schemaVersion = SCHEMA_VERSION;
    return trip;
  }

  function _migrateV0ToV1(trip, storageKey) {
    // 1. Backfill id from the storage key. Pre-rewrite trips stored
    //    the id only as the storage key; the in-memory object had no
    //    id field, so trip.id was undefined forever. Architecturally
    //    fixed by treating id as a first-class field.
    if (!trip.id && storageKey) {
      trip.id = storageKey;
    }
    // 2. Ensure all required top-level fields exist with sane
    //    defaults. The schema below is the contract.
    if (!Array.isArray(trip.destinations)) trip.destinations = [];
    if (!Array.isArray(trip.placeActivities)) trip.placeActivities = [];
    if (!Array.isArray(trip.candidates)) trip.candidates = [];
    if (!Array.isArray(trip.routes)) trip.routes = [];
    if (!Array.isArray(trip.pendingActions)) trip.pendingActions = [];
    if (!trip.places || typeof trip.places !== "object") trip.places = {};
    if (!trip.brief || typeof trip.brief !== "object") trip.brief = {};
    if (!trip.picker || typeof trip.picker !== "object") {
      // Pre-rewrite picker state lived on a separate `_tb` global. The
      // bridge (Phase 2) projects trip.picker.* ↔ _tb.* so legacy
      // call sites keep working. Seed with empty defaults.
      trip.picker = {};
    }
    if (!trip.destNotes || typeof trip.destNotes !== "object") trip.destNotes = {};
    if (!trip.destStories || typeof trip.destStories !== "object") trip.destStories = {};
    if (!trip.sightStories || typeof trip.sightStories !== "object") trip.sightStories = {};
    if (!trip.ffHistories || typeof trip.ffHistories !== "object") trip.ffHistories = {};
    if (!trip.notes || typeof trip.notes !== "object") trip.notes = { text: "", links: [] };
    if (!trip.legs || typeof trip.legs !== "object") trip.legs = {};
    if (typeof trip.trackSpending !== "boolean") trip.trackSpending = false;
    // 3. Drop old field shapes. Pre-rewrite trip.mdcItems was a
    //    duplicate of placeActivities. The bridge will project either
    //    into the other; the canonical store is placeActivities.
    if (trip.mdcItems !== undefined) delete trip.mdcItems;
  }

  // ── Lifecycle mutators ─────────────────────────────────────────────

  // Mint a brand-new trip from an initial brief. Used by paste flow,
  // sentence flow, file import. Returns the new trip object.
  function mint(initialBrief) {
    var id = "trip-" + Date.now();
    var t = {
      id: id,
      _schemaVersion: SCHEMA_VERSION,
      _version: 0,
      __saved__: 0,
      name: "",
      _lastScreen: null,
      destinations: [],
      placeActivities: [],
      candidates: [],
      routes: [],
      places: {},
      pendingActions: [],
      brief: initialBrief && typeof initialBrief === "object" ? initialBrief : {},
      picker: {},
      destNotes: {},
      destStories: {},
      sightStories: {},
      ffHistories: {},
      notes: { text: "", links: [] },
      legs: {},
      trackSpending: false
    };
    _setTripRef(t);
    _version = 0;
    _persist();
    emit("tripChange", { mutator: "mint", payload: { id: id }, version: _version });
    emit("tripLoaded", { id: id });
    return _trip;
  }

  // Load an existing trip from storage. Runs migrations. Emits
  // tripLoaded after tripChange so listeners can distinguish.
  function load(id) {
    if (!id) {
      throw new Error("[TripStore] load() requires an id");
    }
    var envelope = null;
    try {
      if (typeof MaxDB !== "undefined" && MaxDB.trip && typeof MaxDB.trip.read === "function") {
        envelope = MaxDB.trip.read(id);
      } else {
        var raw = localStorage.getItem("max-trip-" + id);
        if (raw) envelope = JSON.parse(raw);
      }
    } catch (e) {
      console.warn("[TripStore] load() failed to read:", e && e.message);
      throw e;
    }
    if (!envelope || !envelope.trip) {
      throw new Error("[TripStore] load() found no envelope for id " + id);
    }
    _setTripRef(_migrate(envelope.trip, id));
    _version = (_trip._version || 0);
    emit("tripChange", { mutator: "load", payload: { id: id }, version: _version });
    emit("tripLoaded", { id: id });
    return _trip;
  }

  // Replace the current trip wholesale. Used by:
  //   - File import (user opens a .json trip file)
  //   - "Restore from cloud" (explicit user action)
  // NOT used by sync pulls. Sync is push-only per architecture
  // decision; pulls cannot overwrite local without explicit invocation.
  function replace(newTrip) {
    if (!newTrip || typeof newTrip !== "object") {
      throw new Error("[TripStore] replace() requires a trip object");
    }
    _setTripRef(_migrate(newTrip, newTrip.id || null));
    _version = (_trip._version || 0);
    _persist();
    emit("tripChange", { mutator: "replace", payload: null, version: _version });
    emit("tripLoaded", { id: _trip.id });
    return _trip;
  }

  // Clear in-memory state. Used by showHome() and similar navigation
  // away from a trip. Does NOT delete the trip from storage.
  function unload() {
    var hadTrip = !!_trip;
    _setTripRef(null);
    _version = 0;
    if (hadTrip) emit("tripUnloaded", null);
  }

  // ── Trip-level mutators ────────────────────────────────────────────

  function setName(name) {
    return _mutate("setName", function (t) {
      t.name = String(name || "");
    }, { name: name });
  }

  function setLastScreen(screen) {
    return _mutate("setLastScreen", function (t) {
      t._lastScreen = screen || null;
    }, { screen: screen });
  }

  function setBrief(brief) {
    return _mutate("setBrief", function (t) {
      t.brief = brief && typeof brief === "object" ? brief : {};
    }, { brief: brief });
  }

  function updateBrief(partial) {
    if (!partial || typeof partial !== "object") return _trip;
    return _mutate("updateBrief", function (t) {
      if (!t.brief) t.brief = {};
      Object.keys(partial).forEach(function (k) {
        t.brief[k] = partial[k];
      });
    }, { partial: partial });
  }

  function setNotes(notes) {
    return _mutate("setNotes", function (t) {
      t.notes = notes && typeof notes === "object" ? notes : { text: "", links: [] };
    }, { notes: notes });
  }

  // ── Destination mutators ───────────────────────────────────────────

  function setDestinations(dests) {
    if (!Array.isArray(dests)) {
      throw new Error("[TripStore] setDestinations requires an array");
    }
    return _mutate("setDestinations", function (t) {
      t.destinations = dests;
    }, { count: dests.length });
  }

  function addDestination(dest, atIndex) {
    if (!dest || typeof dest !== "object" || !dest.id) {
      throw new Error("[TripStore] addDestination requires a dest with an id");
    }
    return _mutate("addDestination", function (t) {
      var i = (typeof atIndex === "number" && atIndex >= 0 && atIndex <= t.destinations.length)
        ? atIndex
        : t.destinations.length;
      t.destinations.splice(i, 0, dest);
    }, { destId: dest.id, atIndex: atIndex });
  }

  function removeDestination(destId) {
    return _mutate("removeDestination", function (t) {
      t.destinations = t.destinations.filter(function (d) { return d && d.id !== destId; });
    }, { destId: destId });
  }

  function updateDestination(destId, partial) {
    if (!destId || !partial || typeof partial !== "object") return _trip;
    return _mutate("updateDestination", function (t) {
      var d = t.destinations.find(function (x) { return x && x.id === destId; });
      if (!d) return;
      Object.keys(partial).forEach(function (k) { d[k] = partial[k]; });
    }, { destId: destId, partial: partial });
  }

  function reorderDestinations(newOrder) {
    if (!Array.isArray(newOrder)) {
      throw new Error("[TripStore] reorderDestinations requires an array");
    }
    return _mutate("reorderDestinations", function (t) {
      t.destinations = newOrder;
    }, { count: newOrder.length });
  }

  // ── Picker mutators ────────────────────────────────────────────────

  function setPlaceActivities(items) {
    if (!Array.isArray(items)) {
      throw new Error("[TripStore] setPlaceActivities requires an array");
    }
    return _mutate("setPlaceActivities", function (t) {
      t.placeActivities = items;
    }, { count: items.length });
  }

  function updatePlaceActivity(id, partial) {
    if (!id || !partial || typeof partial !== "object") return _trip;
    return _mutate("updatePlaceActivity", function (t) {
      var it = t.placeActivities.find(function (x) { return x && x.id === id; });
      if (!it) return;
      Object.keys(partial).forEach(function (k) { it[k] = partial[k]; });
    }, { id: id, partial: partial });
  }

  function removePlaceActivity(id) {
    return _mutate("removePlaceActivity", function (t) {
      t.placeActivities = t.placeActivities.filter(function (it) { return it && it.id !== id; });
    }, { id: id });
  }

  function setCandidates(items) {
    if (!Array.isArray(items)) {
      throw new Error("[TripStore] setCandidates requires an array");
    }
    return _mutate("setCandidates", function (t) {
      t.candidates = items;
    }, { count: items.length });
  }

  function updatePicker(partial) {
    if (!partial || typeof partial !== "object") return _trip;
    return _mutate("updatePicker", function (t) {
      if (!t.picker) t.picker = {};
      Object.keys(partial).forEach(function (k) { t.picker[k] = partial[k]; });
    }, { partial: partial });
  }

  // ── Publish (kept-candidates → destinations) ───────────────────────
  // Atomic. Either everything updates or nothing does.
  function publish(buildOutput) {
    if (!buildOutput || typeof buildOutput !== "object") {
      throw new Error("[TripStore] publish requires a buildOutput object");
    }
    return _mutate("publish", function (t) {
      if (Array.isArray(buildOutput.destinations)) t.destinations = buildOutput.destinations;
      if (Array.isArray(buildOutput.routes)) t.routes = buildOutput.routes;
      if (buildOutput.places && typeof buildOutput.places === "object") t.places = buildOutput.places;
      if (buildOutput.brief && typeof buildOutput.brief === "object") t.brief = buildOutput.brief;
      if (typeof buildOutput.createdAt === "string") t.createdAt = buildOutput.createdAt;
    }, {
      destCount: (buildOutput.destinations || []).length,
      routeCount: (buildOutput.routes || []).length
    });
  }

  // ── Annotation mutators ────────────────────────────────────────────

  function setDestNote(destId, note) {
    if (!destId) return _trip;
    return _mutate("setDestNote", function (t) {
      if (!t.destNotes) t.destNotes = {};
      if (note) t.destNotes[destId] = note;
      else delete t.destNotes[destId];
    }, { destId: destId });
  }

  function setDestStory(destId, story) {
    if (!destId) return _trip;
    return _mutate("setDestStory", function (t) {
      if (!t.destStories) t.destStories = {};
      if (story) t.destStories[destId] = story;
      else delete t.destStories[destId];
    }, { destId: destId });
  }

  function setSightStory(sightId, story) {
    if (!sightId) return _trip;
    return _mutate("setSightStory", function (t) {
      if (!t.sightStories) t.sightStories = {};
      if (story) t.sightStories[sightId] = story;
      else delete t.sightStories[sightId];
    }, { sightId: sightId });
  }

  // ── Reads ──────────────────────────────────────────────────────────

  function getTrip() { return _trip; }
  function getVersion() { return _version; }
  function isLoaded() { return _trip != null; }

  // ── Escape hatch ───────────────────────────────────────────────────
  // For tests and rare cases where you need to inject a fresh state
  // without going through load/mint. Bypasses persistence. Should NOT
  // be used in production code paths.
  function _testOnlySetTrip(trip) {
    _setTripRef(trip);
    _version = (trip && trip._version) || 0;
  }
  function _testOnlyClearListeners() {
    _listeners = {};
  }

  // ── Public surface ─────────────────────────────────────────────────

  var TripStore = {
    SCHEMA_VERSION: SCHEMA_VERSION,

    // Reads
    get trip() { return _trip; },
    getTrip: getTrip,
    getVersion: getVersion,
    isLoaded: isLoaded,

    // Lifecycle
    mint: mint,
    load: load,
    replace: replace,
    unload: unload,

    // Trip-level
    setName: setName,
    setLastScreen: setLastScreen,
    setBrief: setBrief,
    updateBrief: updateBrief,
    setNotes: setNotes,

    // Destinations
    setDestinations: setDestinations,
    addDestination: addDestination,
    removeDestination: removeDestination,
    updateDestination: updateDestination,
    reorderDestinations: reorderDestinations,

    // Picker
    setPlaceActivities: setPlaceActivities,
    updatePlaceActivity: updatePlaceActivity,
    removePlaceActivity: removePlaceActivity,
    setCandidates: setCandidates,
    updatePicker: updatePicker,

    // Publish
    publish: publish,

    // Batch (multi-mutator transaction)
    batch: batch,

    // Annotations
    setDestNote: setDestNote,
    setDestStory: setDestStory,
    setSightStory: setSightStory,

    // Events
    on: on,
    off: off,

    // Test-only
    _testOnlySetTrip: _testOnlySetTrip,
    _testOnlyClearListeners: _testOnlyClearListeners,
    _testOnlyEmit: emit
  };

  global.TripStore = TripStore;
  // Node export for tests
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TripStore;
  }
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
