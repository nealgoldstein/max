// geography-model.js — geography model + MaxRoleWriter (Round NC.X). Extracted from
// index.html (PD.458). Self-contained window.MaxRoleWriter exposure travels with its def.

// ── Geography model (Round NC.X) ──────────────────────────────────
// A trip takes place inside a GEOGRAPHY — a political/cultural
// boundary like Iceland, the American Southwest, Paris. Inside that
// trip geography, a SIGHT is a physical place (the Matterhorn, the
// Louvre, Gullfoss). A DESTINATION is a sub-geography inside the trip
// that has lodging — it's the only kind of place you spend a night.
//
// Every sight belongs to exactly one geography. The user decides
// which by picking a role:
//   - role=stay      → this place IS a destination (its own geography)
//   - role=daytrip   → this sight lives in destination {hub}'s geography
//   - role=onway     → this sight lives in the TRIP's geography
//   - role=see       → undecided which geography it belongs to yet
//   - role=maybe     → user hasn't decided whether to include it at all
//   - role=reject    → user said no — geography is irrelevant
//
// _geographyOf(place) answers "which geography does this place belong
// to" — used by other code that wants to ask the question directly
// instead of pattern-matching on c.role + _dayTripHub + _waysideFromHub
// each time.
//
// Input: a place name string, a candidate object, or a requiredPlace
// object. Returns { kind, hub? } where:
//   kind = "destination" → the place IS a destination (Stay)
//   kind = "in-destination" → lives inside {hub}'s geography (Day trip)
//   kind = "trip" → lives in the trip's geography (Onway / undecided See)
//   kind = "none" → user hasn't kept it (Maybe / Reject)
function _geographyOf(place) {
  if (!place) return { kind: "none" };
  var name, candRole, candStatus, dayTripHub, waysideFromHub, isKept, isRejected;
  if (typeof place === "string") {
    name = place;
  } else {
    // Candidate object, requiredPlace, or destination-like
    name = place.place || place.name || "";
    candRole = place.role;
    candStatus = place.status;
    dayTripHub = place._dayTripHub || place.dayTripHub || "";
    waysideFromHub = place._waysideFromHub || place.waysideFromHub || "";
    isKept = (place._keep === true) || (place.status === "keep");
    isRejected = (place._rejected === true) || (place.status === "reject");
  }
  if (isRejected) return { kind: "none" };
  // If we got a name only, look it up across _tb.candidates and
  // _tb.placeActivities for richer state.
  if (typeof place === "string" && _tb) {
    var norm = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase(); };
    var key = norm(name);
    if (Array.isArray(_tb.candidates)) {
      var c = _tb.candidates.find(function(x){ return x && x.place && norm(x.place) === key; });
      if (c) {
        candRole = candRole || c.role;
        candStatus = candStatus || c.status;
        if (c.status === "reject") return { kind: "none" };
      }
    }
    // Walk placeActivities for requiredPlace flags as a fallback.
    if (!dayTripHub || !waysideFromHub || isKept === undefined) {
      (_tb.placeActivities || []).some(function(it){
        return (it.requiredPlaces || []).some(function(p){
          if (!p || !p.place || norm(p.place) !== key) return false;
          if (!dayTripHub && p._dayTripHub) dayTripHub = p._dayTripHub;
          if (!waysideFromHub && p._waysideFromHub) waysideFromHub = p._waysideFromHub;
          if (isKept === undefined) isKept = !!p._keep;
          if (p._rejected === true) isRejected = true;
          return false;
        });
      });
      if (isRejected) return { kind: "none" };
    }
  }
  // Maybe (unkept + not rejected) = no geography assignment.
  if (isKept === false && !candRole) return { kind: "none" };
  if (candRole === "stay")    return { kind: "destination" };
  if (candRole === "daytrip") return { kind: "in-destination", hub: dayTripHub || "" };
  if (candRole === "onway")   return { kind: "trip", from: waysideFromHub || "" };
  if (candRole === "see")     return { kind: "trip" }; // undecided See defaults to trip geography
  // No explicit role — fall back to flag-based inference.
  if (dayTripHub)     return { kind: "in-destination", hub: dayTripHub };
  if (waysideFromHub) return { kind: "trip", from: waysideFromHub };
  if (isKept)         return { kind: "destination" };
  return { kind: "none" };
}
if (typeof globalThis !== "undefined") globalThis._geographyOf = _geographyOf;

