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

(function (global) {
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
    // PD.311: diagnostic logging at phase boundaries so a failed build
    // leaves a paper trail. Without these, a stalled build (LLM hang,
    // silent no-op, exception swallowed downstream) is invisible.
    console.log("[MaxBuild] start — mode:", mode, "region:", input.region);
    // PD.313: flag set across the full build. Pickers and other UI
    // surfaces check `MaxBuild.isBuilding()` to skip their own
    // auto-fire codepaths (which would race with the orchestrator).
    _building = true;

    try {
      // Phase 1: normalize.
      _normalize(input);
      console.log("[MaxBuild] normalize done — _tb.placeName:", _readTb("placeName"),
        "_tb.region:", _readTb("region"),
        "_tb.placeContext.len:", (_readTb("placeContext") || "").length,
        "_tb._pastedListPlaces.len:", (_readTb("_pastedListPlaces") || []).length);

      // Phase 2: primary LLM, mode-dispatched.
      console.log("[MaxBuild] phase: primary (start)");
      var primaryResult = await _runPrimaryPhase(mode, input);
      console.log("[MaxBuild] phase: primary (done) — count:", primaryResult.count,
        "_tb.placeActivities.len:", (_readTb("placeActivities") || []).length,
        "_tb.candidates.len:", (_readTb("candidates") || []).length);
      emit("build:primary-done", { count: primaryResult.count, mode: mode });

      // Phase 3: mint (or skip for rebuild).
      if (mode !== "rebuild") {
        console.log("[MaxBuild] phase: mint (start)");
        await _runMintPhase();
        console.log("[MaxBuild] phase: mint (done) — _currentTripId:", global._currentTripId);
        emit("build:mint-done");
      } else {
        console.log("[MaxBuild] phase: mint SKIPPED (rebuild mode)");
      }

      // Phase 4: reconcile.
      if (typeof input.reconcile === "function") {
        console.log("[MaxBuild] phase: reconcile (start)");
        try {
          await input.reconcile();
        } catch (recErr) {
          console.warn("[MaxBuild] reconcile phase failed (best-effort, continuing):",
            recErr && recErr.message);
        }
        console.log("[MaxBuild] phase: reconcile (done) — _tb.placeActivities.len:",
          (_readTb("placeActivities") || []).length);
      } else {
        console.log("[MaxBuild] phase: reconcile SKIPPED (no callback supplied)");
      }
      emit("build:reconcile-done");

      // Phase 5: enhance (always, best-effort).
      console.log("[MaxBuild] phase: enhance (start) — _tb.candidates.len:",
        (_readTb("candidates") || []).length,
        "_tb.placeActivities.len:", (_readTb("placeActivities") || []).length);
      var enhanceResult = await _runEnhancePhase();
      console.log("[MaxBuild] phase: enhance (done) — added:", enhanceResult.added,
        "_tb.candidates.len:", (_readTb("candidates") || []).length,
        "_tb.placeActivities.len:", (_readTb("placeActivities") || []).length);
      emit("build:enhance-done", { added: enhanceResult.added });

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
      console.log("[MaxBuild] done — tripId:", tripId);
      _building = false;
      emit("build:done", { tripId: tripId, mode: mode });
      return { tripId: tripId, mode: mode };
    } catch (err) {
      console.error("[MaxBuild] findCandidates failed:", err && err.message, err && err.stack);
      _building = false;
      emit("build:error", { error: err, mode: mode });
      throw err;
    }
  }

  // ── Phase implementations (thin wrappers around legacy bodies) ─────

  function _readTb(field) {
    return global._tb && global._tb[field];
  }

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

  async function _runEnhancePhase() {
    // PD.310 fix: emit build:enhance-start so subscribers (paste-list
    // banner, sentence-mode candidate-explorer loading copy) can show
    // a phase-2 status. The earlier MaxBuild only emitted enhance-done,
    // not enhance-start — so the banner never fired and the user could
    // not see that anything was happening during the ~30-60s wait.
    emit("build:enhance-start");
    if (typeof global.enhanceDiscovery !== "function") {
      console.warn("[MaxBuild] enhanceDiscovery not loaded; skipping enhance phase");
      return { added: 0 };
    }
    try {
      var added = await global.enhanceDiscovery(null, {
        suppressToast: true,
        suppressMaxAlert: true,
        silentNoOp: true
      });
      return { added: added || 0 };
    } catch (err) {
      // Best-effort. A failed enhance does not abort the build.
      console.warn("[MaxBuild] enhance phase failed (best-effort, continuing):",
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
    on:             on,
    _diagnostic:    _diagnostic
  };

})(typeof globalThis !== "undefined" ? globalThis : window);
