// @ts-check
// engine-build.js — the single orchestrator for "build a trip."
//
// Before this module existed there were three nearly-parallel build
// pipelines: runCandidateSearch (sentence/Discovery), generate-
// ActivitiesForPlace (paste-list / place-mode), and saveActivity-
// PickerEdits (rebuild). Each separately called _initialTripSave,
// each separately wanted to auto-Enhance, each separately wrote
// inline DOM for its loading state, each separately handled errors,
// and each separately read ~12 fields off the implicit `_tb` argument
// bag with no contract.
//
// This module establishes the contract.
//
//   MaxBuild.findCandidates(input)
//     emits phase events; UI subscribes; one mint per build.
//
//   MaxBuild.rerunEnhance()
//     the standalone "✦ More like this" re-runs the enhance phase
//     against an already-loaded trip. Only by-name invocation.
//
// PD.303 invariant: _tb.placeActivities === trip.placeActivities
// (same array by reference). No phase in this module may .slice()
// either side. Any pass that wants to filter must rebuild in place.
//
// Phase 7a (this module): the orchestrator delegates each phase
// implementation to the legacy function bodies (runCandidateSearch,
// generateActivitiesForPlace, enhanceDiscovery, _initialTripSave).
// Phase 7b will argumentize those phase bodies so they take explicit
// input instead of reading _tb. For now the orchestrator writes the
// input into _tb at entry; phases continue to read from there.

