// @ts-check
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

const global = /** @type {any} */ (globalThis);
  "use strict";

  // ── Schema version ─────────────────────────────────────────────────
  // T3.3: ONE migrator now. Aligned to migration.js's CURRENT_SCHEMA_VERSION
  // (4) — tripstore._migrate keeps its structural backfill (id-from-key,
  // default fields, mdcItems drop) and delegates the SHAPE evolution
  // (places dict, route kind→subKind, segments, arrival/departure synthesis)
  // to MaxMigration.migrateTripShape, so the two no longer stamp the same
  // _schemaVersion field with incompatible numbers.
  var SCHEMA_VERSION = 4;

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
    // The persist idempotency signature is bound to the CURRENT trip's
    // identity + storage. Switching to a different trip (or unloading)
    // invalidates it, so clear it then — otherwise a stale signature could
    // suppress the new trip's first write. A same-id replace (the cross-tab
    // sync path) deliberately KEEPS the signature so the no-op-write guard
    // can still converge the two tabs.
    if (!t || !_trip || t.id !== _trip.id) _lastPersistSig = null;
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
  // Signature of the last envelope this tab wrote OR adopted, with the
  // volatile __saved__ stamp stripped. Persistence is IDEMPOTENT against it:
  // a write whose semantic content is unchanged is skipped. This is what
  // breaks the cross-tab render loop — two tabs open on one trip used to
  // ping-pong forever (tab A writes → tab B's `storage` handler restores +
  // re-renders + persists → tab A's handler fires → …). A no-op write emits
  // no `storage` event, so the moment both tabs hold equal content the loop
  // ends by construction, not by a throttle or a guard flag.
  var _lastPersistSig = null;
  // Signature over SUBSTANTIVE content only: the two volatile metadata stamps
  // (__saved__ wall-clock and _version counter) are dropped, because a mutate
  // bumps _version even when nothing meaningful changed. Without dropping it,
  // the cross-tab cycle's ever-incrementing _version would make every envelope
  // look different and the no-op-write guard could never converge.
  function _envSig(envelope) {
    try {
      return JSON.stringify(envelope, function (k, v) {
        return (k === "__saved__" || k === "_version") ? undefined : v;
      });
    } catch (_) { return null; }
  }

  function _persist() {
    if (!_trip || !_trip.id) return false;
    try {
      _trip.__saved__ = Date.now();
      var envelope = { trip: _trip, _schemaVersion: SCHEMA_VERSION };
      var _sig = _envSig(envelope);
      if (_sig !== null && _sig === _lastPersistSig) return true; // no-op: content unchanged
      _lastPersistSig = _sig;
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

  // PD.358: touch(name) — version-bump + persist with NO state change.
  // The one-door no-op guard (PD.356a) means reassigning an unchanged
  // array is silent; flows that mutate items IN PLACE (keep flips,
  // folds, role changes) call touch() so the persist is explicit and
  // guaranteed, not a side effect of some sibling mutator happening
  // to be dirty.
  function touch(name) {
    return _mutate("touch:" + (name || "anonymous"), function () {}, null);
  }

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

  // ── Single-flight primitive (PD.319-7) ─────────────────────────────
  //
  // Generalizes the PD.315 mutex pattern (originally local to
  // generateActivitiesForPlace) so any async writer can opt in with
  // one wrapper call. The bug class it closes:
  //
  //   1. async function A() { await llm(); _tb.X = result; }
  //   2. Two callers fire A() in parallel.
  //   3. Both await. Both then reassign _tb.X.
  //   4. The second reassignment wipes whatever the first wrote
  //      between its return and the second's reassignment.
  //
  // Single-flight guard: if a call with the given key is already
  // in flight, return its promise instead of starting a second one.
  // The second caller gets the FIRST call's result — semantically
  // correct because both want the same answer.
  //
  //   await TripStore.singleFlight("generateActivities", function () {
  //     return llm("...").then(function (r) { _tb.X = r; });
  //   });
  //
  // Keys are arbitrary strings; same key = same flight. Different
  // keys are independent. Failures (rejections) clear the in-flight
  // entry so the next caller gets a fresh attempt.
  var _inFlight = {};

  function singleFlight(key, fn) {
    if (!key || typeof key !== "string") {
      throw new Error("[TripStore] singleFlight requires a string key");
    }
    if (typeof fn !== "function") {
      throw new Error("[TripStore] singleFlight requires a function");
    }
    if (_inFlight[key]) return _inFlight[key];
    var p;
    try {
      var ret = fn();
      // Allow sync OR async fns. Wrap in Promise.resolve so we always
      // return a promise.
      p = Promise.resolve(ret);
    } catch (syncErr) {
      // fn threw synchronously — propagate without keeping it
      // in-flight (a sync throw is not a race condition).
      return Promise.reject(syncErr);
    }
    _inFlight[key] = p;
    // Clear the in-flight entry whether the promise resolves or
    // rejects, so a future caller can retry.
    p.then(
      function () { delete _inFlight[key]; },
      function () { delete _inFlight[key]; }
    );
    return p;
  }

  // Debug helper — list currently in-flight keys.
  function _singleFlightInFlight() {
    return Object.keys(_inFlight);
  }

  // Self-heal: legacy load paths can set global.trip + _currentTripId
  // without going through TripStore.mint or .load. When subsequent
  // code calls a TripStore mutator, _trip is null and the mutator
  // would throw. Detect that state and adopt the legacy-loaded trip
  // into TripStore (running schema migrations on the way in). The
  // alternative — throwing — leaves the bridge layer brittle. This
  // closes the regression where _initialTripSave's existing-trip
  // branch saw a set _currentTripId but TripStore wasn't initialized.
  function _adoptLegacyTripIfNeeded() {
    if (_trip) return;
    if (global.trip && global.trip.id) {
      _setTripRef(_migrate(global.trip, global.trip.id));
      _version = (_trip._version || 0);
    }
  }

  // PD.319-7: single-flight guard. If a mutator is mid-execution and
  // a nested mutator fires (synchronously, via a subscriber that
  // mistakenly mutates back), the second call would clobber the first.
  // Detect that — log a warning, but allow the call (some legitimate
  // patterns re-enter via batch()). Helps surface PD.315-class bugs
  // for new writers without breaking existing chains.
  var _mutatorDepth = 0;

  // PD.319-5: mutation audit log. Every mutator appends a record to
  // trip._auditLog. Used by support / debugging to answer "what
  // mutator dropped my reservation?". Capped at 200 entries to
  // bound storage cost; older entries roll off. Not user-visible.
  var _AUDIT_CAP = 200;
  function _appendAudit(name, payload) {
    if (!_trip) return;
    if (!Array.isArray(_trip._auditLog)) _trip._auditLog = [];
    _trip._auditLog.push({
      t: Date.now(),
      v: _version,
      m: name,
      p: _trimPayload(payload),
      d: _mutatorDepth
    });
    if (_trip._auditLog.length > _AUDIT_CAP) {
      _trip._auditLog.splice(0, _trip._auditLog.length - _AUDIT_CAP);
    }
  }
  // Audit payloads are kept small — large arrays are summarized as
  // {len:N}, large strings truncated at 80 chars. Prevents the audit
  // log from ballooning trip storage on every mutation.
  function _trimPayload(p) {
    if (p == null) return p;
    if (typeof p === "string") return p.length > 80 ? p.slice(0, 80) + "…" : p;
    if (Array.isArray(p)) return { len: p.length };
    if (typeof p !== "object") return p;
    var out = {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (Array.isArray(v)) out[k] = { len: v.length };
      else if (typeof v === "string") out[k] = v.length > 80 ? v.slice(0, 80) + "…" : v;
      else if (typeof v === "object" && v !== null) out[k] = "[obj]";
      else out[k] = v;
    });
    return out;
  }

  // The core mutation primitive. Every named mutator below calls this.
  // Guarantees outside a batch: mutation → version bump → audit →
  // persist → emit, in order, atomically (synchronously — no caller
  // can observe a partial state).
  // Guarantees inside a batch: mutation → version bump → audit;
  // persist + emit deferred until the outermost batch() returns.
  function _mutate(name, fn, payload) {
    _adoptLegacyTripIfNeeded();
    if (!_trip) {
      throw new Error("[TripStore] cannot mutate (" + name + ") — no trip loaded");
    }
    if (_mutatorDepth > 0) {
      // Surface the re-entry — typically a subscriber to tripChange
      // is mutating, which is at minimum a code-smell.
      console.warn("[TripStore] re-entrant mutator '" + name + "' (depth " +
        _mutatorDepth + ") — possible subscriber-induced cycle. See PD.315 for the bug class.");
    }
    _mutatorDepth++;
    try {
      try {
        fn(_trip);
      } catch (e) {
        console.warn("[TripStore] mutator '" + name + "' threw:", e && e.message);
        throw e;
      }
      _version++;
      _trip._version = _version;
      // PD.319-5: audit BEFORE persist so the audit entry rides with
      // the persisted trip. Cheap (Date.now + push).
      _appendAudit(name, payload);
      if (_batchDepth > 0) {
        _batchDirty = true;
        return _trip;
      }
      _persist();
      emit("tripChange", { mutator: name, payload: payload, version: _version });
      return _trip;
    } finally {
      _mutatorDepth--;
    }
  }

  // ── Migrations ─────────────────────────────────────────────────────
  // Runs on every load. Each migrator is a pure function (trip) → void
  // that mutates trip in place. Order matters: v0→v1, v1→v2, etc.
  //
  // PD.319-6: when a migration runs, the pre-migration trip is
  // snapshotted to trip._preMigrationBackup. The backup carries:
  //   - fromVersion: the schema version BEFORE this migration
  //   - toVersion: SCHEMA_VERSION (what we migrated to)
  //   - snapshot: a JSON clone of the pre-migration trip
  //   - migratedAt: timestamp
  // The backup survives one further version bump (cleared at v+2),
  // so a buggy migration is recoverable within the same session and
  // the next one. After two versions, we delete the backup to bound
  // storage cost. To recover: read trip._preMigrationBackup.snapshot
  // and TripStore.replace() it.
  function _migrate(trip, storageKey) {
    if (!trip || typeof trip !== "object") return trip;
    var v = trip._schemaVersion || 0;
    if (v === SCHEMA_VERSION) return trip; // no migration needed
    // PD.319-6: snapshot before mutating. Only snapshot if we're
    // actually going to migrate (v < SCHEMA_VERSION). Don't snapshot
    // an already-migrated trip just because it loaded.
    if (v < SCHEMA_VERSION) {
      try {
        trip._preMigrationBackup = {
          fromVersion: v,
          toVersion: SCHEMA_VERSION,
          migratedAt: Date.now(),
          snapshot: JSON.parse(JSON.stringify(trip))
        };
      } catch (snapErr) {
        // Backup is best-effort. If structured clone fails (huge trip,
        // cyclic refs), warn and continue without it.
        console.warn("[TripStore] could not snapshot pre-migration backup:",
          snapErr && snapErr.message);
      }
    }
    // tripstore's structural backfill — id-from-key, default fields, drop
    // mdcItems. Idempotent (`if (!x) x = default`), so safe to run for any v.
    _migrateV0ToV1(trip, storageKey);
    // T3.3: delegate the SHAPE migration (v0→v4: places dict, dest.placeId,
    // days, dayTrips→PlanItems, route kind→subKind, segments + refs,
    // arrival/departure synthesis) to the one complete, Node-tested migrator.
    // Idempotent + version-gated — verified on a real v1-stamped/v3-shaped trip
    // (it completes the missing arrival/departure routes and never double-migrates).
    try {
      if (typeof MaxMigration !== "undefined" && MaxMigration
          && typeof MaxMigration.migrateTripShape === "function") {
        MaxMigration.migrateTripShape({ trip: trip });
      }
    } catch (mErr) {
      console.warn("[TripStore] migrateTripShape failed (non-fatal):", mErr && mErr.message);
    }
    trip._schemaVersion = SCHEMA_VERSION;
    // T3.3: keep the pre-migration snapshot. The old "roll off backups >1
    // version behind" was written for a 1-version scheme (never fired); under
    // the v0→v4 scheme it would delete the very backup it just created on a
    // multi-version jump — exactly when recovery matters most. One snapshot per
    // migrated trip persists with it (cleared naturally once the trip re-saves
    // at the current version and stops migrating).
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
    // 3. Drop legacy mdcItems. PD.303 made placeActivities canonical;
    //    PD.322 migrated all 67 read sites in index.html / engine-
    //    picker.js / trip-ui.js to placeActivities, so the strip is
    //    safe — no caller reads trip.mdcItems anymore. The legacy
    //    content (if any) was a duplicate of placeActivities; the
    //    canonical store wins.
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
    // Prime the idempotency signature: we just adopted this exact content, so
    // a render that re-persists it unchanged must NOT echo a write back out
    // (the cross-tab sync loop). Volatile __saved__ is stripped by _envSig.
    _lastPersistSig = _envSig({ trip: _trip, _schemaVersion: SCHEMA_VERSION });
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

  // setLastScreen removed in PD.330. Screen state lives in the URL
  // (MaxRoute) instead of on the trip body. The mutator was unused
  // outside its own tests.

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
    // PD.356 (Phase 1): CANONICAL AT WRITE. This mutator is the one
    // door for the Discovery set; the PD.349 invariant is enforced
    // here so non-canonical data can never even be PERSISTED. The
    // render-time canonicalizer remains as a self-heal for legacy
    // saved trips, but this is the authoritative point. MaxData is a
    // browser global; in Node test contexts without it, the write
    // passes through unchanged (the invariant has its own suite).
    try {
      var _g = (typeof globalThis !== "undefined") ? globalThis : null;
      if (_g && _g.MaxData && typeof _g.MaxData.canonicalizePlaceActivities === "function") {
        items = _g.MaxData.canonicalizePlaceActivities(items);
      }
    } catch (_) {}
    // PD.356a: writing identical state is a SILENT NO-OP. With
    // _tb.placeActivities routed through this mutator, render-time
    // passes that reassign the (canonically unchanged) set would
    // otherwise emit tripChange → re-render → reassign → emit — a
    // feedback loop. Canonicalization is idempotent, so comparing
    // element identity in order is exact: same items, same order,
    // nothing changed, nothing to emit or persist. A genuinely
    // changed set differs in length or refs and mutates normally.
    var _cur = _trip && _trip.placeActivities;
    if (Array.isArray(_cur) && _cur.length === items.length) {
      var _same = true;
      for (var _i = 0; _i < items.length; _i++) {
        if (_cur[_i] !== items[_i]) { _same = false; break; }
      }
      if (_same) return _trip;
    }
    // PD.401V: TRIPWIRE for the elusive "my curated list vanished" drop.
    // The local publish path is proven sound (harness PD.401V) and sync is
    // guarded both ways, so a curated-set drop is non-reproducible — which
    // is exactly why it needs to be caught in the act. This is LOG-ONLY (it
    // changes nothing): if a substantial place set is ever replaced by a
    // near-empty one through the ONE write door, it fires a loud,
    // stack-bearing warning naming the moment, so the regression is
    // diagnosable from one console line instead of reconstructed later.
    // Counts PLACES (requiredPlaces), since a rebuild can legitimately
    // reshape SECTIONS without losing places.
    try {
      var _paCount = function (arr) {
        var n = 0;
        (arr || []).forEach(function (it) { n += (it && it.requiredPlaces ? it.requiredPlaces.length : 0); });
        return n;
      };
      var _wasN = _paCount(_cur), _nowN = _paCount(items);
      if (_wasN >= 10 && _nowN < _wasN * 0.4) {
        console.warn("[TripStore PD.401V] LARGE place-set drop: " + _wasN + " → " + _nowN
          + " places through setPlaceActivities. If this was NOT an intentional clear/rebuild, the curated list is being lost at THIS write.",
          (new Error("place-set drop stack")).stack);
      }
    } catch (_) {}
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
    // PD.370: identical writes are silent no-ops — same loop-guard
    // semantics as setPlaceActivities (PD.356a). _tb.candidates is a
    // routed view; render passes that reassign an unchanged array
    // must not emit.
    var _curC = _trip && _trip.candidates;
    if (Array.isArray(_curC) && _curC.length === items.length) {
      var _sameC = true;
      for (var _ci = 0; _ci < items.length; _ci++) {
        if (_curC[_ci] !== items[_ci]) { _sameC = false; break; }
      }
      if (_sameC) return _trip;
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

  // Public escape hatch for legacy code paths (autoSave, direct trip.X
  // mutations, etc.) to signal "external mutation happened, please
  // notify subscribers." Bumps version + emits tripChange. Does NOT
  // persist (the legacy caller already did that or will). Use sparingly;
  // every call site should migrate to a real named mutator eventually.
  function notifyChange(reason) {
    if (!_trip) return;
    _version++;
    _trip._version = _version;
    emit("tripChange", {
      mutator: reason || "external",
      payload: null,
      version: _version,
      legacy: true
    });
  }

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
    touch: touch,
    updatePlaceActivity: updatePlaceActivity,
    removePlaceActivity: removePlaceActivity,
    setCandidates: setCandidates,
    updatePicker: updatePicker,

    // Publish
    publish: publish,

    // Batch (multi-mutator transaction)
    batch: batch,

    // Single-flight guard (PD.319-7) — wraps any async writer with a
    // mutex keyed by name. Generalizes PD.315's local mutex.
    singleFlight: singleFlight,
    _singleFlightInFlight: _singleFlightInFlight,

    // Escape hatch for legacy code paths
    notifyChange: notifyChange,

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

  // ARCH Phase 6 (architectural close): _currentTripId is now a
  // TripStore-backed property. Reads return TripStore.trip.id; writes
  // route through TripStore so the two CAN'T diverge.
  //
  // Before this: 15+ places across the codebase wrote directly to
  // _currentTripId, and TripStore could be unaware of the change.
  // The Phase 5 regression that crashed generateActivitiesForPlace
  // was exactly that gap: legacy boot-load set _currentTripId without
  // telling TripStore; the next mutator failed with "no trip loaded."
  //
  // After this: writing _currentTripId = null unloads TripStore.
  // Writing _currentTripId = "trip-X" loads or replaces. Reading
  // returns whatever trip TripStore currently holds. The "trip is
  // current" invariant is single-sourced — there's no way to set
  // _currentTripId such that TripStore doesn't know about it.
  //
  // The defineProperty runs before any inline-script `var
  // _currentTripId = null` because tripstore.js is a <script src=>
  // loaded ahead of inline scripts. The legacy `var` declaration
  // becomes a no-op for the binding (already exists) and runs the
  // setter for its `= null` initializer (which no-ops when TripStore
  // isn't loaded yet).
  try {
    Object.defineProperty(global, "_currentTripId", {
      get: function () { return _trip ? _trip.id : null; },
      set: function (v) {
        if (v == null) {
          if (_trip) {
            try { unload(); } catch (_) {}
          }
          return;
        }
        if (_trip && _trip.id === v) return;  // already current
        // Adopt: prefer the in-memory trip object if it matches;
        // otherwise load from storage. Either path runs migrations.
        if (global.trip && global.trip.id === v) {
          try { replace(global.trip); } catch (_) {}
        } else {
          try { load(v); }
          catch (_) {
            // Storage may not have it (rare). Caller's intent was to
            // mark this id as current; nothing reasonable to do.
          }
        }
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    // Already defined (defensive — shouldn't happen given script order).
    console.warn("[TripStore] could not bind _currentTripId getter/setter:", e && e.message);
  }

  // Node export for tests
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TripStore;
  }

export default TripStore;

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.SCHEMA_VERSION = SCHEMA_VERSION;
  __expg.TripStore = TripStore;
  __expg._AUDIT_CAP = _AUDIT_CAP;
  __expg._adoptLegacyTripIfNeeded = _adoptLegacyTripIfNeeded;
  __expg._appendAudit = _appendAudit;
  __expg._batchDepth = _batchDepth;
  __expg._batchDirty = _batchDirty;
  __expg._envSig = _envSig;
  __expg._inFlight = _inFlight;
  __expg._lastPersistSig = _lastPersistSig;
  __expg._migrate = _migrate;
  __expg._migrateV0ToV1 = _migrateV0ToV1;
  __expg._mutate = _mutate;
  __expg._mutatorDepth = _mutatorDepth;
  __expg._setTripRef = _setTripRef;
  __expg._singleFlightInFlight = _singleFlightInFlight;
  __expg._testOnlyClearListeners = _testOnlyClearListeners;
  __expg._testOnlySetTrip = _testOnlySetTrip;
  __expg._trimPayload = _trimPayload;
  __expg._trip = _trip;
  __expg._version = _version;
  __expg.addDestination = addDestination;
  __expg.batch = batch;
  __expg.getTrip = getTrip;
  __expg.getVersion = getVersion;
  __expg.isLoaded = isLoaded;
  __expg.load = load;
  __expg.mint = mint;
  __expg.notifyChange = notifyChange;
  __expg.publish = publish;
  __expg.removeDestination = removeDestination;
  __expg.removePlaceActivity = removePlaceActivity;
  __expg.reorderDestinations = reorderDestinations;
  __expg.replace = replace;
  __expg.setBrief = setBrief;
  __expg.setCandidates = setCandidates;
  __expg.setDestNote = setDestNote;
  __expg.setDestStory = setDestStory;
  __expg.setDestinations = setDestinations;
  __expg.setName = setName;
  __expg.setNotes = setNotes;
  __expg.setPlaceActivities = setPlaceActivities;
  __expg.setSightStory = setSightStory;
  __expg.singleFlight = singleFlight;
  __expg.touch = touch;
  __expg.unload = unload;
  __expg.updateBrief = updateBrief;
  __expg.updateDestination = updateDestination;
  __expg.updatePicker = updatePicker;
  __expg.updatePlaceActivity = updatePlaceActivity;
}