// ────────────────────────────────────────────────────────────────────────
// MaxRoleWriter — the single source of truth for writing a candidate's
// role and its derived state. Mirrors the MaxMapPin pattern: 8 scattered
// writers (with slightly different rules each) collapse into one.
//
// What it writes, atomically, on every role change:
//   • c.role             — NC.3 source of truth for role
//   • c._roleTouched     — true once user (or popup) commits a role
//   • c.status           — "keep" for stay/see/daytrip/onway, null for
//                          maybe, "reject" for reject
//   • c.dayTripHub       — set for daytrip, cleared otherwise
//   • c.waysideFromHub   — set for onway, cleared otherwise
//   • placeMeta[k].stayOverride
//                        — true for stay, false for see, null otherwise
//                          (consistent for the chip's read-path)
//   • placeActivities[*].requiredPlaces[*]._isDayTrip / _dayTripHub /
//     _waysideFromHub / _keep / _rejected
//                        — flag mirrors used by all the surfaces that
//                          haven't been migrated off legacy flags
//
// What it does NOT do (callers handle):
//   • Manipulate trip.routes (convertDest* helpers do this AFTER calling)
//   • Re-render the map / list (callers fire UI refresh after)
//   • Open/close popups
//
// API:
//   MaxRoleWriter.set(idOrPlace, role, opts)
//     idOrPlace : candidate.id OR place name (lowercased lookup, both tried)
//     role      : "stay" | "see" | "daytrip" | "onway" | "maybe" | "reject"
//     opts      : { hub, persist }
//       hub     : hub place name (for daytrip/onway); lowercased internally
//       persist : call autoSave after write (default true)
//     → returns the mutated candidate, or null if not found.
//
// Validation:
//   • Invalid role values → no-op, returns null.
//   • Place name lookup uses _normPlaceName (case+diacritic).
//   • Stay is allowed regardless of overnightCapable — explicit user
//     pick wins (the engine's setRole still guards; this is the UI
//     write path).
// ════════════════════════════════════════════════════════════════════
// MaxRoleWriter — the SINGLE source of truth for role-affecting writes.
// ════════════════════════════════════════════════════════════════════
//
// CONTRACT (architectural invariant — Round PD.15):
//
//   Any code that needs to change a place's role / kept / rejected /
//   stay state MUST go through MaxRoleWriter.set(placeOrId, role).
//   Direct writes to any of the following fields are FORBIDDEN
//   outside this writer and the explicitly-justified exceptions
//   listed below:
//
//     cand.role           cand._roleTouched     cand.status
//     cand.dayTripHub     cand.waysideFromHub   cand.intent
//     placeMeta.stayOverride
//     requiredPlace._keep        requiredPlace._isDayTrip
//     requiredPlace._dayTripHub  requiredPlace._waysideFromHub
//     requiredPlace._rejected
//
//   Why: these fields appear on three surfaces (candidate, placeMeta,
//   requiredPlace flags) that the cascade (_pmDeriveRole +
//   _pmIsStayCandidate) reads independently. If any writer touches
//   only one of the three, the surfaces silently disagree —
//   the Mývatn / Selfoss / Diamond Beach class of bug that has
//   cost multiple sessions to chase. MaxRoleWriter.set updates all
//   three atomically AND fires an event. No exceptions for "just
//   this one field" — that's exactly how the bug class got rebuilt
//   in PD.12.
//
// LEGITIMATE EXCEPTIONS (do NOT add to this list without justification):
//
//   1. Initial seeding in expandMustDos / runCandidateSearch
//      (index.html ~14306, ~10199). These run BEFORE any candidate
//      exists; they bootstrap the requiredPlace flags from item.checked
//      derived from iconic + intent-match. After seeding, all
//      mutations route through MaxRoleWriter.
//
//   2. Per-activity-ref intent toggles togglePlaceActivity /
//      togglePlaceInActivity (index.html ~16985, ~17105). These
//      modify a single activity-ref's _keep flag. NOT bookkeeping
//      noise — they track INTENT: "I want Egilsstadir for the
//      aurora, not for the cafés." When the LLM seeds different
//      activities differently for the same place, the sub-row
//      checkboxes can legitimately disagree with the place row.
//      Routing through MaxRoleWriter would collapse all refs to
//      the same state, destroying the per-intent distinction. The
//      writer is for place-level state; sub-row toggles are for
//      intent-level state. The place-level keep toggles
//      (toggleDestKeep, togglePlaceByPlaceMode, toggleDestKeepInSection)
//      DO route through MaxRoleWriter as of PD.16.
//
//   3. normalizeCandidateRole (engine-picker.js 172) is a READ
//      that COERCES a legacy-shaped role into the canonical
//      stay/see/daytrip/onway set. It's idempotent and called
//      from render paths; not a true write.
//
//   4. reopenPickerForEdit's hydration bridge (index.html ~26168).
//      Copies trip.candidates[*].role → _tb.placeMeta[].stayOverride
//      on picker reopen. Not a user mutation; it's restoring picker
//      view-state from the trip's source-of-truth data.
//
//   5. _ensureMdcItemsPlaceMeta (index.html ~38780). Trip-view writer
//      side-effect — mirrors a trip-view role change into _tb.placeMeta
//      so the picker reads right on next open. The trip-view path
//      is authoritative; this is a downstream mirror. Should
//      eventually live behind its own atomic writer; queued.
//
// Migrated through MaxRoleWriter as of PD.16 (formerly false
// exceptions): the place-level list-keep toggles + publishTrip's
// stayOverride and predictor bridges in engine-picker.js. Both used
// to be called "legitimate" but were rationalizations — they wrote
// fields the cascade reads, so cross-surface drift was structurally
// possible. Now they go through the writer like everything else.
//
// Anything else writing these fields is a bug. If you find a new
// case that "needs" to bypass MaxRoleWriter, the answer is almost
// always: add a method to MaxRoleWriter, not a parallel path.
//
// P4.4d: _mirrorCandToTrip / MaxRoleWriter.mirror DELETED. _tb.candidates and
// trip.candidates are now ONE shared array (the picker hydrations share the
// reference, like the trip view), so a working candidate IS its published-
// snapshot twin — there is nothing to project. The lean persisted shape is
// regenerated from the working model via MaxCandidates.snapshotFrom at save
// (publishTrip / applyCandidateChanges). The dual-shape bookkeeping is gone.

