// @ts-check
// engine-publish.js — pure helpers for publishTrip.
//
// PD.320. The full publishTrip function in engine-picker.js (~2400
// lines, 19+ PD-referenced patches) is the highest-risk writer in
// the app. A full phase-pipeline refactor needs multiple deploy
// cycles to verify safely — too risky for a single session.
//
// This module is the carve-out: pure helpers extracted from
// publishTrip's body, each with explicit inputs and outputs and
// per-helper tests. Each helper corresponds to one or more of the
// PD-patches inside publishTrip; the patch number is in the function
// comment so the lineage is searchable.
//
// publishTrip continues to work as the orchestrator. Going forward,
// new logic for the publish pipeline should go HERE (named helpers
// with tests), not directly inline in publishTrip. As more logic
// migrates here, publishTrip shrinks naturally.
//
// All helpers are pure — same inputs always produce the same output,
// no global reads, no DOM access, no I/O. Safe to call from tests.

const global = /** @type {any} */ (globalThis);
  "use strict";

  // ── Shared utilities ────────────────────────────────────────────

  function _normKey(name) {
    if (!name) return "";
    if (typeof global._normPlaceName === "function") {
      return global._normPlaceName(name);
    }
    return String(name).toLowerCase().trim();
  }

  // ── PD.234 helpers ──────────────────────────────────────────────

  // PD.234: dedupe candidates by normalized place name. Reconciled
  // + backstopped duplicates would otherwise spawn parallel
  // destinations for the same place. Keep first occurrence.
  // Returns { deduped, droppedCount }.
  //
  // Pure. Doesn't mutate the input array.
  function dedupCandidatesByPlace(candidates) {
    if (!Array.isArray(candidates)) return { deduped: [], droppedCount: 0 };
    var seen = Object.create(null);
    var out = [];
    var dropped = 0;
    candidates.forEach(function (c) {
      if (!c || !c.place) { out.push(c); return; }
      var k = _normKey(c.place);
      if (!k) { out.push(c); return; }
      if (seen[k]) { dropped++; return; }
      seen[k] = true;
      out.push(c);
    });
    return { deduped: out, droppedCount: dropped };
  }

  // PD.234: filter kept candidates to the "destinations" set. A
  // candidate becomes a destination only if:
  //   - status === "keep"
  //   - intent is NOT "wayside" or "dayTrip" (those commit as
  //     planItem stops on routes, not destinations)
  //   - its normalized place name is NOT in the sights classifier
  //     bucket (sights attach to a parent destination via PD.223
  //     or get augmented as 0-night stops via PD.225)
  //
  // Returns { kept, skippedSights } where skippedSights lists the
  // names that were filtered out by the sights-bucket check (used
  // for the diagnostic console log).
  function filterCandidatesForDestinations(candidates, sightsClassified) {
    if (!Array.isArray(candidates)) return { kept: [], skippedSights: [] };
    var sights = sightsClassified || {};
    var skipped = [];
    var kept = candidates.filter(function (c) {
      if (!c || c.status !== "keep") return false;
      if (c.intent === "wayside" || c.intent === "dayTrip") return false;
      if (c.place) {
        var k = _normKey(c.place);
        if (sights[k]) {
          skipped.push(c.place);
          return false;
        }
      }
      return true;
    });
    return { kept: kept, skippedSights: skipped };
  }

  // PD.234 (reconciliation): synthesize candidates for placeActivity
  // requiredPlaces that have no matching kept candidate. Backstop
  // for completeness-pass additions and any path that adds to
  // placeActivities without going through runCandidateSearch.
  //
  // Skips:
  //   - sections marked unchecked
  //   - places marked _keep:false
  //   - places already kept as candidates
  //   - places the classifier put in the sights bucket (PD.234
  //     contract: sights attach via suggestions[], not destinations)
  //
  // Returns the array of NEW candidates to append (caller decides
  // whether to actually splice into _tb.candidates).
  function synthesizeMissingCandidates(keptCandidates, placeActivities, sightsClassified) {
    if (!Array.isArray(keptCandidates)) keptCandidates = [];
    if (!Array.isArray(placeActivities)) placeActivities = [];
    var sights = sightsClassified || {};

    var keptKeys = {};
    keptCandidates.forEach(function (c) {
      if (c && c.place) {
        var k = _normKey(c.place);
        if (k) keptKeys[k] = true;
      }
    });

    var injected = [];
    placeActivities.forEach(function (it) {
      if (!it || it.checked === false) return;
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place) return;
        if (p._keep === false) return;
        var k = _normKey(p.place);
        if (!k) return;
        if (keptKeys[k]) return;   // already kept OR already injected this pass
        if (sights[k]) return;     // PD.234: classifier said sight
        // v359.60.18: (0,0) is the Atlantic off Africa — it satisfies isFinite
        // but poisons the geo-reorder centroid. null lets getCoord fall through
        // to getCityCenter. Guard lat/lng to null unless the coord is real.
        var hasReal = (typeof p.lat === "number" && (p.lat !== 0 || p.lng !== 0));
        injected.push({
          // P4.4a: role "see" (NOT "stay") so a reconciled listed place stays a
          // sight, not defaulted to stay by the overnightCapable branch.
          place: p.place,
          country: p.country || "",
          role: "see",
          stayRange: (typeof p.nights === "number" && p.nights > 0)
            ? (p.nights + (p.nights === 1 ? " night" : " nights"))
            : "1-2 nights",
          whyItFits: it.description || "Added to round out the route.",
          tradeoffs: "",
          tags: ["reconciled"],
          lat: hasReal ? p.lat : null,
          lng: hasReal ? p.lng : null,
          nights: (typeof p.nights === "number") ? p.nights : 1,
          _required: true,
          _requiredFor: ["reconciled"],
          status: "keep"
        });
        keptKeys[k] = true; // dedupe within injections + against later kept checks
      });
    });
    return injected;
  }

  // ── PD.236 helpers ──────────────────────────────────────────────

  // PD.236: rehydrate the classifier buckets on _tb from trip.brief
  // when _tb's are empty. publishTrip is the one downstream
  // consumer that requires these buckets; not every picker-reopen
  // path rehydrates them. Enforce the contract.
  //
  // Returns the rehydrated _tb (mutated). Idempotent — safe to call
  // multiple times.
  function rehydrateClassifierBuckets(tb, briefSource) {
    if (!tb || typeof tb !== "object") return tb;
    var brief = briefSource && typeof briefSource === "object" ? briefSource : null;
    if (!brief) return tb;
    if ((!tb._sightsClassified || !Object.keys(tb._sightsClassified).length)
        && brief._sightsClassified
        && Object.keys(brief._sightsClassified).length) {
      tb._sightsClassified = Object.assign({}, brief._sightsClassified);
    }
    if ((!tb._classificationByPlace || !Object.keys(tb._classificationByPlace).length)
        && brief._classificationByPlace
        && Object.keys(brief._classificationByPlace).length) {
      tb._classificationByPlace = Object.assign({}, brief._classificationByPlace);
    }
    return tb;
  }

  // ── Entry/exit validation ──────────────────────────────────────

  // Round HZ / v358.3: validate _tb.entry and _tb.tbExit against
  // the kept-candidate set. If the user's typed entry/exit doesn't
  // match any kept candidate's place name (substring match either
  // direction), clear it so the downstream inference path runs
  // from a clean slate.
  //
  // Returns { entry, tbExit, typedEntry, typedExit } where typed*
  // preserves the user's original input for restoration later.
  function validateEntryExit(entry, tbExit, keptCandidates) {
    var typedEntry = entry || "";
    var typedExit = tbExit || "";
    var validEntry = entry || "";
    var validExit = tbExit || "";

    function _matches(target, candidates) {
      if (!target) return false;
      var tn = _normKey(target);
      if (!tn) return false;
      return (candidates || []).some(function (c) {
        var cn = _normKey(c && c.place || "");
        return cn && (cn.indexOf(tn) >= 0 || tn.indexOf(cn) >= 0);
      });
    }

    if (validEntry && !_matches(validEntry, keptCandidates)) validEntry = "";
    if (validExit && !_matches(validExit, keptCandidates)) validExit = "";

    return {
      entry: validEntry,
      tbExit: validExit,
      typedEntry: typedEntry,
      typedExit: typedExit
    };
  }

  // ── PD.16 helpers ──────────────────────────────────────────────

  // PD.16: bridge stayOverride from _tb.placeMeta into c.role. The
  // user's Discovery role decisions (Mark as overnight / Mark as
  // just visiting) live on _tb.placeMeta during the picker phase;
  // at publish time they need to land on the kept-candidate's
  // c.role so downstream code sees a consistent role.
  //
  // Returns an array of bridge actions: [{ place, fromRole, toRole }].
  // Caller applies them (this helper is read-only on candidates so
  // the result can be inspected / logged before mutation).
  function deriveStayOverrideBridges(keptCandidates, placeMeta) {
    if (!Array.isArray(keptCandidates)) return [];
    if (!placeMeta || typeof placeMeta !== "object") return [];
    var actions = [];
    keptCandidates.forEach(function (c) {
      if (!c || !c.place) return;
      var k = _normKey(c.place);
      var meta = placeMeta[k];
      if (!meta) return;
      var nextRole = (meta.stayOverride === true) ? "stay"
                   : (meta.stayOverride === false) ? "see"
                   : null;
      if (!nextRole) return;
      if (c.role === nextRole) return;
      actions.push({ place: c.place, fromRole: c.role || null, toRole: nextRole });
    });
    return actions;
  }

  // ── Rebuild detection ─────────────────────────────────────────

  // Round DW: detect rebuild vs fresh build. Used by publishTrip
  // to decide whether to mutate the existing trip object in place
  // (preserving user state attached to surviving destinations) or
  // build a fresh trip from scratch.
  //
  // A "rebuild" is signaled by either:
  //   - explicit _tb._isRebuild flag (set by saveActivityPickerEdits)
  //   - existing trip already has destinations (re-publish path)
  function detectRebuild(tb, trip) {
    if (tb && tb._isRebuild) return true;
    if (trip && Array.isArray(trip.destinations) && trip.destinations.length > 0) return true;
    return false;
  }

  // ── Trip name derivation — RETIRED (F2) ───────────────────────
  // deriveTripName + isAutoName lived here too, but were a DEAD, DIVERGENT twin
  // of the LIVE MaxEnginePicker.deriveTripName / isAutoName (engine-picker.js
  // ~1887): this copy had no title-casing, returned a bare first.place for
  // multi-kept (vs "X + N more"), and used a looser isAutoName (any "untitled*").
  // Production always used the MaxEnginePicker versions; these were tested but
  // never called — the tests guarded a copy that could disagree with the real
  // name. Removed so there is ONE implementation, now tested in
  // tests/engine-tests.js against the live MaxEnginePicker.

  // ── Diagnostics ────────────────────────────────────────────────

  // Summary of what publishTrip's filter phase will produce. Useful
  // for tests + the audit log.
  function describeFilterOutput(candidates, sightsClassified) {
    var dedup = dedupCandidatesByPlace(candidates);
    var filtered = filterCandidatesForDestinations(dedup.deduped, sightsClassified);
    return {
      input: (candidates || []).length,
      deduped: dedup.droppedCount,
      keptForDestinations: filtered.kept.length,
      skippedAsSights: filtered.skippedSights.length
    };
  }

  // ── Export ─────────────────────────────────────────────────────

  global.MaxPublish = {
    // PD.234
    dedupCandidatesByPlace:         dedupCandidatesByPlace,
    filterCandidatesForDestinations:filterCandidatesForDestinations,
    synthesizeMissingCandidates:    synthesizeMissingCandidates,
    // PD.236
    rehydrateClassifierBuckets:     rehydrateClassifierBuckets,
    // PD.16
    deriveStayOverrideBridges:      deriveStayOverrideBridges,
    // Round HZ / v358.3
    validateEntryExit:              validateEntryExit,
    // Round DW
    detectRebuild:                  detectRebuild,
    // Round EB / HL
    // Diagnostics
    describeFilterOutput:           describeFilterOutput
  };



/* #2 Stage 2 interim: expose this module's non-colliding top-level bindings
   as globals (restores pre-ESM flat-script behavior for bare-global + window.*
   consumers, incl. app-main.js boot refs). esbuild isolates each .mjs to an IIFE;
   any-cast keeps it tsc-valid; the import-rewiring phase removes this. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.dedupCandidatesByPlace = dedupCandidatesByPlace;
  __expg.filterCandidatesForDestinations = filterCandidatesForDestinations;
  __expg.synthesizeMissingCandidates = synthesizeMissingCandidates;
  __expg.rehydrateClassifierBuckets = rehydrateClassifierBuckets;
  __expg.validateEntryExit = validateEntryExit;
  __expg.deriveStayOverrideBridges = deriveStayOverrideBridges;
  __expg.detectRebuild = detectRebuild;
  __expg.describeFilterOutput = describeFilterOutput;
}

export {};
