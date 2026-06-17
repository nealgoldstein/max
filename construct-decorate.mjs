// @ts-check
import { MaxGenPrompt } from "./gen-prompt.mjs";
import { MaxEnrich } from "./engine-enrich.mjs";
import { DiscoveryModel } from "./discovery-model.mjs";
import MaxData from "./max-data.mjs";
import PlaceKey from "./place-key.mjs";
import { _escHtml } from "./util-esc.mjs";
// construct-decorate.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Construct-then-decorate + PD.382 provenance + paste-list modal.
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ── PD.382: PROVENANCE is a stored field, not a derivation ─────────
// Every requiredPlace carries `_origin` set ONCE at creation:
//   "user"     — a place the traveler listed (the contract). Checked.
//   "max-hub"  — a base Max synthesized for the user's sights. Unchecked.
//   "max"      — a place Max suggested (LLM / enhance). Unchecked.
// Section placement and default check-state become pure functions of
// origin. _placeOrigin() reads the stored field, falling back to the
// old inference for legacy saved trips (so this is backward-safe).
window._placeOrigin = function (p) {
  if (!p) return "max";
  if (p._origin === "user" || p._origin === "max-hub" || p._origin === "max") return p._origin;
  if (p._autoCreated) return "max-hub";
  try {
    if (typeof _tb !== "undefined" && _tb && _tb._userListedNames) {
      var k = (window.PlaceKey ? PlaceKey.resolve(p.place) : String(p.place || "").toLowerCase().trim());
      if (k && _tb._userListedNames[k]) return "user";
    }
  } catch (_) {}
  return "max";
};
// The check-state rule, in ONE place: only the traveler's own listed
// places default to checked. "Max never checks anything."
window._defaultKeepForOrigin = function (o) { return o === "user"; };

// PD.429: the listed set is no longer an independent persisted store. This
// helper makes _tb._userListedNames / _userListedDisplay a pure PROJECTION of
// the records: (1) bake _origin:"user" onto every record covering a listed
// name (migrating a pre-PD.429 trip from whatever authority is present — the
// build's pasted list, or a legacy brief map still in _tb), then (2) recompute
// the cache straight from the records. After this the cache cannot drift from
// the records, because it IS the records — the bug class that double-counted
// "Goðafoss" is gone by construction. Call it wherever a trip hydrates into _tb
// and after any record-shape change (build, reopen, "more like this").
window._refreshUserListedFromRecords = function () {
  try {
    if (typeof _tb === "undefined" || !_tb || !Array.isArray(_tb.placeActivities)) return;
    if (typeof _stampListedOrigin === "function") _stampListedOrigin();
    if (typeof MaxData !== "undefined" && MaxData.deriveListedFromRecords) {
      var d = MaxData.deriveListedFromRecords(_tb, {
        normKey: (typeof _normPlaceName === "function") ? _normPlaceName : null,
        isStaySection: (typeof window !== "undefined" && typeof window._isStaySection === "function") ? window._isStaySection : null
      });
      _tb._userListedNames   = d.names;
      _tb._userListedDisplay = d.display;
    }
  } catch (_) {}
};

// PD.442 (#2): `_collapseKindConflicts` was DELETED. The kind invariant — a
// place you listed as a SIGHT never sits in a stay section, and a base is never
// duplicated as a sight — now lives ONCE at the write door
// (canonicalizePlaceActivities, PD.441 + PD.442), which runs on every save. The
// scattered, loosely-matched pass that used to over-remove a base ("Skaftafell"
// vs your "Skaftafell glacier region") is gone; enforcement is exact and
// identity-keyed at the one chokepoint.

// PD.443 (#2): `_assertUserListedPresent` was DELETED. The listed-set PRESENCE
// invariant — every listed STAY in a stay section, every listed SIGHT on the
// page — now lives at the WRITE DOOR (canonicalizePlaceActivities, PD.443),
// which runs on every save. Removal (PD.441/442) and restoration (PD.443) are
// owned at one chokepoint, identity-aware and idempotent, so no upstream pass
// has to be trusted and there's no pipeline postcondition to keep in sync.

// PD.435: the ONE ordered placement-finalize pipeline. Every site that finalizes
// _tb.placeActivities AFTER theming — the reopen pass, the render self-heal, a
// "more like this" add — runs THIS exact sequence, so the steps can never drift
// or be reordered between callers (the bug the build/reopen divergence created).
// The steps are the proven, separately-tested passes; this only owns their
// ORDER and the single entry point:
//   1. consolidateOrphanThemes — re-home a themeless sight into a fitting theme.
//   2. surfaceRouteOnlySights  — lift a route-only sight into its theme section.
//   3. _refreshUserListedFromRecords — bake user provenance + re-project the
//      listed cache from the records (calls _stampListedOrigin internally).
//   (The kind invariant — a sight is never in a stay section, a base never
//    duplicated as a sight — now lives at the WRITE DOOR, PD.441/442, not here.)
// Operates on _tb.placeActivities in place; each step is idempotent. Returns a
// small summary for diagnostics/logging.
//   opts.refreshListedCache — REOPEN passes true: in addition to baking
//     provenance, re-project _tb._userListedNames from the records (a migration
//     concern for existing trips). BUILD leaves it false: the listed cache is
//     constructed elsewhere during the build, and re-projecting it mid-build
//     disrupts destination construction. This is the ONE intentional build vs
//     reopen difference; the four-step ORDER is shared.
window._finalizeDiscoveryPlacement = function (opts) {
  opts = opts || {};
  var out = { rehomed: 0, surfaced: 0, removed: 0 };
  try {
    if (typeof _tb === "undefined" || !_tb || !Array.isArray(_tb.placeActivities)) return out;
    var nf = (typeof _normPlaceName === "function") ? _normPlaceName : null;
    var isStay = (typeof window._isStaySection === "function") ? window._isStaySection : null;
    if (typeof MaxGenPost !== "undefined" && MaxGenPost) {
      if (typeof MaxGenPost.consolidateOrphanThemes === "function")
        out.rehomed = MaxGenPost.consolidateOrphanThemes(_tb.placeActivities, { normPlaceName: nf }) || 0;
      if (typeof MaxGenPost.surfaceRouteOnlySights === "function")
        out.surfaced = MaxGenPost.surfaceRouteOnlySights(_tb.placeActivities, { normPlaceName: nf, isStaySection: isStay }) || 0;
    }
    // Provenance bake is universal; cache re-projection is reopen-only.
    if (opts.refreshListedCache && typeof _refreshUserListedFromRecords === "function") _refreshUserListedFromRecords();
    else if (typeof _stampListedOrigin === "function") _stampListedOrigin();
    // Kind + presence invariants are OWNED at the write door (PD.441/442/443),
    // which runs on the save that follows — so the pipeline no longer re-asserts
    // them here. This block is now pure best-effort PLACEMENT (theme/route).
  } catch (_) {}
  return out;
};
if (typeof globalThis !== "undefined") globalThis._finalizeDiscoveryPlacement = window._finalizeDiscoveryPlacement;

// PD.401k: the ONE place-identity accessor every reader uses. Prefers the
// canonical `_key` stamped at the write door (coordinate-aware interning);
// falls back to PlaceKey.resolve for a bare name or an un-stamped object.
// No reader computes `place.toLowerCase()` for identity anymore — there is
// one identity, established once, read here.
window._pmKey = function (po) {
  if (po && typeof po === "object") {
    if (po._key) return po._key;
    return window.PlaceKey ? PlaceKey.resolve(po.place) : String(po.place || "").toLowerCase().trim();
  }
  return window.PlaceKey ? PlaceKey.resolve(po) : String(po || "").toLowerCase().trim();
};

function _constructUserListedItems() {
  if (typeof _tb === "undefined" || !_tb) return;
  if (!Array.isArray(_tb._pastedListPlaces) || !_tb._pastedListPlaces.length) return;
  _tb.placeActivities = Array.isArray(_tb.placeActivities) ? _tb.placeActivities : [];
  var stays = _tb._pastedListPlaces.filter(function(p){
    return p && p.place && (p.isStay || (typeof p.nights === "number" && p.nights > 0));
  });
  // Ensure the stays section exists so the constructor below routes
  // listed stays into it rather than the catchall.
  var _userStays = stays.filter(function(p){ return p && !p._autoCreated; });
  if (_userStays.length && !_tb.placeActivities.some(function(it){
    return it && it.section === window._SEC_STAYS_USER;
  })) {
    _tb.placeActivities.push({
      id: "plm_userstays_" + Date.now(),
      name: "Overnight stays",
      type: "activity",
      category: "scenery-nature",
      section: window._SEC_STAYS_USER,
      // PD.380: this section is YOURS — only places you listed as
      // stays. Max's proposed bases live in the separate
      // "Recommended overnight stays" section, unchecked.
      description: "The places you listed as overnight stays. These anchor the trip — where you sleep and the bases for day trips.",
      iconic: false,
      checked: true,
      requiredPlaces: [],
      durationHours: 24,
      _userConstructed: true
    });
  }
  var before = _tb.placeActivities.length;
  _backstopPastedListPlaces("construct"); // constructs everything not yet covered
  // Tag everything the construction created so the LLM merge knows
  // these survive unconditionally.
  _tb.placeActivities.forEach(function(it){
    if (!it) return;
    if (window._isStaySection(it.section)
        || (it.id && String(it.id).indexOf("plm_pasted_") === 0)
        || (it.id && String(it.id).indexOf("plm_userstays_") === 0)) {
      it._userConstructed = true;
    }
  });
  console.log("[Max PD.337] constructed " + _tb._pastedListPlaces.length +
    " user-listed place(s) into the picker BEFORE the LLM (" + stays.length +
    " stays). LLM output will decorate, not decide.");
}
if (typeof globalThis !== "undefined") globalThis._constructUserListedItems = _constructUserListedItems;