// P4.4c: record a wayside's leg as a DECISION (where the user placed it),
// keyed by place identity, next to role/hub. Called at the wayside-assignment
// sites so the leg lives in the decision log — the source publishTrip now
// reads — rather than only on the working candidate. Idempotent; preserves
// any existing hub on the place's decision.
function _recordWaysideLegDecision(place, fromPlace, toPlace) {
  try {
    if (typeof MaxDecisions === "undefined" || !MaxDecisions) return;
    if (typeof _tb === "undefined" || !_tb) return;
    if (!_tb._decisions) _tb._decisions = new MaxDecisions.Decisions();
    var prev = _tb._decisions.get(place);
    _tb._decisions.set(place, {
      kept: true,
      rejected: false,
      role: "onway",
      hub: (prev && prev.hub) || "",
      leg: { fromPlace: fromPlace || "", toPlace: toPlace || "" }
    });
  } catch (_) {}
}
if (typeof globalThis !== "undefined") globalThis._recordWaysideLegDecision = _recordWaysideLegDecision;

var MaxRoleWriter = {
  set: function(idOrPlace, role, opts){
    opts = opts || {};
    if (typeof _tb === "undefined" || !_tb || !Array.isArray(_tb.candidates)) return null;
    var validActive = { stay: 1, see: 1, daytrip: 1, onway: 1 };
    var validAll = { stay: 1, see: 1, daytrip: 1, onway: 1, maybe: 1, reject: 1 };
    if (!validAll[role]) return null;
    var norm = (typeof _normPlaceName === "function")
      ? _normPlaceName
      : function(s){ return String(s||"").toLowerCase().trim(); };
    // Find candidate by id, then by normalized place name.
    var cand = _tb.candidates.find(function(c){ return c && c.id === idOrPlace; });
    if (!cand) {
      var k = norm(idOrPlace);
      cand = _tb.candidates.find(function(c){ return c && c.place && norm(c.place) === k; });
    }
    if (!cand) return null;
    var prev = cand.role || null;
    var hub = opts.hub ? String(opts.hub).toLowerCase() : "";
    // PD.454 (architectural): ONE definition of what a role DOES to a candidate,
    // applied to BOTH the working copy (_tb.candidates) and the published
    // snapshot (trip.candidates) below. Before this, the same role/status/hub/
    // intent mutation was written out twice — here and in the trip-mirror — and
    // the two copies drifted, which is how "I set Selfoss to Stay and it
    // published as a Day trip" happened. Now they share one mutator and cannot
    // disagree. Side effects that belong only to the working model (rejection
    // history) stay OUTSIDE this pure mutator.
    function _applyRoleTo(c){
      if (!c) return;
      if (validActive[role]) {
        c.role = role;
        c._roleTouched = true;
        c.status = "keep";
        if (role === "daytrip") {
          c.dayTripHub = hub || c.dayTripHub || "";
          c.waysideFromHub = "";
          c.intent = "dayTrip";  // NC.9.4: align intent with role
        } else if (role === "onway") {
          c.waysideFromHub = hub || c.waysideFromHub || "";
          c.dayTripHub = "";
          c.intent = "wayside";  // NC.9.4
        } else {
          // stay / see — clear stale hubs so _pmDeriveRole's validation cascade
          // doesn't find a ghost hub, and clear `intent` so the publishTrip
          // day-trip / wayside commit passes (which filter by intent) don't
          // treat this candidate as a day-trip / wayside on the next publish.
          c.dayTripHub = "";
          c.waysideFromHub = "";
          c.intent = "";
        }
      } else if (role === "maybe") {
        // Maybe doesn't touch c.role (user hasn't decided), so we leave
        // _roleTouched alone too. status=null is what _pmDeriveRole reads.
        c.status = null;
      } else if (role === "reject") {
        c.status = "reject";
        c._roleTouched = true;
      }
    }
    _applyRoleTo(cand);
    if (role === "reject") {
      // PD.151: rejection history (working model ONLY) so the user can undo.
      try {
        if (!_tb._rejectionHistory) _tb._rejectionHistory = [];
        // De-dup by id (if a place is re-rejected, refresh its entry).
        _tb._rejectionHistory = _tb._rejectionHistory.filter(function(r){
          return r && r.id !== cand.id;
        });
        _tb._rejectionHistory.push({
          id: cand.id,
          place: cand.place,
          prevRole: (prev && prev !== "reject") ? prev : "see",
          ts: Date.now()
        });
        // Cap at last 20 to avoid unbounded growth.
        if (_tb._rejectionHistory.length > 20) {
          _tb._rejectionHistory = _tb._rejectionHistory.slice(-20);
        }
      } catch(_){}
    }
    // ── placeMeta.stayOverride ──────────────────────────────────────
    try {
      if (typeof _pmPlaceMeta === "function") {
        var m = _pmPlaceMeta(cand.place, { create: true });
        if (m) {
          if (role === "stay")      m.stayOverride = true;
          else if (role === "see")  m.stayOverride = false;
          else                       m.stayOverride = null;
        }
      }
    } catch(_){}
    // ── requiredPlace flag mirrors ──────────────────────────────────
    // PD.86 (architectural): match candidates → requiredPlaces by
    // _normPlaceName, not raw toLowerCase. The LLM sometimes returns
    // a requiredPlace with a country suffix ("Akureyri, Iceland")
    // while the candidate is just "Akureyri"; raw lowercase didn't
    // match, so MaxRoleWriter set the candidate's role but never
    // flipped p._keep on the requiredPlace, and the map kept showing
    // the pin gray. _normPlaceName collapses diacritics, punctuation,
    // and whitespace so all the cousin spellings line up — the same
    // normalizer used by _pmEnsureCandidate, _pmMetaKey, and the
    // picker's candidate lookups elsewhere.
    try {
      if (Array.isArray(_tb.placeActivities)) {
        var _nrm = (typeof _normPlaceName === "function")
          ? _normPlaceName
          : function(s){ return String(s||"").toLowerCase().trim(); };
        var canon = _nrm(cand.place || "");
        var keep = (role !== "maybe" && role !== "reject");
        var rejected = (role === "reject");
        _tb.placeActivities.forEach(function(item){
          if (!item || !Array.isArray(item.requiredPlaces)) return;
          item.requiredPlaces.forEach(function(p){
            if (!p || !p.place) return;
            if (_nrm(p.place) !== canon) return;
            p._isDayTrip = (role === "daytrip");
            p._dayTripHub = (role === "daytrip") ? hub : "";
            p._waysideFromHub = (role === "onway") ? hub : "";
            p._keep = keep;
            p._rejected = rejected;
            // PD.452 (architectural): every user action through this writer —
            // keep, see, daytrip, onway, AND uncheck ("maybe") / reject — stamps
            // a DURABLE decision marker on the record. This is the single bit the
            // keep-derivation reads: "_decided" means the user made a call, so
            // honor the stored _keep verbatim; absent it, keep is a pure default
            // (your places on, Max's suggestions off). Before this, "maybe" wrote
            // nothing durable, so the build-default re-checked an unchecked place
            // every render — the bug that forced all the referee passes.
            p._decided = true;
          });
        });
      }
    } catch(_){}
    // P4.4d: no mirror — _tb.candidates IS trip.candidates (one shared array),
    // so the mutations above already update the published snapshot. The lean
    // persisted shape is regenerated via MaxCandidates.snapshotFrom at save.
    // P4.2 (shadow mode): record this user decision into the canonical decision
    // log, IN PARALLEL with the record flags above. Not yet load-bearing — it
    // exists so we can prove the log + the live records agree (keepOf == _keep)
    // before cutting the derivation over to the log in P4.3.
    try {
      if (typeof MaxDecisions !== "undefined" && MaxDecisions && typeof _tb !== "undefined" && _tb) {
        if (!_tb._decisions) _tb._decisions = new MaxDecisions.Decisions();
        var _kept = (role === "reject" || role === "maybe") ? false : true;
        _tb._decisions.set(cand.place, {
          kept: _kept,
          rejected: (role === "reject"),
          role: validActive[role] ? role : (cand.role || null),
          hub: hub,
          leg: opts.leg || null   // P4.4c: a wayside's leg travels on the decision
        });
      }
    } catch (_) {}
    // ── Event emission (engine event bus) ───────────────────────────
    try {
      if (typeof MaxEnginePicker !== "undefined"
          && typeof MaxEnginePicker.emit === "function"
          && cand.id) {
        MaxEnginePicker.emit("candidateChange", { id: cand.id, role: role, prevRole: prev });
      }
    } catch(_){}
    // ── Persistence ─────────────────────────────────────────────────
    if (opts.persist !== false && typeof autoSave === "function") {
      try { autoSave(); } catch(_){}
    }
    return cand;
  }
};
if (typeof window !== "undefined") window.MaxRoleWriter = MaxRoleWriter;