const global = /** @type {any} */ (globalThis);
  "use strict";

  // ── Lifecycle flag ────────────────────────────────────────────────
  //
  // PD.313: `isBuilding()` returns true between `build:start` and
  // `build:done` / `build:error`. The paste-list flow renders the
  // picker BEFORE MaxBuild fires, to show a loading state. The
  // picker's "no activities yet → auto-fire generateActivitiesForPlace
  // in 60ms" code path then races MaxBuild's own primary phase. Both
  // generateActivitiesForPlace invocations run; the second clobbers
  // the first plus the auto-Enhance additions. By checking
  // isBuilding() the picker can defer to the orchestrator.
  var _building = false;

  function isBuilding() { return _building; }
  var _phase = null;
  var _buildMode = null;
  function phase() { return _building ? _phase : null; }
  function mode() { return _building ? _buildMode : null; }

  // ── Event bus ──────────────────────────────────────────────────────
  //
  // Same pub-sub shape as TripStore's tripChange. Subscribers receive
  // a payload object. Errors thrown by subscribers are caught and
  // logged so a bad listener can't break a build.
  var _listeners = {};

  function on(event, fn) {
    if (!event || typeof fn !== "function") return function () {};
    (_listeners[event] = _listeners[event] || []).push(fn);
    // Return an unsubscriber.
    return function () {
      var arr = _listeners[event];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    };
  }

  function emit(event, payload) {
    // PD.363: track the current phase so UI surfaces (the build
    // banner) can re-derive their copy from STATE on any screen
    // change, instead of replaying stale event history.
    if (event && event.indexOf("build:") === 0) _phase = event;
    var arr = _listeners[event];
    if (!arr || !arr.length) return;
    // Copy so a listener that unsubscribes mid-loop doesn't shift the
    // iteration.
    arr.slice().forEach(function (fn) {
      try { fn(payload || {}); }
      catch (err) { console.warn("[MaxBuild] listener error for " + event + ":", err && err.message); }
    });
  }

  // ── Input contract ─────────────────────────────────────────────────
  //
  // Explicit, enumerated. The orchestrator does NOT read _tb for
  // anything in this list — callers must pass these fields. (Internal
  // phase implementations still read _tb until Phase 7b argumentizes
  // them; the bridge below copies input → _tb so legacy phases keep
  // working.)
  //
  // mode (required):
  //   "candidate-first" — sentence / Discovery brief. Primary phase
  //                       runs candidate-LLM.
  //   "activity-first"  — paste-list OR place-mode. Primary phase
  //                       runs activity-LLM via generateActivities-
  //                       ForPlace.
  //   "rebuild"         — saveActivityPickerEdits flow. Primary phase
  //                       reruns candidate-LLM but the orchestrator
  //                       SKIPS the mint phase (existing trip is
  //                       preserved). publishTrip on the other side
  //                       owns the destination-identity preservation.
  //
  // Common:
  //   region            — required string
  //   tripMode          — "sentence" | "place" | "paste" — historical
  //                       label routed through to legacy code
  //
  // candidate-first:
  //   sentence          — the brief's free-text intent
  //   anchors           — comma-separated must-dos
  //   requiredPlaces    — array of {place, country, requiredFor, ...}
  //                       precomputed by the caller; the orchestrator
  //                       forwards directly to runCandidateSearch.
  //
  // activity-first:
  //   placeName         — single place (place-mode) OR null
  //   placeContext      — context string (place-mode) OR null
  //   listedPlaces      — paste-list flow (forwarded via _tb)
  //
  // rebuild:
  //   (no extra inputs; preserves trip.id and existing wisp stream)
  //
  // Optional (any mode):
  //   reconcile         — async function() that runs AFTER mint and
  //                       BEFORE enhance. Mode-specific reconciliation
  //                       passes go here: paste-list passes backstop +
  //                       sight-reconcile + nights-apply; sentence-mode
  //                       typically passes nothing. Running before
  //                       enhance is load-bearing — the enhance phase's
  //                       skip list is built from _tb.placeActivities,
  //                       so any user-listed place that the primary LLM
  //                       dropped must be backstopped in BEFORE enhance
  //                       sees the skip list. Otherwise the dropped
  //                       places land in "Sights near places you listed"
  //                       as enhance enrichments and stick there.
  //
  // Returns a Promise that resolves when the build pipeline finishes
  // (or rejects if a fatal phase throws). The "handoff" phase fires
  // the appropriate UI transition.
  async function findCandidates(input) {
    input = input || {};
    var mode = input.mode;
    if (!mode || (mode !== "candidate-first" && mode !== "activity-first" && mode !== "rebuild")) {
      var err = new Error('[MaxBuild] findCandidates: input.mode must be "candidate-first" | "activity-first" | "rebuild"; got: ' + JSON.stringify(mode));
      emit("build:error", { error: err });
      throw err;
    }
    if (!input.region && mode !== "rebuild") {
      var err2 = new Error("[MaxBuild] findCandidates: input.region is required");
      emit("build:error", { error: err2 });
      throw err2;
    }

    emit("build:start", { mode: mode, region: input.region });
    // PD.313: flag set across the full build. Pickers and other UI
    // surfaces check `MaxBuild.isBuilding()` to skip their own
    // auto-fire codepaths (which would race with the orchestrator).
    _building = true;
    _buildMode = mode; // PD.394: surfaced via .mode() for banner copy

    // PD.319-4: snapshot pre-rebuild user state. Rebuild mode runs
    // the primary phase against the existing trip — publishTrip then
    // regenerates trip.destinations from candidates. Reservations,
    // bookings, day-items, suggestion flags (_considered, _rejected)
    // attached to surviving destinations MUST merge forward. Capture
    // here so we can hand it to MaxMerge at the end of the build.
    var _rebuildSnapshot = null;
    if (mode === "rebuild") {
      try {
        if (typeof global.TripStore !== "undefined"
            && global.TripStore.isLoaded
            && global.TripStore.isLoaded()) {
          // Deep clone — the snapshot can't share references with the
          // live trip or downstream mutations would corrupt it.
          _rebuildSnapshot = JSON.parse(JSON.stringify(global.TripStore.trip));
        }
      } catch (snapErr) {
        console.warn("[MaxBuild] could not snapshot pre-rebuild trip for merge:",
          snapErr && snapErr.message);
      }
    }

    try {
      // Phase 1: normalize input → _tb so legacy phases keep reading.
      _normalize(input);

      // Phase 2: primary LLM, mode-dispatched.
      var primaryResult = await _runPrimaryPhase(mode, input);
      emit("build:primary-done", { count: primaryResult.count, mode: mode });

      // Phase 3: mint (skipped for rebuild — preserves trip identity).
      if (mode !== "rebuild") {
        await _runMintPhase();
        emit("build:mint-done");
      }

      // Phase 4: reconcile. PD.310: MUST run BEFORE enhance so the
      // enhance phase's skip list (built from _tb.placeActivities)
      // includes user-listed places that the primary LLM dropped.
      // Otherwise Enhance's LLM suggests those dropped places as
      // "nearby sights," lands them in the enrichment section, and
      // backstop's token-coverage check then treats them as already
      // covered — they're stuck in the wrong section forever.
      if (typeof input.reconcile === "function") {
        try {
          await input.reconcile();
        } catch (recErr) {
          // Best-effort: reconcile failure should not abort the build.
          console.warn("[MaxBuild] reconcile failed (best-effort, continuing):",
            recErr && recErr.message);
        }
      }
      emit("build:reconcile-done");

      // Phase 5: enhance (best-effort) — FRESH BUILDS ONLY (PD.345).
      // A FRESH build runs enhance ONCE: the first time you create a trip,
      // Max hands you the richer, taste-shaped set up front. This is wanted.
      // REBUILDS (returning to Discovery to edit) NEVER enhance — an
      // unconditional enhance on every Discovery→edit→rebuild round-trip
      // ratcheted the unchecked-sights count up each cycle (observed 50 →
      // 187). After the first build, "✦ More like this" (MaxBuild.rerunEnhance)
      // is the explicit, user-initiated way to ask for another round; auto
      // enhance never fires again on its own.
      if (mode !== "rebuild") {
        var enhanceResult = await _runEnhancePhase();
        emit("build:enhance-done", { added: enhanceResult.added });
      } else {
        emit("build:enhance-done", { added: 0, skipped: "rebuild" });
      }

      // Phase 5b (rebuild only): merge user state from the snapshot
      // back into the regenerated trip. Reservations, bookings, day-
      // items, considered/rejected flags, etc. would otherwise be
      // dropped by the destination regeneration. PD.319-4 owns this.
      if (mode === "rebuild" && _rebuildSnapshot
          && typeof global.MaxMerge !== "undefined"
          && typeof global.MaxMerge.mergeUserStateIntoRegenerated === "function"
          && typeof global.TripStore !== "undefined"
          && global.TripStore.isLoaded
          && global.TripStore.isLoaded()) {
        try {
          var liveTrip = global.TripStore.trip;
          global.MaxMerge.mergeUserStateIntoRegenerated(_rebuildSnapshot, liveTrip);
          var preserved = global.MaxMerge.describePreservation(_rebuildSnapshot, liveTrip);
          console.log("[MaxBuild] rebuild user-state merge — preserved:", preserved);
          emit("build:merge-done", { preserved: preserved });
        } catch (mergeErr) {
          console.warn("[MaxBuild] rebuild user-state merge failed (best-effort, continuing):",
            mergeErr && mergeErr.message);
        }
      }

      // Phase 6: handoff. The legacy primary phase already either
      // showed the picker (showCandidateExplorer / renderActivity-
      // Picker) or fast-pathed to buildFromCandidates. So this is a
      // no-op event for subscribers that want to know "build is
      // done."
      var tripId = null;
      try {
        if (typeof global.TripStore !== "undefined"
            && global.TripStore.isLoaded
            && global.TripStore.isLoaded()) {
          tripId = global.TripStore.trip && global.TripStore.trip.id;
        }
      } catch (_) {}
      _building = false;
      emit("build:done", { tripId: tripId, mode: mode });
      return { tripId: tripId, mode: mode };
    } catch (err) {
      console.error("[MaxBuild] findCandidates failed:", err && err.message);
      _building = false;
      emit("build:error", { error: err, mode: mode });
      throw err;
    }
  }

  // ── Phase implementations (thin wrappers around legacy bodies) ─────

  function _normalize(input) {
    // The orchestrator copies explicit input → _tb so legacy phase
    // bodies can read from there. Writes only the contract fields;
    // does NOT clobber adjacent state (e.g. _tb.candidates from a
    // prior build are left alone for rebuild mode).
    var tb = global._tb;
    if (!tb) return; // _tb not yet initialized — caller will fail downstream, but log diagnostically
    if (typeof input.region === "string") tb.region = input.region;
    if (typeof input.sentence === "string") tb.intent = input.sentence;
    if (typeof input.anchors === "string") tb.anchors = input.anchors;
    if (typeof input.tripMode === "string") tb.tripMode = input.tripMode;
    if (typeof input.placeName === "string") tb.placeName = input.placeName;
    if (typeof input.placeContext === "string") tb.placeContext = input.placeContext;
    if (Array.isArray(input.requiredPlaces)) tb.requiredPlaces = input.requiredPlaces;
    if (Array.isArray(input.listedPlaces)) tb._pastedListPlaces = input.listedPlaces;
  }

  async function _runPrimaryPhase(mode, input) {
    emit("build:primary-start", { mode: mode });
    if (mode === "candidate-first" || mode === "rebuild") {
      // Two sub-paths inside the candidate-first phase:
      //   (a) Caller pre-computed requiredPlaces — go straight to
      //       runCandidateSearch (skips the must-do LLM extraction).
      //       Used by callers that already curated (place-mode
      //       picker, mdc-confirm, mdc-skip).
      //   (b) Caller did NOT precompute requiredPlaces — go through
      //       expandMustDos, which does the must-do LLM extraction
      //       (reading _tb.intent / _tb.anchors), then internally
      //       calls runCandidateSearch with the extracted set. Used
      //       by sentence-mode "Create my trip."
      var precomputed = Array.isArray(input.requiredPlaces);
      if (precomputed) {
        if (typeof global.runCandidateSearch !== "function") {
          throw new Error("[MaxBuild] runCandidateSearch not loaded");
        }
        await global.runCandidateSearch(input.requiredPlaces);
      } else {
        if (typeof global.expandMustDos !== "function") {
          throw new Error("[MaxBuild] expandMustDos not loaded");
        }
        await global.expandMustDos();
      }
      var n = (global._tb && Array.isArray(global._tb.candidates))
        ? global._tb.candidates.length : 0;
      return { count: n };
    }
    if (mode === "activity-first") {
      if (typeof global.generateActivitiesForPlace !== "function") {
        throw new Error("[MaxBuild] generateActivitiesForPlace not loaded");
      }
      await global.generateActivitiesForPlace();
      var nn = (global._tb && Array.isArray(global._tb.placeActivities))
        ? global._tb.placeActivities.length : 0;
      return { count: nn };
    }
    throw new Error("[MaxBuild] unknown mode: " + mode);
  }

  async function _runMintPhase() {
    // The orchestrator owns mint. Currently delegated to _initialTrip-
    // Save (which mints if not yet minted, syncs if already minted).
    // Phase 7b will collapse the 4 legacy _initialTripSave call sites
    // so this is the only invocation.
    if (typeof global._initialTripSave === "function") {
      global._initialTripSave();
    }
  }

  function _liveTrip() {
    try {
      return (global.TripStore && global.TripStore.isLoaded && global.TripStore.isLoaded())
        ? global.TripStore.trip : (typeof global.trip !== "undefined" ? global.trip : null);
    } catch (_) { return null; }
  }

  async function _runEnhancePhase() {
    if (typeof global.enhanceDiscovery !== "function") return { added: 0 };
    // ONE-TIME EVENT: auto-enhance runs the FIRST time Discovery is generated
    // for a trip and never automatically again — so NO path (fresh, rebuild,
    // re-open, or a mislabeled mode) can fire it twice. TWO independent signals,
    // either of which is decisive:
    //   1. An explicit stamp on trip.brief — brief survives publishTrip's
    //      rebuild (top-level trip fields do NOT, which is why the stamp lives
    //      on the brief, the trip's durable metadata).
    //   2. Lifecycle state: a first create reaches this phase BEFORE the trip
    //      has any destinations (those are produced later by publishTrip on
    //      commit); any re-open is against a trip that already HAS destinations.
    // The only thing that enhances again is the explicit "✦ More like this"
    // (rerunEnhance), which does not pass through here.
    var _t = _liveTrip();
    // PD.437: the ENHANCE CONTENT ITSELF is the most durable one-shot signal.
    // Auto-enhance appends a `type:"synthetic-enhance"` section; that section
    // lives in placeActivities and survives every reopen. So if the trip already
    // carries enhance content, auto-enhance has demonstrably run — never again,
    // even if `destinations` is empty (a contaminated trip) AND the brief stamp
    // was lost. This is what stops the "count grows a little on each trip↔
    // discovery navigation" drift: a re-entry can't re-fire what's already here.
    var _hasEnhanceContent = !!(_t && Array.isArray(_t.placeActivities) && _t.placeActivities.some(
      function (it) { return it && it.type === "synthetic-enhance"; }));
    var _alreadyBuilt = !!(_t && (
      _t._autoEnhancedAt ||
      (_t.brief && _t.brief._autoEnhancedAt) ||
      (Array.isArray(_t.destinations) && _t.destinations.length > 0) ||
      _hasEnhanceContent
    ));
    if (_alreadyBuilt) {
      return { added: 0, skipped: "not-first-discovery" };
    }
    // PD.310: emit build:enhance-start before the LLM await so
    // subscribers can show a phase-2 status during the wait.
    emit("build:enhance-start");
    try {
      var added = await global.enhanceDiscovery(null, {
        suppressToast: true,
        suppressMaxAlert: true,
        silentNoOp: true
      });
      // Stamp the trip so auto-enhance is permanently spent for it. The stamp
      // goes on trip.brief because that's what survives publishTrip's rebuild
      // (a bare top-level field is dropped on commit); the top-level copy keeps
      // in-session reads cheap before the brief exists.
      var _t2 = _liveTrip();
      if (_t2) {
        var _now = Date.now();
        _t2._autoEnhancedAt = _now;
        if (_t2.brief && typeof _t2.brief === "object") _t2.brief._autoEnhancedAt = _now;
        try {
          if (global.TripStore && typeof global.TripStore.touch === "function") {
            global.TripStore.touch("autoEnhanced");
          }
        } catch (_) {}
      }
      return { added: added || 0 };
    } catch (err) {
      // Best-effort. A failed enhance does not abort the build.
      console.warn("[MaxBuild] enhance failed (best-effort, continuing):",
        err && err.message);
      return { added: 0 };
    }
  }

  // Standalone re-run of the enhance phase. The "✦ More like this"
  // button calls this. Subscribers still get phase events so loading
  // UI can react. Unlike the auto-Enhance pass inside findCandidates,
  // this one emits its own start event so subscribers can distinguish
  // "build-time enhance" vs "manual enhance" if they want.
  async function rerunEnhance() {
    emit("enhance:start");
    try {
      var added = await global.enhanceDiscovery(null, {
        suppressToast: false,    // manual click → show the toast
        suppressMaxAlert: false, // manual click → show errors
        silentNoOp: false        // manual click → tell user nothing to enhance
      });
      emit("enhance:done", { added: added || 0 });
      return { added: added || 0 };
    } catch (err) {
      emit("enhance:error", { error: err });
      throw err;
    }
  }

  // ── Diagnostics ───────────────────────────────────────────────────

  function _diagnostic() {
    return {
      listeners: Object.keys(_listeners).reduce(function (acc, k) {
        acc[k] = (_listeners[k] || []).length;
        return acc;
      }, {})
    };
  }

  // ── Export ────────────────────────────────────────────────────────

  global.MaxBuild = {
    findCandidates: findCandidates,
    rerunEnhance:   rerunEnhance,
    isBuilding:     isBuilding,
    phase:          phase,
    mode:           mode,
    on:             on,
    _diagnostic:    _diagnostic
  };



/* #2 Stage 2 interim: expose this module's non-colliding top-level bindings
   as globals (restores pre-ESM flat-script behavior for bare-global + window.*
   consumers, incl. app-main.js boot refs). esbuild isolates each .mjs to an IIFE;
   any-cast keeps it tsc-valid; the import-rewiring phase removes this. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._building = _building;
  __expg.isBuilding = isBuilding;
  __expg._phase = _phase;
  __expg._buildMode = _buildMode;
  __expg.phase = phase;
  __expg.mode = mode;
  __expg._normalize = _normalize;
  __expg._runPrimaryPhase = _runPrimaryPhase;
  __expg._runMintPhase = _runMintPhase;
  __expg._liveTrip = _liveTrip;
  __expg._runEnhancePhase = _runEnhancePhase;
  __expg.rerunEnhance = rerunEnhance;
  __expg._diagnostic = _diagnostic;
}

export {};