// PD.257: reconciliation pass — slot user-listed sights into matching
// LLM activity sections using Wikipedia summary tokens.
//
// The LLM that generates activity sections is inconsistent at slotting
// every user-listed place into one (Seljalandsfoss + Skógafoss land
// under "Hike to waterfalls" but Goðafoss gets dropped). The render-
// time orphan catch-all ("Sights near places you listed") then surfaces the
// drop, but the user reads it as a bug: "you have a Hike to waterfalls
// section AND a waterfall called Goðafoss — why didn't you put it
// there?"
//
// This pass closes that gap deterministically. For each user-listed
// sight that's not in any non-synthetic section's requiredPlaces, we
// fetch the cached Wikipedia summary (description + extract), tokenize
// both the summary and each candidate section's name + description,
// score by shared non-stopword token count, and add the place to the
// best section if the score exceeds a threshold. Async because the
// wiki cache lookup is Promise-based, but cached results return
// synchronously so already-hydrated trips don't pay any extra time.
//
// Stopword list is small + Iceland-trip-tuned. Threshold of >= 1
// shared meaningful token is enough for clean matches like
// "waterfall" → "Hike to waterfalls"; lower-confidence guesses fall
// through to the orphan catch-all so the user sees them and can move
// them manually.
// PD.404 (#80): the THEMING PASS. Runs in the reconcile phase, AFTER the
// deterministic _reconcileListedSightsToSections has slotted everything it
// can by token-match, and BEFORE enhance adds Max's own extras. It asks the
// model to sort the traveler's listed places into the REAL theme sections
// the build has produced (catch-alls excluded), then moves any listed sight
// still sitting in a catch-all into its assigned theme. Flag-gated
// (localStorage "max-theming-pass" === "1"); default OFF. Construction and
// the backstop remain the safety nets — a failed or partial pass can never
// drop a place; at worst a place stays in the catch-all it was already in.
async function _runThemingPass() {
  // PD.486 (#80): theming pass is now ON by default. It was flag-gated
  // (default OFF) while the "assignment doesn't survive to the final picker"
  // trap was open; PD.404/405 closed it by writing the assigned THEME into
  // it.section (so the next model rebuild re-derives themeFit from it and the
  // move persists) rather than reassigning routed _tb.placeActivities (which
  // looped). Construction + backstop remain the safety nets — a failed or
  // partial pass can never drop a place. "max-theming-pass"==="0" is the
  // explicit escape hatch if it ever needs disabling in the field.
  var on = true;
  try { if (typeof localStorage !== "undefined" && localStorage.getItem("max-theming-pass") === "0") on = false; } catch(_){}
  if (!on) return;
  if (!_tb || !(Array.isArray(_tb._pastedListPlaces) && _tb._pastedListPlaces.length)) return;
  var pa = Array.isArray(_tb.placeActivities) ? _tb.placeActivities : [];
  var place = _tb.placeName || _tb.region || "";
  var ctx = _tb.placeContext || _tb.intent || "";
  // PD.404: "which sections may the theming pass re-theme?" = exactly the
  // sections the DiscoveryModel treats as carrying NO theme (themeFit null).
  // Derive it from the model itself (its catch-set, which includes the
  // "Unique sights" fallback bucket), so this can never drift from the
  // placement logic. Setting it.section to a real theme makes the next model
  // rebuild derive themeFit from it, so the move persists.
  var movable = (window.MaxDiscovery && typeof MaxDiscovery.catchallSections === "function")
    ? MaxDiscovery.catchallSections()
    : ["From your list", "Sights near places you listed", "More places to consider", "Unique sights"];
  var movableSet = {};
  movable.forEach(function(s){ movableSet[s] = true; });
  // Offer the model the REAL themes (everything that isn't a catch-all or a
  // stay bucket) — we want listed sights sorted INTO themes, never back into
  // a catch-all.
  var sections = [];
  pa.forEach(function(it){
    if (!it || !it.section) return;
    if (movableSet[it.section]) return;
    if (typeof window._isStaySection === "function" && window._isStaySection(it.section)) return;
    if (sections.indexOf(it.section) < 0) sections.push(it.section);
  });
  var names = _tb._pastedListPlaces.map(function(d){ return d && d.place; }).filter(Boolean);
  try {
    var prompt = MaxGenPrompt.buildThemingPrompt({ place: place, ctx: ctx, userList: names, sections: sections });
    var budget = Math.min(8000, Math.max(2000, names.length * 120));
    // PD.404: the theming call is one of several LLM calls in a build; when
    // the API is rate-limited it's often the one that fails ("Failed to
    // fetch" / timeout). Retry once after a short pause to ride out the
    // transient case. On hard failure, record THIS run's status on the
    // global (with a fresh timestamp) so the read is never misleadingly
    // stale from an earlier build.
    var raw = null, _themeErr = null;
    for (var _ta = 0; _ta < 2; _ta++) {
      try { raw = await callMax([{ role: "user", content: prompt }], budget, 60000); _themeErr = null; break; }
      catch (e) {
        _themeErr = e;
        if (_ta === 0) { try { await new Promise(function(r){ setTimeout(r, 1500); }); } catch(_){} }
      }
    }
    if (_themeErr || raw == null) {
      try { window.__PD404_THEME = { error: (_themeErr && _themeErr.message) || "no response",
        listLen: names.length, sectionsOffered: sections.length, at: new Date().toISOString() }; } catch(_){}
      console.warn("[Max PD.404] theming pass failed after retry (non-fatal):", _themeErr && _themeErr.message);
      return;
    }
    var map = MaxGenPost.coerceThemingMap(raw);
    var parsed = Array.isArray(map) ? map.length : 0;
    // PD.404/diag: capture the ACTUAL data applyTheming sees, so a sorted:0
    // result shows exactly why — which sections exist (and which are
    // movable), a sample of the catch-all place names, and a sample of the
    // map names. The mismatch is then visible in one read.
    var _dbgSections = {};
    var _dbgMovablePlaces = [];
    pa.forEach(function(it){
      if (!it || !it.section) return;
      var cnt = (it.requiredPlaces && it.requiredPlaces.length) || 0;
      _dbgSections[it.section] = (_dbgSections[it.section] || 0) + cnt;
      if (movableSet[it.section] && Array.isArray(it.requiredPlaces)) {
        it.requiredPlaces.forEach(function(p){ if (p && p.place) _dbgMovablePlaces.push(p.place); });
      }
    });
    var _mapSample = (map || []).map(function(e){ return e && e.place; });
    var sorted = 0;
    if (parsed) {
      sorted = MaxGenPost.applyTheming(pa, map, {
        normPlaceName: (typeof _normPlaceName === "function") ? _normPlaceName : null,
        movableSections: movable
      });
    }
    // Re-home any sight the theming pass left un-themed into a fitting EXISTING
    // theme (waterfall→waterfalls, geyser→thermal, glacier→glaciers …) so a
    // kept-but-uncategorized sight can't render as a lonely self-named category
    // (the "Geysir (1)" / "Goðafoss Waterfall (1)" complaint). Conservative:
    // moves only on a clear feature-concept match to a theme that already
    // exists, so it cannot mis-file.
    // PD.435: finalize placement through the ONE canonical pipeline — the SAME
    // sequence the reopen pass and the render self-heal run (consolidate orphan
    // themes → surface route-only sights → bake user provenance + re-project the
    // listed cache → collapse kind conflicts). pa === _tb.placeActivities here
    // (see above), so the in-place steps act on the array we just themed, and
    // build can no longer drift from the other callers. None of these steps
    // reassign _tb.placeActivities, so there's no mid-build render loop (the
    // PD.404 caution below still applies only to _applyDiscoveryModelToSights).
    var _fin = (typeof window._finalizeDiscoveryPlacement === "function")
      ? window._finalizeDiscoveryPlacement() : { rehomed: 0, surfaced: 0 };
    if (_fin.rehomed) console.log("[Max] orphan-theme consolidation re-homed " + _fin.rehomed + " sight(s) into existing themes");
    if (_fin.surfaced) console.log("[Max] surfaced " + _fin.surfaced + " route-only sight(s) into theme sections");
    // Flag-on-only summary for live verification: JSON.stringify(window.__PD404_THEME)
    try {
      window.__PD404_THEME = { parsed: parsed, sorted: sorted, listLen: names.length,
        sectionsOffered: sections.length, movableSections: movable,
        mapSample: _mapSample, catchallPlaces: _dbgMovablePlaces, sectionCounts: _dbgSections,
        rawLen: (raw && raw.length) || 0, at: new Date().toISOString() };
    } catch(_){}
    console.log("[Max PD.404] theming pass: parsed " + parsed + " mapping(s), sorted "
      + sorted + " of " + names.length + " listed place(s) into themes ("
      + sections.length + " sections offered)");
    // PD.404: NOTE — do NOT call _applyDiscoveryModelToSights() here to
    // "bake" _themeFit into sections. It reassigns _tb.placeActivities,
    // which is a routed accessor that emits tripChange → re-render → adapter
    // → reassign … an infinite render loop mid-build (it hung the build and
    // tripped the harness teardown timeouts). The per-place _themeFit set
    // above is honored by the model on the next NATURAL render; persisting
    // it through enhance/canonicalize is the remaining work (see NEXT-SESSION).
  } catch(e) {
    console.warn("[Max PD.404] theming pass failed (non-fatal):", e && e.message);
  }
}
if (typeof globalThis !== "undefined") globalThis._runThemingPass = _runThemingPass;