// PD.456 (perfect-model #1/#4): the ONE projection from a working candidate to
// its PERSISTED snapshot shape. trip.candidates is born here and only here — a
// pure function of the working model. P4.4d: the working buffer and the snapshot
// are now one shared array, so there's nothing to keep "in step" between
// publishes — at save, snapshotFrom() regenerates the lean persisted copy from
// the working model, the single definition of the durable shape.
var MaxCandidates = {
  // working candidate -> persisted snapshot object (the durable field subset)
  snapshotOf: function (c) {
    if (!c) return null;
    return {
      id: c.id, place: c.place, country: c.country || null, role: c.role || null,
      whyItFits: c.whyItFits || "", tags: c.tags || [], tradeoffs: c.tradeoffs || null,
      stayRange: c.stayRange || "", lat: c.lat || null, lng: c.lng || null,
      nights: (typeof c.nights === "number") ? c.nights : undefined,
      status: c.status || null, _required: !!c._required, _requiredFor: (c._requiredFor || []).slice(),
      overnightCapable: (typeof c.overnightCapable === "boolean") ? c.overnightCapable : null,
      intent: c.intent || undefined,
      dayTripHub: c.dayTripHub || undefined,
      _roleTouched: !!c._roleTouched,
      waysideFromHub: c.waysideFromHub || undefined,
      // Round HZ: persist the user's manual sequence + manual-pin flag so a
      // reopened picker re-acquires their order. The applyCandidateChanges
      // projection carried these but publishTrip's did NOT — unifying both
      // through this one function fixes that silent order-loss on publish.
      order: (typeof c.order === "number") ? c.order : null,
      manuallyOrdered: !!c.manuallyOrdered
    };
  },
  // working list -> persisted snapshot list (drops nothing; pure map)
  snapshotFrom: function (list) {
    return (Array.isArray(list) ? list : []).map(MaxCandidates.snapshotOf).filter(Boolean);
  }
};
if (typeof window !== "undefined") window.MaxCandidates = MaxCandidates;
if (typeof globalThis !== "undefined") globalThis.MaxCandidates = MaxCandidates;