async function _reconcileListedSightsToSections() {
  if (!_tb || !Array.isArray(_tb.placeActivities)) return;
  var listedNames = (_tb._userListedNames) || {};
  var listedKeys = Object.keys(listedNames).filter(function(k){ return listedNames[k] === "see"; });
  if (!listedKeys.length) return;

  var normFn = (typeof globalThis._normPlaceName === "function")
    ? globalThis._normPlaceName
    : function(s){ return String(s||"").toLowerCase().trim(); };

  // PD.258/PD.285: coverage uses UNIDIRECTIONAL token-subset matching.
  // A user-listed sight is "covered" only when every user token appears
  // in some LLM requiredPlace's token set. PD.258 originally allowed
  // bidirectional matching so "Snæfellsnes" (user) would be covered by
  // "Snæfellsnes Peninsula" (LLM) — that direction is still kept. But
  // the reverse direction ("Arnarstapi" LLM token-subset of "Arnarstapi
  // coastal cliffs" user) was conflating distinct places — the town
  // stay activity is NOT the user's coastal-cliffs sight. PD.285 drops
  // the reverse, so user-listed names with extra qualifier words flow
  // through reconciliation and get categorized into a real section
  // instead of disappearing into a false-match.
  function _pd258TokensOf(name) {
    var n = normFn(name);
    return n ? n.split(/\s+/).filter(Boolean) : [];
  }
  var SYNTHETIC = { "synthetic-stays":1, "synthetic-sights":1, "synthetic-umbrella":1 };
  // PD.283: also treat the backstop's "More places to consider"
  // section as NOT covered. That section is a safety net for places
  // the LLM outright dropped; treating it as covered means
  // reconciliation never re-categorizes Goðafoss Waterfall or
  // Jökulsárlón canyon out of the generic catchall and into their
  // proper homes (Hike to waterfalls / Visit natural wonders).
  // Stubs in that section flow through reconciliation as orphans,
  // get LLM-placed, and are removed from the catchall at placement
  // time so we don't end up with duplicates.
  function _isCatchallSection(it) {
    // PD.341: "From your list" is the user-listed leftovers' home —
    // it flows through reconciliation the same way (entries promoted
    // into thematic sections when one fits, removed from here at
    // placement time). PD.347: the enhance pool too — its entries
    // are placement candidates, and placed ones get pulled out here.
    return it && (it.section === "More places to consider"
      || it.section === "From your list"
      || it.section === "Sights near places you listed");
  }
  var coveredTokenSets = [];
  _tb.placeActivities.forEach(function(it){
    if (!it || (it.type && SYNTHETIC[it.type])) return;
    if (_isCatchallSection(it)) return;
    (it.requiredPlaces || []).forEach(function(p){
      if (!p || !p.place) return;
      var toks = _pd258TokensOf(p.place);
      if (!toks.length) return;
      var set = {};
      toks.forEach(function(t){ set[t] = true; });
      coveredTokenSets.push(set);
    });
  });
  function _isCovered(userKey) {
    var userToks = _pd258TokensOf(userKey);
    if (!userToks.length) return false;
    for (var ci = 0; ci < coveredTokenSets.length; ci++) {
      var set = coveredTokenSets[ci];
      // PD.285: user identity must be fully captured by the covered
      // name (every user token in the LLM requiredPlace's tokens). The
      // reverse direction conflated distinct places.
      var userInCovered = userToks.every(function(t){ return set[t]; });
      if (userInCovered) return true;
    }
    return false;
  }
  var orphanKeys = listedKeys.filter(function(k){ return !_isCovered(k); });
  // PD.347: ALSO thematically place Max's enhance output. Entries
  // sitting in "Sights near places you listed" pool there instead of
  // joining the thematic sections the user actually browses; the
  // same LLM placement pass that files user-listed orphans can file
  // these too (placed entries are pulled from the source section at
  // placement time, same as the catchall). Capped so the placement
  // prompt stays small.
  try {
    var _enhSection = _tb.placeActivities.find(function(it){
      return it && it.section === "Sights near places you listed";
    });
    if (_enhSection && Array.isArray(_enhSection.requiredPlaces)) {
      var _enhAdded = 0;
      _enhSection.requiredPlaces.forEach(function(p){
        if (!p || !p.place || _enhAdded >= 25) return;
        var k = normFn(p.place);
        if (!k || orphanKeys.indexOf(k) !== -1) return;
        if (_isCovered(k)) return; // already themed elsewhere
        orphanKeys.push(k);
        _enhAdded++;
      });
      if (_enhAdded) console.log("[PD.347] queued " + _enhAdded + " enhance suggestion(s) for thematic placement");
    }
  } catch(_){}
  if (!orphanKeys.length) {
    console.log("[PD.257] no orphans, reconciliation skipped");
    return;
  }
  console.log("[PD.257] start: " + orphanKeys.length + " orphan(s):", JSON.stringify(orphanKeys));

  // Resolve a display name + country for each orphan key so the wiki
  // fetch + the requiredPlaces.push use the user's original spelling.
  var displayMap = (_tb._userListedDisplay) || {};
  var pastedByKey = {};
  (_tb._pastedListPlaces || []).forEach(function(p){
    if (p && p.place) pastedByKey[normFn(p.place)] = p;
  });
  function _resolveOrphan(k) {
    var orig = displayMap[k] || (pastedByKey[k] && pastedByKey[k].place) || k;
    var country = (pastedByKey[k] && pastedByKey[k].country) || _tb.region || "";
    return { key: k, name: orig, country: country };
  }
  var orphans = orphanKeys.map(_resolveOrphan);

  // Candidate sections: non-synthetic placeActivities. We score by
  // shared tokens between the sight's wiki text and the section's
  // name + description.
  var STOP = {
    a:1, an:1, the:1, and:1, or:1, of:1, in:1, on:1, at:1, to:1, for:1, by:1, with:1,
    from:1, into:1, this:1, that:1, these:1, those:1, is:1, are:1, was:1, were:1, be:1,
    it:1, its:1, you:1, your:1, max:1,
    // Place-name stopwords that show up in nearly every region's sights.
    region:1, north:1, south:1, east:1, west:1,
    near:1, around:1, located:1, town:1, village:1
  };
  function _tokens(text) {
    if (!text) return [];
    return String(text)
      .toLowerCase()
      .replace(/[^a-zà-ÿðþæöáéíóúýðþæöß0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(function(t){ return t && t.length >= 3 && !STOP[t]; });
  }
  function _toSet(arr) {
    var s = {};
    arr.forEach(function(t){ s[t] = true; });
    return s;
  }

  var sections = _tb.placeActivities.filter(function(it){
    return it && it.section && (!it.type || !SYNTHETIC[it.type]);
  });
  // PD.258: a section's token vector is its name + description PLUS
  // the names of every place already in its requiredPlaces. The LLM's
  // section descriptions are sometimes generic ("Iceland's most
  // striking landscape features") and don't share words with a
  // specific sight's Wikipedia summary. The places-already-placed
  // function as a learned vocabulary — if the LLM put "Dimmuborgir"
  // and "Reynisfjara" under "Visit natural wonders," an orphan whose
  // wiki summary mentions "Dimmuborgir-like lava formations" or
  // "Reynisfjara" picks up a signal.
  //
  // We ALSO fetch the wiki summaries for the section's existing
  // places (cached, so usually free) and add THEIR description tokens.
  // That captures the semantic shape of what "Visit natural wonders"
  // actually contains, not just the LLM's prose about it.
  // PD.281: split the section's tokens into IDENTITY (name +
  // description — what the section IS) and ENRICHMENT (placed
  // places + their wikis — what the section CONTAINS). The earlier
  // single-set scoring let regional co-occurrence dominate: a sight
  // in northern Iceland matched any section with northern-Iceland
  // places in it, regardless of category. Now identity gates
  // eligibility (the sight must share at least one identity token
  // with the section), and the combined score breaks ties between
  // categorically-eligible sections.
  async function _buildSectionVec(it) {
    var identityBlob = (it.section || "") + " " + (it.name || "") + " " + (it.description || "");
    var enrichBlob = "";
    var placeNames = (it.requiredPlaces || [])
      .map(function(p){ return p && p.place ? p.place : ""; })
      .filter(Boolean);
    enrichBlob += " " + placeNames.join(" ");
    if (placeNames.length && fetcher) {
      var wikis = await Promise.all(placeNames.map(function(name){
        return fetcher(name, "").catch(function(){ return null; });
      }));
      wikis.forEach(function(w){
        if (!w) return;
        if (w.description) enrichBlob += " " + w.description;
        if (w.extract) enrichBlob += " " + w.extract;
      });
    }
    return {
      item: it,
      identityTokens: _toSet(_tokens(identityBlob)),
      enrichTokens: _toSet(_tokens(enrichBlob))
    };
  }
  var fetcher = window.MaxPickerUI && window.MaxPickerUI._fetchWikiSummary;
  if (!fetcher) {
    console.warn("[PD.257] _fetchWikiSummary unavailable; skipping reconciliation");
    return;
  }
  var sectionVecs = await Promise.all(sections.map(_buildSectionVec));
  if (!sectionVecs.length) return;

  // PD.282: heuristic dropped entirely. Token matching can't tell
  // "Jökulsárgljúfur Canyon mentions a route" from "Jökulsárgljúfur
  // Canyon IS a route" — that's a semantic distinction the LLM has
  // and lexical matching doesn't. PD.258 (enrichment), PD.281
  // (identity gate), and successive tunings traded one misplacement
  // for another. The LLM is the right tool; one extra LLM call per
  // build is acceptable cost for predictable correctness.
  //
  // We still fetch wiki summaries for the orphans (used as the LLM
  // prompt's "what is this place?" context) and use sectionVecs for
  // the LLM prompt's section descriptions. The placement loop itself
  // is now LLM-only.
  var placed = [];
  console.log("[PD.257] heuristic dropped (PD.282) — all " + orphans.length + " orphan(s) deferred to LLM pass");

  // PD.259: LLM-backed second pass for orphans the heuristic can't
  // categorize. Rebuild coveredTokenSets once (post-heuristic) and
  // recompute which orphans remain.
  coveredTokenSets = [];
  // PD.279: also verify what heuristic-placed items are actually in
  // _tb.placeActivities at rebuild time — diagnostic for the race
  // suspected in PD.263. If best.item ≠ _tb.placeActivities[i] for
  // any reason (snapshot mismatch, filter replacement), the push
  // lands on a detached object the rebuild won't see.
  var _pd279SectionsWithPushes = {};
  placed.forEach(function(p){ _pd279SectionsWithPushes[p.section] = (_pd279SectionsWithPushes[p.section] || 0) + 1; });
  var _pd279Found = {};
  _tb.placeActivities.forEach(function(it){
    if (!it || (it.type && SYNTHETIC[it.type])) return;
    if (_isCatchallSection(it)) return; // PD.283
    var secName = it.section || "";
    (it.requiredPlaces || []).forEach(function(p){
      if (!p || !p.place) return;
      if (_pd279SectionsWithPushes[secName]) {
        if (!_pd279Found[secName]) _pd279Found[secName] = [];
        _pd279Found[secName].push(p.place);
      }
      var toks = _pd258TokensOf(p.place);
      if (!toks.length) return;
      var set = {};
      toks.forEach(function(t){ set[t] = true; });
      coveredTokenSets.push(set);
    });
  });
  console.log("[PD.279] sections that got pushes — current requiredPlace names visible to rebuild:",
    JSON.stringify(_pd279Found));
  var stillOrphanKeys = orphanKeys.filter(function(k){ return !_isCovered(k); });
  if (!stillOrphanKeys.length) {
    console.log("[PD.259] no still-orphans after heuristic; LLM pass skipped");
    return;
  }
  console.log("[PD.259] " + stillOrphanKeys.length + " still-orphan after heuristic:",
    JSON.stringify(stillOrphanKeys));
  if (typeof callMax !== "function") {
    console.warn("[PD.259] callMax unavailable; LLM reconciliation skipped");
    return;
  }
  // Build the prompt: sections (with descriptions) + remaining orphans
  // with their wiki summaries. Ask for a single JSON mapping.
  var stillOrphans = stillOrphanKeys.map(_resolveOrphan);
  // Re-fetch wikis for the remaining orphans (cached after the
  // heuristic loop's first call, so this is free).
  var orphanWikis = await Promise.all(stillOrphans.map(function(o){
    return fetcher(o.name, o.country).catch(function(){ return null; });
  }));
  function _shortText(s, max) {
    if (!s) return "";
    s = String(s).trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }
  // PD.283: don't offer the catchall as a placement target to the
  // LLM. If we did, the LLM could "place" a backstop stub back into
  // the same section it came from, then the cleanup below would
  // remove it from there as if it had been promoted — and the sight
  // vanishes entirely. Forcing the LLM to pick from real categorical
  // sections (or return null) makes the cleanup safe.
  //
  // PD.286: also exclude type:"route" sections. Route sections are
  // multi-day overnight sequences (Ring Road bases like Reykjavík →
  // Selfoss → Vík → Höfn → ...), rendered by the picker as a
  // connected endpoint line, not as a list of sight rows. A sight
  // pushed into a route's requiredPlaces (e.g. Diamond Circle into
  // "Drive scenic routes") gets stored but invisibly hidden — it's
  // not an endpoint, so it never renders. Only type:"activity"
  // sections render their requiredPlaces as discoverable rows, so
  // those are the only valid placement targets.
  function _isPlaceableSection(it) {
    if (!it) return false;
    if (_isCatchallSection(it)) return false;
    if (it.type === "route") return false;
    return true;
  }
  var sectionsForPrompt = sections
    .filter(_isPlaceableSection)
    .map(function(it){
      return {
        name: it.section,
        description: _shortText(it.description || "", 220)
      };
    });
  var orphansForPrompt = stillOrphans.map(function(o, i){
    var w = orphanWikis[i];
    var desc = "";
    if (w) {
      desc = w.description || "";
      if (w.extract && desc.length < 200) {
        desc = (desc ? desc + ". " : "") + _shortText(w.extract, 280 - desc.length);
      } else if (!desc && w.extract) {
        desc = _shortText(w.extract, 280);
      }
    }
    return { name: o.name, description: desc };
  });
  var sectionsListStr = sectionsForPrompt.map(function(s){
    return '- "' + s.name + '"' + (s.description ? ': ' + s.description : '');
  }).join("\n");
  var orphansListStr = orphansForPrompt.map(function(o){
    return '- "' + o.name + '"' + (o.description ? ': ' + o.description : '');
  }).join("\n");
  var prompt = "You are categorizing travel sights into existing activity sections.\n\n"
    + "SECTIONS:\n" + sectionsListStr + "\n\n"
    + "UNCATEGORIZED SIGHTS:\n" + orphansListStr + "\n\n"
    + "For each uncategorized sight, return the EXACT section name (from the list above) that best fits it, or null if no section reasonably fits.\n"
    + "Output JSON only — an object keyed by sight name. Example:\n"
    + '{"Jökulsárgljúfur Canyon": "Visit natural wonders", "Some Other Sight": null}';
  var llmPlaced = [];
  var llmNullDecisions = [];
  try {
    var resp = await callMax([{ role: "user", content: prompt }], 600, 25000);
    var text = "";
    if (resp && resp.content && resp.content.length) {
      text = resp.content.map(function(c){ return c && c.text ? c.text : ""; }).join("");
    } else if (typeof resp === "string") {
      text = resp;
    }
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[PD.259] LLM returned no JSON; skipping");
      return;
    }
    var mapping = JSON.parse(jsonMatch[0]);
    var sectionsByName = {};
    sections.forEach(function(it){ sectionsByName[it.section] = it; });
    stillOrphans.forEach(function(o){
      var assigned = mapping[o.name];
      if (!assigned) {
        llmNullDecisions.push(o.name);
        return;
      }
      // PD.280: same fix as the heuristic — sectionsByName was built
      // when sectionVecs was snapshotted; re-resolve by section name
      // against the CURRENT _tb.placeActivities so the push is
      // visible to downstream render-time orphan detection.
      var _currentTarget = (_tb.placeActivities || []).find(function(it){
        return it && it.section === assigned;
      });
      if (!_currentTarget) {
        console.warn("[PD.259] LLM picked unknown section '" + assigned + "' for " + o.name);
        return;
      }
      // PD.283 safety net: even though the catchall is filtered out
      // of the prompt, refuse to "place" into it as a defense against
      // a hallucinated name. If the LLM somehow says "Other places to
      // consider," treat as a null decision so the cleanup below
      // doesn't pull the sight out.
      // PD.286: same defense for type:"route" sections — they're
      // also filtered from the prompt, but if a hallucinated name
      // resolves to one, treat as null (sight would vanish from view).
      if (!_isPlaceableSection(_currentTarget)) {
        llmNullDecisions.push(o.name);
        return;
      }
      var alreadyToks = _pd258TokensOf(o.key);
      var dup = (_currentTarget.requiredPlaces || []).some(function(p){
        if (!p || !p.place) return false;
        var pToks = _pd258TokensOf(p.place);
        var pTokSet = {};
        pToks.forEach(function(t){ pTokSet[t] = true; });
        return alreadyToks.every(function(t){ return pTokSet[t]; });
      });
      if (dup) return;
      if (!Array.isArray(_currentTarget.requiredPlaces)) _currentTarget.requiredPlaces = [];
      _currentTarget.requiredPlaces.push({
        place: o.name,
        country: o.country,
        nights: 0,
        overnight: false,
        _keep: true,
        _fromUserList: true,
        _reconciledByLlm: true
      });
      llmPlaced.push({ place: o.name, section: _currentTarget.section });
      // PD.283: if this sight was sitting in the backstop's "Other
      // places to consider" catchall, pull it out now that it has a
      // real categorical home. Match by token-subset so backstop
      // spellings ("Goðafoss Waterfall") match user-list spellings
      // ("Goðafoss") cleanly.
      try {
        var oTokens = _pd258TokensOf(o.name);
        var oSet = {}; oTokens.forEach(function(t){ oSet[t] = true; });
        (_tb.placeActivities || []).forEach(function(it){
          if (!_isCatchallSection(it)) return;
          if (!Array.isArray(it.requiredPlaces)) return;
          it.requiredPlaces = it.requiredPlaces.filter(function(p){
            if (!p || !p.place) return true;
            var pToks = _pd258TokensOf(p.place);
            if (!pToks.length) return true;
            var pSet = {}; pToks.forEach(function(t){ pSet[t] = true; });
            var pInO = pToks.every(function(t){ return oSet[t]; });
            var oInP = oTokens.every(function(t){ return pSet[t]; });
            return !(pInO || oInP); // remove on match
          });
        });
      } catch (_) {}
    });
  } catch (e) {
    console.warn("[PD.259] LLM reconciliation failed:", e && e.message);
    return;
  }
  // PD.283: after LLM placement, drop any "More places to consider"
  // section that's now empty. The user shouldn't see a half-empty
  // catchall when reconciliation re-homed everything in it.
  try {
    _tb.placeActivities = (_tb.placeActivities || []).filter(function(it){
      if (!_isCatchallSection(it)) return true;
      return Array.isArray(it.requiredPlaces) && it.requiredPlaces.length > 0;
    });
  } catch (_) {}
  console.log("[PD.259] LLM placed " + llmPlaced.length + " of " + stillOrphans.length + " sight(s)"
    + (llmPlaced.length ? ": " + llmPlaced.map(function(p){ return p.place + " → \"" + p.section + "\""; }).join("; ") : "")
    + (llmNullDecisions.length ? " | LLM said no-fit: " + llmNullDecisions.join(", ") : ""));
}
if (typeof globalThis !== "undefined") globalThis._reconcileListedSightsToSections = _reconcileListedSightsToSections;

// v359.60.27: unified "open the picker from trip view" entry point.
// Routes through the right reopener based on what data is available:
//   - mdcItems (Choreograph picker pipeline)        → reopenPickerForEdit
//   - _tb.placeActivities (paste/file mid-review)   → renderActivityPicker
//   - trip.candidates (legacy candidate-explorer)   → reopenCandidateExplorer
//   - nothing                                       → friendly alert
// Wired up from the trip-view Edit menu's "Edit destinations…" item.
// PD.182: validate route — runs the rough-spots realism check over
// the trip's actual sequenced destinations. Salvaged from the
// obsolete Candidate Explorer where this check ran pre-publish on
// candidates without sequencing (so distances were misleading).
// On the trip view, destinations are ordered, coords are real, and
// the warnings (long hops in a row, pace mismatch, too many stops)
// reflect what the user actually committed to.
function validateTripRoute() {
  if (typeof trip === "undefined" || !trip
      || !Array.isArray(trip.destinations) || trip.destinations.length < 2) {
    if (typeof maxAlert === "function") {
      maxAlert("Need at least two destinations to validate the route.");
    }
    return;
  }
  if (typeof MaxPickerUI === "undefined"
      || typeof MaxPickerUI.runRealismCheck !== "function"
      || typeof MaxPickerUI.showRealismCheckModal !== "function") {
    if (typeof maxAlert === "function") {
      maxAlert("Route validator isn't loaded — try refreshing the page.");
    }
    return;
  }
  // Build the kept-candidate shape the realism check expects.
  // Day trips have intent="dayTrip" so they're excluded from
  // segment distance calculations.
  var orderedKeeps = trip.destinations.map(function(d){
    if (!d) return null;
    return {
      place: d.place || "",
      country: d.country || "",
      lat: (typeof d.lat === "number") ? d.lat : null,
      lng: (typeof d.lng === "number") ? d.lng : null,
      nights: (typeof d.nights === "number") ? d.nights : 0,
      intent: d._isDayTrip ? "dayTrip" : (d.intent || "")
    };
  }).filter(Boolean);

  var briefLike = trip.brief || {};
  var issues;
  try {
    issues = MaxPickerUI.runRealismCheck(orderedKeeps, briefLike);
  } catch (e) {
    console.warn("[Max PD.182] realism check threw:", e);
    issues = [];
  }
  if (!issues || !issues.length) {
    if (typeof showSaveStatus === "function") {
      showSaveStatus("✓ Route looks clean — no rough spots flagged.", 5000);
    }
    return;
  }
  MaxPickerUI.showRealismCheckModal(
    issues,
    function onProceed() {},
    function onBack() {},
    {
      eyebrow: "Route check",
      title: "A few rough spots in your route",
      intro: "These show up when Max walks the sequence you committed. None are deal-breakers — adjust in Discovery if any catch your eye.",
      backLabel: "Close",
      hideProceed: true
    }
  );
}
if (typeof globalThis !== "undefined") globalThis.validateTripRoute = validateTripRoute;

function _reopenPickerAny() {
  // Round NC.X: defensive overlay reset BEFORE routing. The
  // #trip-brief-overlay is shared between Discovery (renderActivityPicker)
  // and Profile (editConstraints / renderTripBrief). If the user
  // clicked "Trip profile…" earlier, the overlay still holds the
  // brief-editor's innerHTML, and downstream renderers that
  // append-without-clearing left the old form visible behind the
  // new content — looking like "Discovery opened to Profile."
  // Clear the overlay and reset _editMode flags so the right
  // renderer paints from a clean slate.
  try {
    var resetOv = document.getElementById("trip-brief-overlay");
    if (resetOv) {
      resetOv.innerHTML = "";
      // Hide briefly to mask any in-flight repaint; the downstream
      // renderer (reopenPickerForEdit / renderActivityPicker /
      // reopenCandidateExplorer) sets display:block / flex as part
      // of its own setup.
      resetOv.style.display = "none";
    }
    // editConstraints leaves _tb._editingConstraints / similar flags;
    // clear what we know of so the picker code doesn't think we're
    // still in a profile-edit half-state.
    if (typeof _tb !== "undefined" && _tb) {
      // _editMode is the picker's flag — DON'T clear it; reopenPickerForEdit
      // sets it itself. Only clear unrelated profile flags.
      if (_tb._briefDirty)         _tb._briefDirty = false;
      if (_tb._briefPanel)         _tb._briefPanel = null;
    }
  } catch(_){}

  if (trip && Array.isArray(trip.placeActivities) && trip.placeActivities.length && typeof reopenPickerForEdit === "function") {
    try { console.log("[Max _reopenPickerAny] routing to reopenPickerForEdit (" + trip.placeActivities.length + " mdcItems)"); } catch(_){}
    reopenPickerForEdit();
    return;
  }
  // Paste/file stub trip — picker overlay holds the data on _tb.placeActivities.
  if (typeof _tb !== "undefined" && _tb && Array.isArray(_tb.placeActivities) && _tb.placeActivities.length && typeof renderActivityPicker === "function") {
    try { console.log("[Max _reopenPickerAny] routing to renderActivityPicker (" + _tb.placeActivities.length + " placeActivities)"); } catch(_){}
    var briefOv = document.getElementById("trip-brief-overlay");
    if (briefOv && briefOv.parentElement !== document.body) document.body.appendChild(briefOv);
    briefOv.style.display = "block";
    renderActivityPicker();
    return;
  }
  if (trip && Array.isArray(trip.candidates) && trip.candidates.length && typeof reopenCandidateExplorer === "function") {
    try { console.log("[Max _reopenPickerAny] routing to reopenCandidateExplorer (" + trip.candidates.length + " candidates)"); } catch(_){}
    reopenCandidateExplorer();
    return;
  }
  try { console.log("[Max _reopenPickerAny] no data — showing empty-state alert"); } catch(_){}
  alert("Nothing in Discovery yet — try Trip profile… in the menu instead.");
}
if (typeof globalThis !== "undefined") globalThis._reopenPickerAny = _reopenPickerAny;

// v360.2: Spark → Discovery loop. When the user has captured wisps via
// the Spark intake ("✨ What else might matter on this trip?") and the
// Discovery panel surfaces them as "N new ideas to evaluate", this
// function runs them through Max: a focused LLM call that turns each
// wisp into one or more must-do items (activity / route / condition)
// matching the existing _mdcItems schema. Results merge into
// trip.placeActivities; the wisps are marked processed; the picker re-opens
// with the new items visible.
//
// Architecturally this is the closure of audit Loop 3 (Structure ↔
// Spark). Without it, Spark is journaling. With it, captured ideas
// become candidate places Max can actually surface in Discovery.
async function evaluateWispsForDiscovery() {
  if (!trip || typeof _wispUnprocessed !== "function") {
    if (typeof maxAlert === "function") maxAlert("Couldn't read wisps.");
    return;
  }
  // v360.2: reentry guard. The LLM call takes 5-15 seconds; without a
  // visible "in progress" state the user might double-click the panel,
  // firing a second evaluation while the first is still in flight.
  // Bail early if one's already running.
  if (window._wispEvalInProgress) {
    console.log('[eval-wisps] ignored — evaluation already in progress');
    return;
  }
  var wisps = _wispUnprocessed(trip);
  if (!wisps.length) {
    // Nothing to do — fall through to normal picker open.
    if (typeof _reopenPickerAny === "function") _reopenPickerAny();
    return;
  }
  if (typeof callMax !== "function") {
    if (typeof maxAlert === "function") maxAlert("Max isn't available right now. Try again in a moment.");
    return;
  }
  // Mark in-progress + re-render so the panel shows an "Evaluating…" state.
  window._wispEvalInProgress = true;
  // R2: wrap everything below in try/finally. The flag gates re-entry (line
  // ~918) and drives the "Evaluating…" spinner; a throw anywhere in the merge/
  // persist path used to leave it stuck true → permanent lockout until reload.
  try {
  if (typeof drawTripMode === "function") {
    try { drawTripMode(); } catch (_) {}
  }

  // Show a lightweight overlay so the user sees Max is working. Re-use
  // the candidate-explorer loading shell if present; otherwise an
  // inline maxAlert-style toast keeps things visible.
  if (typeof showSaveStatus === "function") {
    showSaveStatus('✨ Asking Max to evaluate ' + wisps.length + ' new idea' + (wisps.length === 1 ? '' : 's') + '…', 8000);
  }

  // Build the prompt. We give Max the same shape it produced for the
  // initial Discovery extraction (see expandMustDos's TYPE 1/2/3 schema)
  // so merged items slot in cleanly. The existing items list is included
  // as context so Max doesn't double-up on things already on the trip.
  var region = (trip.brief && trip.brief.region) || "";
  var intent = (trip.brief && (trip.brief.intent || trip.brief.aboutTrip)) || "";
  var existing = Array.isArray(trip.placeActivities)
    ? trip.placeActivities.filter(function (m) { return m && m.checked; }).map(function (m) { return m.name; })
    : [];

  var wispLines = wisps.map(function (w, i) {
    return (i + 1) + '. "' + String(w.text || '').replace(/"/g, '\\"') + '"  [wispId: ' + w.id + ']';
  }).join('\n');

  var prompt =
    "A traveler is shaping a trip" + (region ? " to " + region : "") + ". " +
    (intent ? "Their original intent: \"" + intent + "\"\n" : "") +
    (existing.length ? "They've already committed to: " + existing.slice(0, 12).join(", ") + "\n" : "") +
    "\nThey just added these NEW ideas they want you to consider:\n" + wispLines + "\n\n" +
    "For each new idea, produce ONE or MORE must-do items in this shape. " +
    "Use type 'route' for scenic travel legs between specific named places, " +
    "'condition' for weather/season/daylight-dependent experiences (aurora, blooms, migration), " +
    "or 'activity' for anything else the traveler wants to do.\n\n" +
    "ACCURACY: If you're not certain about a route, place, or schedule, omit rather than guess. " +
    "Wrong specifics destroy trust. Better to return fewer items than to invent.\n\n" +
    "Include the source wispId on every item you produce so we can trace which idea it came from. " +
    "If a single wisp produces multiple items, each item gets the same wispId.\n\n" +
    "Return ONLY a JSON array (no markdown):\n" +
    '[\n' +
    '  {"name":"<Specific activity or place>","type":"activity","description":"<sentence about doing this well here>","requiredPlaces":[{"place":"<Place>","country":"<Country>"}],"durationHours":4,"wispId":"<source wisp id>"},\n' +
    '  {"name":"<Named route>","type":"route","description":"<sentence>","endpoints":[{"place":"<A>","country":"<C>"},{"place":"<B>","country":"<C>"}],"requiredPlaces":[{"place":"<A>","country":"<C>"},{"place":"<B>","country":"<C>"}],"transportModes":["train"],"durationHours":5,"wispId":"<source wisp id>"},\n' +
    '  {"name":"<Phenomenon>","type":"condition","description":"<sentence with months/caveats>","viableLocations":[{"place":"<P>","country":"<C>"}],"requiredPlaces":[{"place":"<P>","country":"<C>"}],"recovery":"moderate","frequencyRequirement":2,"conditionNote":"<what to know>","wispId":"<source wisp id>"}\n' +
    ']';

  var items;
  // v360.2: silent single retry. The first attempt sometimes fails with
  // a transient network blip or a JSON-shape glitch from the LLM (the
  // model occasionally returns text-wrapped JSON the parse can't pin
  // down). Retrying once on a clean state recovers in nearly all
  // cases. We only surface the scary modal if BOTH attempts fail —
  // and even then, the wisps are preserved so the user can try later.
  async function _runOnce() {
    var text = await callMax([{ role: "user", content: prompt }], 1800);
    var cleaned = (text || "").replace(/```json|```/g, "").trim();
    // Defensive JSON pinning: some responses wrap the array in prose.
    var firstBracket = cleaned.indexOf("[");
    var lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket > -1 && lastBracket > -1) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
    var parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("Max returned non-array");
    return parsed;
  }
  try {
    items = await _runOnce();
  } catch (e1) {
    console.warn("[wisps] first eval attempt failed, retrying:", e1);
    try {
      items = await _runOnce();
    } catch (e2) {
      console.error("[wisps] both eval attempts failed:", e2);
      window._wispEvalInProgress = false;
      if (typeof drawTripMode === "function") { try { drawTripMode(); } catch (_) {} }
      if (typeof maxAlert === "function") {
        maxAlert("Max couldn't evaluate the new ideas right now. They're still saved — try again in a moment.");
      }
      return;
    }
  }

  if (!items.length) {
    if (typeof maxAlert === "function") {
      maxAlert("Max read your ideas but didn't add anything new — possibly already covered, or too vague. The ideas remain captured.");
    }
    // Mark the wisps processed anyway so we don't loop on them — the
    // user can re-spark with more specificity if they want a re-eval.
    _wispMarkProcessed(trip, wisps.map(function (w) { return w.id; }), []);
    window._wispEvalInProgress = false;
    if (typeof autoSave === "function") autoSave();
    if (typeof drawTripMode === "function") drawTripMode();
    return;
  }

  // Merge items into trip.placeActivities. Each gets a fresh id and is
  // checked-by-default so it shows up as a kept item in the picker.
  if (!Array.isArray(trip.placeActivities)) trip.placeActivities = [];
  var wispToResults = {};
  var addedIds = [];
  items.forEach(function (it, i) {
    if (!it || !it.name) return;
    var id = "m-wisp-" + Date.now() + "-" + i + "-" + Math.random().toString(36).slice(2, 5);
    var mdcItem = {
      id: id,
      name: it.name,
      type: it.type || "activity",
      description: it.description || "",
      checked: true,
      requiredPlaces: Array.isArray(it.requiredPlaces) ? it.requiredPlaces.map(function (p) {
        return {
          place: p.place,
          country: p.country || "",
          nights: 2,
          lat: p.lat || null,
          lng: p.lng || null,
          _keep: true,
          _isDayTrip: false,
          _dayTripHub: "",
        };
      }) : [],
      _fromWispId: it.wispId || null,
    };
    // Route-specific fields
    if (it.type === "route") {
      if (Array.isArray(it.endpoints)) mdcItem.endpoints = it.endpoints;
      if (Array.isArray(it.transportModes)) mdcItem.transportModes = it.transportModes;
      if (typeof it.durationHours === "number") mdcItem.durationHours = it.durationHours;
    }
    // Condition-specific
    if (it.type === "condition") {
      if (Array.isArray(it.viableLocations)) mdcItem.viableLocations = it.viableLocations;
      if (it.recovery) mdcItem.recovery = it.recovery;
      if (it.frequencyRequirement) mdcItem.frequencyRequirement = it.frequencyRequirement;
      if (it.conditionNote) mdcItem.conditionNote = it.conditionNote;
    }
    if (typeof it.durationHours === "number") mdcItem.durationHours = it.durationHours;
    trip.placeActivities.push(mdcItem);
    addedIds.push(id);
    if (it.wispId) {
      if (!wispToResults[it.wispId]) wispToResults[it.wispId] = [];
      wispToResults[it.wispId].push(id);
    }
  });

  // Mark wisps processed; record which mdc items they spawned.
  wisps.forEach(function (w) {
    var produced = wispToResults[w.id] || [];
    _wispMarkProcessed(trip, [w.id], produced);
  });

  if (typeof autoSave === "function") autoSave();
  // v360.2: stash the result so the picker can show an unmissable
  // banner when it opens. The toast goes by too fast and the picker
  // covers it before the user reads. A banner inside the picker says
  // "Max added N items from your idea — they're checked below" and
  // stays put until dismissed.
  window._lastWispEvalResult = {
    addedItemIds: addedIds.slice(),
    addedCount: addedIds.length,
    wispCount: wisps.length,
    wispTexts: wisps.map(function (w) { return w.text; }),
    evaluatedAt: Date.now(),
  };
  window._wispEvalInProgress = false;
  console.log('[eval-wisps] set _lastWispEvalResult', {
    addedCount: addedIds.length,
    wispCount: wisps.length,
    addedItemIds: addedIds,
    onWindow: !!window._lastWispEvalResult,
    onGlobalThis: !!(typeof globalThis !== 'undefined' && globalThis._lastWispEvalResult),
  });
  // v360.2: don't auto-open Discovery. The user may have dropped a wisp
  // mid-task and want to keep working on something else; yanking them
  // into the picker breaks the late-binding promise (commitment is
  // deferred until the user is ready). Instead, the Discovery panel
  // takes on a "results ready" state — green tint, "✓ Max added N new
  // must-dos — review →" — and waits for them to open it on their own
  // schedule. The in-picker banner still fires when they do open it.
  if (typeof drawTripMode === "function") {
    try { drawTripMode(); } catch (_) {}
  }
  } finally {
    // R2: never leave the eval flag stuck. The explicit clears on the early
    // return paths above are now redundant but harmless; this guarantees the
    // flag is cleared on EVERY exit, including an unexpected throw.
    window._wispEvalInProgress = false;
  }
}
if (typeof globalThis !== "undefined") globalThis.evaluateWispsForDiscovery = evaluateWispsForDiscovery;

// v360.2: one-click "ask Max for more places" path from the trip view.
// The Discovery panel's cream (default) state used to just open the
// picker — to actually get NEW places, the user had to scroll inside
// the picker and click "Discover more places →" buried at the bottom.
// Two-click + scroll for a primary action. This wrapper opens the
// picker AND immediately kicks off discoverBreadthPlaces (the breadth
// LLM call), then scrolls the breadth-suggestions section into view
// once results land. One click from trip view to "Max, find me more."
//
// Browsing existing picker state (without generating) is still
// available via the ⋯ More menu → "Open Discovery."
function returnToPickerForMore() {
  if (typeof _reopenPickerAny !== "function") return;
  _reopenPickerAny();
  // Give the picker a beat to mount + hydrate _tb.placeActivities.
  setTimeout(function () {
    if (typeof discoverBreadthPlaces === "function") {
      // Force a fresh fetch — clear any cached suggestions so the user
      // gets new places every time they ask. (discoverBreadthPlaces
      // short-circuits on cache hit; we want a real LLM run here.)
      if (typeof _tb !== "undefined" && _tb) _tb._breadthSuggestions = null;
      discoverBreadthPlaces();
    }
    // Scroll the breadth section into view so the user sees where
    // the new places are landing.
    setTimeout(function () {
      var sec = document.getElementById("tb-breadth-section");
      if (sec && sec.scrollIntoView) {
        try { sec.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
      }
    }, 300);
  }, 250);
}
if (typeof globalThis !== "undefined") globalThis.returnToPickerForMore = returnToPickerForMore;

// v360.2: captured-ideas modal. Lists every wisp the user has dropped
// into Spark, with status (pending evaluation / evaluated), what it
// produced, and delete affordances at both the wisp level and the
// per-item level. The "view history" link below the Spark intake opens
// this. Closes the late-binding loop on the user's intellectual
// history of the trip — wisps don't vanish into a black hole.
function showWispHistoryModal() {
  if (!trip) return;
  var existing = document.getElementById("wisp-history-overlay");
  if (existing) existing.remove();
  // Run migrations (legacy ✨-notes + initial intent/must-do) before
  // reading. _wispsArrayMigrated returns the array with both done.
  var wisps = (typeof _wispsArrayMigrated === "function")
    ? _wispsArrayMigrated(trip)
    : (trip.brief && trip.brief.tripMeta && trip.brief.tripMeta.wisps) || [];

  var ov = document.createElement("div");
  ov.id = "wisp-history-overlay";
  ov.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:11900;" +
    "display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;" +
    "font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;";
  var box = document.createElement("div");
  box.style.cssText =
    "background:var(--c-bg);border-radius:10px;width:560px;max-width:96vw;max-height:90vh;" +
    "display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;";

  // Header
  var head = document.createElement("div");
  head.style.cssText =
    "display:flex;align-items:baseline;justify-content:space-between;gap:12px;" +
    "padding:18px 22px 12px;border-bottom:1px solid #eee;flex-shrink:0;";
  var h = document.createElement("div");
  h.style.cssText = "font-size:16px;font-weight:700;color:var(--c-ink);";
  h.innerHTML = "✨ Captured ideas <span style=\"font-size:12px;color:#888;font-weight:500;margin-left:6px;\">" + wisps.length + "</span>";
  var x = document.createElement("button");
  x.type = "button";
  x.style.cssText = "background:none;border:none;color:var(--c-ink-3);font-size:18px;cursor:pointer;padding:0 4px;";
  x.textContent = "✕";
  x.onclick = function () { ov.remove(); };
  head.appendChild(h);
  head.appendChild(x);
  box.appendChild(head);

  // Body
  var body = document.createElement("div");
  body.style.cssText = "overflow-y:auto;padding:14px 22px 22px;flex:1;";
  box.appendChild(body);

  function esc(s){ return _escHtml(s); }
  function fmtRelative(iso) {
    if (!iso) return "";
    try {
      var t = new Date(iso).getTime();
      var d = Date.now() - t;
      if (d < 60000) return "just now";
      if (d < 3600000) return Math.round(d / 60000) + "m ago";
      if (d < 86400000) return Math.round(d / 3600000) + "h ago";
      return Math.round(d / 86400000) + "d ago";
    } catch (_) { return iso; }
  }

  function _render() {
    // v360.2: re-read wisps from the live trip data on every render
    // so post-edit mutations / dedupes / autoSave roundtrips show up.
    // The earlier code captured `wisps` once at modal-open and reused
    // it — which worked because the array reference was live, but a
    // sync poll could replace the array on trip and the modal would
    // see stale data. Re-reading is cheap and removes that risk.
    wisps = (typeof _wispsArrayMigrated === "function")
      ? _wispsArrayMigrated(trip)
      : (trip.brief && trip.brief.tripMeta && trip.brief.tripMeta.wisps) || [];
    console.log("[wisp-modal] _render — wisps:", wisps.length);
    body.innerHTML = "";
    if (!wisps.length) {
      var empty = document.createElement("div");
      empty.style.cssText = "font-size:12.5px;color:var(--c-ink-3);font-style:italic;padding:20px 0;text-align:center;";
      empty.textContent = "No captured ideas yet. Type one into the ✨ input on your trip view to start.";
      body.appendChild(empty);
      return;
    }
    // Newest first.
    var sorted = wisps.slice().sort(function (a, b) {
      return (b.capturedAt || "").localeCompare(a.capturedAt || "");
    });
    sorted.forEach(function (w) {
      var card = document.createElement("div");
      card.style.cssText =
        "margin-bottom:12px;padding:11px 13px;border:1px solid #e6e2d8;border-radius:7px;background:var(--c-bg);";

      // Top row: wisp text + delete
      var topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:12px;";
      var textBlock = document.createElement("div");
      textBlock.style.cssText = "flex:1;min-width:0;";
      var textEl = document.createElement("div");
      textEl.style.cssText = "font-size:13px;font-weight:600;color:#222;line-height:1.4;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
      var textInner = document.createElement("span");
      textInner.innerHTML = "✨ " + esc(w.text || "(empty)");
      textEl.appendChild(textInner);
      // Initial-wisp badge — visual marker for the trip's seed wisps so
      // the user can see which were typed at creation vs sparked later.
      if (w._initial) {
        var badge = document.createElement("span");
        badge.style.cssText =
          "font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;" +
          "color:#5c4520;background:#fbf6e8;border:1px solid #e6d5a0;" +
          "padding:1px 6px;border-radius:9px;";
        // _initialKind distinguishes 'why' (intent fragments) from
        // 'anchor' (must-do fragments) for slightly different framing.
        badge.textContent = (w._initialKind === 'anchor') ? 'Initial anchor' : 'Initial why';
        textEl.appendChild(badge);
      }
      textBlock.appendChild(textEl);
      var metaEl = document.createElement("div");
      metaEl.style.cssText = "font-size:11px;color:var(--c-ink-3);margin-top:3px;";
      var status;
      if (w._initial) {
        // Initial wisps are pre-processed (they drove the first Discovery
        // extraction at trip creation). The wording reflects that.
        status = "From trip creation";
      } else if (w.processedAt) {
        status = "Evaluated " + fmtRelative(w.processedAt) + " · captured " + fmtRelative(w.capturedAt);
      } else {
        status = "Pending evaluation · captured " + fmtRelative(w.capturedAt);
      }
      metaEl.textContent = status;
      textBlock.appendChild(metaEl);
      topRow.appendChild(textBlock);

      // Action button group (Edit + Delete).
      var actionGroup = document.createElement("div");
      actionGroup.style.cssText = "display:flex;gap:6px;flex-shrink:0;";

      // v360.2: inline edit. Click → text becomes an input with Save +
      // Cancel. Lets the user refine awkward fragments ("with hot
      // springs" → "hot springs") or sharpen wording over time
      // ("hot springs" → "hot springs at sunrise") without having to
      // delete + recapture. Aligns with late-binding — every wisp
      // stays editable as the user's thinking evolves.
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.style.cssText =
        "background:var(--c-bg);color:var(--c-primary);border:1px solid #c0d4ec;font-family:inherit;" +
        "font-size:11px;font-weight:600;padding:4px 9px;border-radius:5px;cursor:pointer;flex-shrink:0;";
      editBtn.textContent = "Edit";
      editBtn.onclick = (function (wid, originalText, ownTextEl, ownTopRow) {
        return function () {
          // Replace the text element with an input + save/cancel.
          var editWrap = document.createElement("div");
          editWrap.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;width:100%;";
          var input = document.createElement("input");
          input.type = "text";
          input.value = originalText;
          input.style.cssText =
            "flex:1;min-width:140px;font-family:inherit;font-size:13px;" +
            "padding:5px 8px;border:1px solid #c0d4ec;border-radius:4px;" +
            "outline:none;color:#222;background:#fff;";
          var saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.style.cssText =
            "background:var(--c-primary);color:var(--c-on-dark);border:none;font-family:inherit;" +
            "font-size:11px;font-weight:600;padding:5px 10px;border-radius:4px;cursor:pointer;";
          saveBtn.textContent = "Save";
          var cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.style.cssText =
            "background:var(--c-bg);color:#666;border:1px solid var(--c-border);font-family:inherit;" +
            "font-size:11px;font-weight:600;padding:5px 10px;border-radius:4px;cursor:pointer;";
          cancelBtn.textContent = "Cancel";
          editWrap.appendChild(input);
          editWrap.appendChild(saveBtn);
          editWrap.appendChild(cancelBtn);
          // Swap the text element out for the edit wrap.
          ownTextEl.style.display = "none";
          ownTextEl.parentNode.insertBefore(editWrap, ownTextEl);
          // Hide the action buttons during edit so the row stays clean.
          actionGroup.style.display = "none";
          input.focus();
          input.select();

          function _commit() {
            var newText = input.value.trim();
            console.log("[wisp-edit] _commit fired", { newText: newText, originalText: originalText, wid: wid });
            if (!newText || newText === originalText) {
              console.log("[wisp-edit] no change — cancelling");
              _cancel();
              return;
            }
            // Mutate the wisp directly on the live array.
            var allWisps = (trip.brief && trip.brief.tripMeta && trip.brief.tripMeta.wisps) || [];
            console.log("[wisp-edit] total wisps:", allWisps.length);
            var found = false;
            for (var i = 0; i < allWisps.length; i++) {
              if (allWisps[i] && allWisps[i].id === wid) {
                console.log("[wisp-edit] found wisp at index " + i + ", changing '" + allWisps[i].text + "' → '" + newText + "'");
                allWisps[i].text = newText;
                if (!Array.isArray(allWisps[i].revisions)) allWisps[i].revisions = [];
                allWisps[i].revisions.push({ from: originalText, to: newText, editedAt: (new Date()).toISOString() });
                found = true;
                break;
              }
            }
            if (!found) {
              console.warn("[wisp-edit] could not find wisp by id:", wid, "in", allWisps.length, "wisps");
            }
            if (typeof autoSave === "function") {
              try { autoSave(); console.log("[wisp-edit] autoSave fired"); }
              catch (e) { console.warn("[wisp-edit] autoSave threw:", e); }
            }
            console.log("[wisp-edit] calling _render");
            try { _render(); console.log("[wisp-edit] _render returned"); }
            catch (e) { console.error("[wisp-edit] _render threw:", e); }
            if (typeof drawTripMode === "function") { try { drawTripMode(); } catch (_) {} }
          }
          function _cancel() {
            editWrap.parentNode.removeChild(editWrap);
            ownTextEl.style.display = "";
            actionGroup.style.display = "";
          }
          saveBtn.onclick = _commit;
          cancelBtn.onclick = _cancel;
          input.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter") { ev.preventDefault(); _commit(); }
            else if (ev.key === "Escape") { ev.preventDefault(); _cancel(); }
          });
        };
      })(w.id, w.text || "", textEl, topRow);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.style.cssText =
        "background:var(--c-bg);color:#a02020;border:1px solid #e0b0b0;font-family:inherit;" +
        "font-size:11px;font-weight:600;padding:4px 9px;border-radius:5px;cursor:pointer;flex-shrink:0;";
      delBtn.textContent = "Delete";
      delBtn.onclick = (function (wid, hasResults, isInitial, wispText) {
        return function () {
          // Initial wisps get a gentle confirmation since they're the
          // trip's seed — see the lineage section of Max-An-Introduction.
          // The trip itself stays intact; only the recorded "why" goes.
          if (isInitial) {
            var ok = confirm(
              "Delete the initial idea \"" + wispText + "\"?\n\n" +
              "This was part of the trip's original reason for being. " +
              "Deleting it doesn't change what you've planned — the destinations, " +
              "bookings, and decisions stay. But the recorded \"why\" goes away.\n\n" +
              "OK to delete, Cancel to keep."
            );
            if (!ok) return;
          }
          var also = false;
          if (hasResults) {
            also = confirm("Also delete the " + hasResults + " place(s) this idea produced?\n\nOK = delete idea + items.\nCancel = delete idea, keep items.");
          }
          if (typeof _wispDelete === "function") _wispDelete(trip, wid, also);
          if (typeof autoSave === "function") autoSave();
          // Refresh local view + trip view.
          wisps = (trip.brief && trip.brief.tripMeta && trip.brief.tripMeta.wisps) || [];
          h.innerHTML = "✨ Captured ideas <span style=\"font-size:12px;color:#888;font-weight:500;margin-left:6px;\">" + wisps.length + "</span>";
          _render();
          if (typeof drawTripMode === "function") { try { drawTripMode(); } catch (_) {} }
        };
      })(w.id, (w.resultItemIds || []).length, !!w._initial, w.text || "");
      actionGroup.appendChild(editBtn);
      actionGroup.appendChild(delBtn);
      topRow.appendChild(actionGroup);
      card.appendChild(topRow);

      // Produced items, if any.
      var resultIds = Array.isArray(w.resultItemIds) ? w.resultItemIds : [];
      if (resultIds.length && Array.isArray(trip.placeActivities)) {
        var items = trip.placeActivities.filter(function (m) { return m && resultIds.indexOf(m.id) >= 0; });
        if (items.length) {
          var itemsHdr = document.createElement("div");
          itemsHdr.style.cssText = "font-size:10.5px;font-weight:700;color:var(--c-ink-3);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 5px;";
          itemsHdr.textContent = "Max produced " + items.length + " item" + (items.length === 1 ? "" : "s");
          card.appendChild(itemsHdr);
          items.forEach(function (m) {
            var row = document.createElement("div");
            row.style.cssText =
              "display:flex;align-items:center;justify-content:space-between;gap:10px;" +
              "padding:6px 9px;background:#fafaf6;border:1px solid #ebe6da;border-radius:5px;margin-top:4px;";
            var nm = document.createElement("div");
            nm.style.cssText = "font-size:12px;color:#222;flex:1;min-width:0;";
            nm.textContent = m.name || "(unnamed item)";
            var del = document.createElement("button");
            del.type = "button";
            del.title = "Delete this item";
            del.style.cssText =
              "background:transparent;color:#999;border:none;font-size:14px;cursor:pointer;padding:0 6px;line-height:1;flex-shrink:0;";
            del.textContent = "✕";
            del.onmouseover = function () { del.style.color = "#a02020"; };
            del.onmouseout  = function () { del.style.color = "#999"; };
            del.onclick = (function (iid) {
              return function () {
                if (typeof _mdcItemDelete === "function") _mdcItemDelete(trip, iid);
                if (typeof autoSave === "function") autoSave();
                _render();
                if (typeof drawTripMode === "function") { try { drawTripMode(); } catch (_) {} }
              };
            })(m.id);
            row.appendChild(nm);
            row.appendChild(del);
            card.appendChild(row);
          });
        }
      }
      body.appendChild(card);
    });
  }
  _render();

  ov.appendChild(box);
  ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}