// ──────────────────────────────────────────────────────────────────────
// Round PD.73 / PD.330: trip lifecycle.
//
//   _initialTripSave()    — runs at LLM completion (in runCandidateSearch
//                            and expandMustDos). Mints a trip from _tb
//                            substance the first time the LLM gives us
//                            something resumable, then schedules sync.
//
//   _dispatchRoute()      — reads MaxRoute.parse() and renders the
//                            matching screen. The URL is the source of
//                            truth; renderers don't stamp anymore.
//
// (PD.330 deleted: _recordScreen + _restoreLastScreen + trip._lastScreen.
//  The URL was always the right place for screen state; the legacy
//  per-trip stamp leaked into the synced body and forced symmetric
//  bookkeeping that drift bugs lived in.)
//
// Trip name lives on trip.name. We derive an initial one from _tb.region
// or _tb.sentence; the user can rename inline on the trip view header.
// ──────────────────────────────────────────────────────────────────────
function _initialTripSave(opts){
  if (typeof _tb === "undefined" || !_tb) return;
  // Only mint when we have substance — at least candidates OR
  // placeActivities — UNLESS the caller forces it (PD.359: build
  // start mints BEFORE the LLM runs, so the trip is the durable
  // record from the first moment of generation).
  var hasCands = Array.isArray(_tb.candidates) && _tb.candidates.length;
  var hasActs  = Array.isArray(_tb.placeActivities) && _tb.placeActivities.length;
  if (!hasCands && !hasActs && !(opts && opts.force)) return;

  // ARCH Phase 3: route through TripStore. The function still does
  // the same work but each state change is a named mutator inside a
  // batch — one atomic transaction, one tripChange emit, one persist.
  // The destination-loss class is closed by construction: TripStore.mint
  // assigns trip.id at creation; existing-trip syncs go through
  // updateBrief / setName / setCandidates / setPlaceActivities; no
  // path can wipe destinations because the mutators don't touch them.
  // Falls back to the legacy inline pattern if TripStore isn't loaded
  // yet (defensive — shouldn't happen given script ordering).
  if (typeof TripStore === "undefined") {
    console.warn("[Max] _initialTripSave: TripStore not loaded, skipping");
    return;
  }

  if (!_currentTripId) {
    // Mint a brand-new trip. Builds initial brief from _tb, then
    // populates name + candidates + placeActivities inside the same
    // batch so the whole mint+populate is one atomic transition.
    //
    // PD.328: Single source of truth for the trip name is the picker.
    // _tb.name carries whatever the picker decided — whether the user
    // typed it or the picker filled in a default. _initialTripSave is
    // NOT in the name-derivation business and does not decorate.
    // Previously this function appended `" — " + today's date` onto
    // whatever was in _tb.name, region, or placeName, which produced
    // "<picker default> — <date>" — and once the picker default
    // started including its own date ("6:07 — Jun 6, 2026"), the
    // suffix appeared twice ("6:07 — Jun 6, 2026 — Jun 6, 2026").
    // No more decoration here. The picker owns the name.
    var _initName = (_tb.name && _tb.name.trim()) || "Untitled";
    var initialBrief = {
      region:   _tb.region   || "",
      sentence: _tb.sentence || ""
    };
    // PD.429: the listed set is NO LONGER persisted as a parallel map on the
    // brief. Listed-ness lives on the records (_origin:"user", baked at build),
    // and the raw user input survives in tripMeta.notes below as the deep
    // migration seed. (initialBrief._userListedNames intentionally not written.)
    if (_tb.tripMeta) {
      initialBrief.tripMeta = {};
      if (_tb.tripMeta.notes) initialBrief.tripMeta.notes = _tb.tripMeta.notes;
      if (Array.isArray(_tb.tripMeta.links)) initialBrief.tripMeta.links = _tb.tripMeta.links.slice();
    }
    // PD.356: snapshot the drafts BEFORE mint. _tb.placeActivities
    // is a routed view — the moment mint() loads the store, the
    // getter flips from the pre-mint buffer to trip.placeActivities,
    // so reading it after mint would adopt an empty array and orphan
    // the draft. Read once, pre-flip, then hand to the store.
    var _paDraft   = _tb.placeActivities || [];
    var _candDraft = _tb.candidates     || [];
    TripStore.batch(function(){
      TripStore.mint(initialBrief);
      TripStore.setName(_initName);
      // PD.303: pass arrays BY REFERENCE (no .slice). This is the
      // architectural bridge invariant: _tb.placeActivities and
      // trip.placeActivities must be the same array so any direct
      // mutation (reconciliation pushing sights into sections, fold
      // dropping duplicates, etc.) is visible to both. The original
      // .slice() copies broke that invariant — reconciliation's
      // mutations on _tb would land on the OLD array while
      // trip.placeActivities held the COPY, and subsequent renders
      // saw stale data.
      TripStore.setCandidates(_candDraft);
      TripStore.setPlaceActivities(_paDraft);
    }, "initial-mint");
    _currentTripId = TripStore.trip.id;

    // External integrations (index, sync) — these aren't trip state,
    // they're catalog metadata. Stays as direct calls.
    var indexEntry = {
      id:        _currentTripId,
      name:      TripStore.trip.name,
      dateRange: "",
      destCount: 0
    };
    // PD.327: single mutator dedups by id AND mirrors to MaxDB.index.
    // Was a try/MaxDB.upsert with raw _tripsIndex.push fallback —
    // the fallback could land a duplicate row if MaxDB.upsert silently
    // failed but the index was already populated.
    try { _upsertTripIndexEntry(indexEntry); } catch(_) {}
    if (typeof MaxSync !== "undefined" && MaxSync.isSignedIn && MaxSync.isSignedIn()
        && typeof MaxSync.scheduleSave === "function") {
      try { MaxSync.scheduleSave(); } catch(_){}
    }
    console.log("[Max] initial trip save — minted", _currentTripId, "name:", TripStore.trip.name);
    // PD.336: the trip exists now — it IS the draft. Clear the
    // pre-trip brief draft so it can't bleed into the next new trip.
    try { localStorage.removeItem("max-brief-draft"); } catch(_){}
    // PD.331: the trip now has an identity — if the user is sitting in
    // Discovery (they are: the mint fires at LLM completion inside the
    // picker), put the discovery route in the URL immediately so a
    // hard refresh from this moment on restores Discovery. Before
    // this, a brand-new trip's whole Discovery session ran with no
    // tripId in the URL: refresh booted to home or, once something
    // stamped the bare trip route, to an empty trip view. replace —
    // bookkeeping, not navigation; the picker is already rendered.
    try {
      var _pkOvMint = document.getElementById("trip-brief-overlay");
      if (typeof MaxRoute !== "undefined" && _currentTripId
          && _pkOvMint && _pkOvMint.style.display && _pkOvMint.style.display !== "none") {
        MaxRoute.navigate({ screen: MaxRoute.SCREENS.DISCOVERY, tripId: _currentTripId }, { replace: true });
      }
    } catch(_){}
  } else {
    // Existing trip. Sync the latest _tb substance via TripStore
    // mutators in a single batch.
    TripStore.batch(function(){
      // PD.303: pass arrays BY REFERENCE (see comment in mint branch
      // above). Bridge invariant.
      TripStore.setCandidates(_tb.candidates || []);
      TripStore.setPlaceActivities(_tb.placeActivities || []);
      var briefUpdates = {};
      if (_tb.region)   briefUpdates.region   = _tb.region;
      if (_tb.sentence) briefUpdates.sentence = _tb.sentence;
      // PD.429: listed set no longer persisted as a parallel brief map — it
      // derives from the records' baked _origin:"user". (See initialBrief.)
      if (_tb.tripMeta) {
        var existingMeta = (TripStore.trip.brief && TripStore.trip.brief.tripMeta) || {};
        var nextMeta = Object.assign({}, existingMeta);
        if (_tb.tripMeta.notes) nextMeta.notes = _tb.tripMeta.notes;
        if (Array.isArray(_tb.tripMeta.links)) nextMeta.links = _tb.tripMeta.links.slice();
        briefUpdates.tripMeta = nextMeta;
      }
      if (Object.keys(briefUpdates).length) TripStore.updateBrief(briefUpdates);
      // Display-name refresh — keep the "— DATE" suffix if user hasn't renamed.
      var freshPlace = (_tb.name && _tb.name.trim())
        || (_tb.region && _tb.region.trim())
        || (_tb.placeName && _tb.placeName.trim());
      var curName = TripStore.trip.name;
      var dateSuffix = "";
      var m = curName && curName.match(/ — ([A-Z][a-z]+ \d+, \d{4})$/);
      if (m) dateSuffix = " — " + m[1];
      var fresh = freshPlace ? (freshPlace + dateSuffix) : null;
      if (fresh && fresh !== curName && m) {
        TripStore.setName(fresh);
        try {
          if (typeof MaxDB !== "undefined" && MaxDB.index && MaxDB.index.entry && MaxDB.index.upsert) {
            var ie = MaxDB.index.entry(_currentTripId);
            if (ie) { ie.name = fresh; MaxDB.index.upsert(ie); }
          }
        } catch(_){}
      }
    }, "initial-sync");
  }
  // Note: NO localSave() call. TripStore.batch persisted atomically.
}

// PD.330: dispatch based on the URL hash. Single function, single
// place to update if a new screen lands. Returns true once it has
// rendered the matching screen; the caller doesn't need a fall-
// through (every screen has a renderer here).
//
// Symmetric to every navigation: when something pushes a route, the
// MaxRoute hashchange/popstate listener calls back into this
// function. Browser back/forward, deep-link load, and in-app
// navigation all funnel through here.