if (typeof globalThis !== "undefined") globalThis.showWispHistoryModal = showWispHistoryModal;

// v359.60.22: append parsed paste-list destinations to the CURRENT
// trip (used by the Research notes "Make destinations from this list"
// button). Dates cascade from the last existing destination's dateTo
// — or from today if the trip has no destinations yet. Entry/exit
// hints from the parse only apply if the trip's brief doesn't have
// them set already (don't clobber user choices).
function _addPastedListToCurrentTrip(parseResult) {
  if (!parseResult || !Array.isArray(parseResult.destinations) || !parseResult.destinations.length) return 0;
  if (!trip) return 0;
  if (!Array.isArray(trip.destinations)) trip.destinations = [];
  var cur;
  if (trip.destinations.length) {
    var lastTo = trip.destinations[trip.destinations.length - 1].dateTo;
    cur = lastTo ? new Date(lastTo + "T12:00:00") : new Date();
  } else {
    // v359.60.23: empty-trip cascade origin — prefer (in order):
    //   1. parseResult.startDate (frontmatter `Start: YYYY-MM-DD`)
    //   2. trip.brief._pendingStartDate (set when the stub trip was
    //      minted from a paste; once consumed we clear it below)
    //   3. today
    var pending = (trip.brief && trip.brief._pendingStartDate) || null;
    var seed = parseResult.startDate || pending || "";
    if (seed) {
      cur = new Date(seed + "T12:00:00");
    } else {
      cur = new Date();
    }
    if (trip.brief && trip.brief._pendingStartDate) {
      try { delete trip.brief._pendingStartDate; } catch(_){}
    }
  }
  var added = 0;
  parseResult.destinations.forEach(function(p) {
    if (typeof destCtr !== "number") destCtr = 0;
    destCtr++;
    var id = "d" + destCtr;
    var dateFromStr = cur.toISOString().slice(0, 10);
    var nx = new Date(cur); nx.setDate(nx.getDate() + (p.nights || 0));
    var dateToStr = nx.toISOString().slice(0, 10);
    var days = (typeof makeDays === "function")
      ? makeDays(id, p.place, p.intent || p.place, dateFromStr, p.nights || 0)
      : [];
    trip.destinations.push({
      id: id, place: p.place, intent: p.intent || p.place,
      dateFrom: dateFromStr, dateTo: dateToStr, nights: p.nights || 0,
      days: days,
      trackerItems: { booked: [], see: [], visited: [] },
      trackerCat: "booked", storyState: "idle",
      hotelBookings: [], generalBookings: [], locations: [],
      execMode: false, todayItems: [], discoveredItems: [], suggestions: []
    });
    // PD.325: enqueue instead of fire-and-forget so a multi-destination
    // paste-list-add doesn't bomb the LLM with parallel calls.
    if (typeof MaxEnrich !== "undefined" && typeof generateCityData === "function") {
      MaxEnrich.enqueue(id, p.place);
    } else if (typeof generateCityData === "function") {
      try { generateCityData(p.place, id); } catch(_){}
    }
    cur = nx;
    added++;
  });
  // Auto-wire entry/exit if the brief doesn't already have them.
  if (!trip.brief) trip.brief = {};
  if (parseResult.entry && !trip.brief.entry) trip.brief.entry = parseResult.entry;
  if (parseResult.exit && !trip.brief.tbExit) trip.brief.tbExit = parseResult.exit;
  if (typeof _emitTripMutation === "function") _emitTripMutation();
  return added;
}
if (typeof globalThis !== "undefined") globalThis._addPastedListToCurrentTrip = _addPastedListToCurrentTrip;

// v359.60.22: paste-list modal — shared between home-screen and any
// other surface that wants to accept a free-text list. opts.onBuild
// receives the parsed result; the caller decides what to do with it
// (new trip vs. append to current).
function _openPasteListModal(opts) {
  opts = opts || {};
  var existing = document.getElementById("paste-list-overlay");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "paste-list-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10800;display:flex;align-items:center;justify-content:center;padding:24px;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:560px;max-width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 36px rgba(0,0,0,0.22);";
  var title = opts.title || "Paste a list of places";
  var subtitle = opts.subtitle || "First line is the trip name + region — e.g. <em>Iceland Road Trip 2026 (Iceland)</em>. Optional second line for dates — <em>September 17, 17 nights</em> works. Then one place per line. After Open, you'll land in Discovery with your places grouped into activity themes — review, keep/reject, and add what Max missed before committing destinations.";
  box.innerHTML = ''
    + '<div style="padding:16px 20px 10px;border-bottom:1px solid var(--c-border-3);">'
    +   '<div style="font-size:15px;font-weight:700;color:var(--c-ink);">' + title + '</div>'
    +   '<div style="font-size:11.5px;color:#777;margin-top:5px;line-height:1.5;">' + subtitle + '</div>'
    + '</div>'
    + '<div style="flex:1;overflow-y:auto;padding:14px 20px;display:flex;flex-direction:column;gap:10px;">'
    +   '<textarea id="paste-list-ta" placeholder="Iceland Road Trip 2026 (Iceland)&#10;September 17, 17 nights&#10;&#10;1. Overnight hubs&#10;* Reykjavík (Arrival/Departure point)&#10;* Vík 2&#10;* Akureyri 3&#10;&#10;2. Sights&#10;* Gullfoss&#10;* Skógafoss" style="width:100%;min-height:260px;font:inherit;font-size:12.5px;line-height:1.5;padding:8px 10px;border:1px solid var(--c-border-strong);border-radius:6px;background:var(--c-bg);color:var(--c-ink);resize:vertical;font-family:inherit;"></textarea>'
    +   '<div id="paste-list-preview" style="font-size:11.5px;color:var(--c-ink-2);line-height:1.55;min-height:18px;"></div>'
    + '</div>'
    + '<div style="padding:12px 20px;border-top:1px solid var(--c-border-3);display:flex;justify-content:flex-end;gap:8px;">'
    +   '<button id="paste-list-cancel" type="button" style="font-size:13px;font-weight:500;color:var(--c-ink-2);background:var(--c-bg);border:1px solid var(--c-border-strong);border-radius:6px;padding:8px 14px;cursor:pointer;font-family:inherit;">Cancel</button>'
    +   '<button id="paste-list-build" type="button" style="font-size:13px;font-weight:700;color:var(--c-on-dark);background:var(--c-primary);border:1px solid var(--c-primary);border-radius:6px;padding:8px 18px;cursor:pointer;font-family:inherit;" disabled>' + (opts.buildLabel || "Build trip →") + '</button>'
    + '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  function close() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
  // PD.166: backdrop click does NOT close. Paste modals contain
  // active text-editing — losing a pasted list to an errant click
  // on the dim area is high-cost. Cancel button is the explicit exit.
  document.getElementById("paste-list-cancel").onclick = close;
  var ta = /** @type {HTMLTextAreaElement} */ (document.getElementById("paste-list-ta"));
  var buildBtn = /** @type {HTMLButtonElement} */ (document.getElementById("paste-list-build"));
  var prev = document.getElementById("paste-list-preview");
  function refresh() {
    var parsed = parsePlacesList(ta.value);
    var nStay = parsed.destinations.filter(function(d){ return d.isStay; }).length;
    var nSee  = parsed.destinations.filter(function(d){ return !d.isStay; }).length;
    var bits = [];
    if (parsed.tripName) {
      bits.push('trip: <strong>' + parsed.tripName + '</strong>');
    }
    if (parsed.region && parsed.region !== parsed.tripName) {
      bits.push('region: <strong>' + parsed.region + '</strong>');
    }
    if (parsed.destinations.length) {
      bits.push('<strong>' + parsed.destinations.length + '</strong> destination' + (parsed.destinations.length === 1 ? '' : 's') + ' (' + nStay + ' stay, ' + nSee + ' see)');
    }
    if (parsed.startDate) bits.push('starts <strong>' + parsed.startDate + '</strong>');
    else if (parsed.when) bits.push('when: <strong>' + parsed.when + '</strong>');
    if (parsed.duration) bits.push('duration: <strong>' + parsed.duration + '</strong>');
    if (parsed.entry) bits.push('entry: <strong>' + parsed.entry + '</strong>');
    if (parsed.exit && parsed.exit !== parsed.entry) bits.push('exit: <strong>' + parsed.exit + '</strong>');
    if (parsed.entry && parsed.exit === parsed.entry) bits.push('round trip via <strong>' + parsed.entry + '</strong>');
    prev.innerHTML = bits.length
      ? ('Will create: ' + bits.join(' · ') + (parsed.destinations.length ? '' : '<br><span style="color:var(--c-ink-3);">No destinations parsed yet — you can add them in Discovery after the trip opens.</span>'))
      : '<span style="color:var(--c-ink-4);">Paste a list above to see a preview.</span>';
    // Allow Build with just a trip name (no destinations) — the
    // research-notes editing pass is where the user actually commits.
    buildBtn.disabled = !(parsed.tripName || parsed.destinations.length);
  }
  ta.addEventListener("input", refresh);
  refresh();
  buildBtn.onclick = function() {
    var raw = ta.value;
    var parsed = parsePlacesList(raw);
    if (!parsed.tripName && !parsed.destinations.length) return;
    close();
    if (typeof opts.onBuild === "function") opts.onBuild(parsed, raw);
  };
  setTimeout(function() { try { ta.focus(); } catch(_){} }, 30);
}
if (typeof globalThis !== "undefined") globalThis._openPasteListModal = _openPasteListModal;

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._addPastedListToCurrentTrip = _addPastedListToCurrentTrip;
  __expg._constructUserListedItems = _constructUserListedItems;
  __expg._openPasteListModal = _openPasteListModal;
  __expg._reconcileListedSightsToSections = _reconcileListedSightsToSections;
  __expg._reopenPickerAny = _reopenPickerAny;
  __expg._runThemingPass = _runThemingPass;
  __expg.evaluateWispsForDiscovery = evaluateWispsForDiscovery;
  __expg.returnToPickerForMore = returnToPickerForMore;
  __expg.showWispHistoryModal = showWispHistoryModal;
  __expg.validateTripRoute = validateTripRoute;
}
