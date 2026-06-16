// @ts-check
// discovery-adapter.js — PD.401g: the Discovery placement adapter.
//
// Extracted verbatim from index.html's inline script (strangler-fig:
// shrink the monolith one cohesive unit at a time). This is the thin
// glue layer between the live trip state (_tb.placeActivities) and the
// pure DiscoveryModel: it builds the model through the ONE ingestion,
// reads its derivation, and writes the re-derived sections back.
//
// It is intentionally a classic (non-module) script that runs in global
// scope, exactly as it did inline — so the seams it uses (MaxDiscovery,
// MaxData, TripStore, PlaceKey, _tb, window._placeOrigin,
// window._isStaySection) resolve as the same runtime globals. Loaded
// AFTER discovery-model.js so the model is defined before any render
// call reaches in. The functions only run at render time, so load order
// among the helper scripts is otherwise immaterial.

// PD.401c: the app's classifiers for the ONE ingestion. Built once here
// so the render, the receipt banner, and MaxData's count surfaces all
// hand DiscoveryModel.fromPlaceActivities the SAME notions of "stay
// section", "origin", "destination", and "hub". One derivation, one set.
function _discoveryOpts(){
  var t = (typeof TripStore !== "undefined" && TripStore.isLoaded && TripStore.isLoaded()) ? TripStore.trip
    : ((typeof trip !== "undefined") ? trip : null);
  var _rk = function(name){ return window.PlaceKey ? PlaceKey.resolve(name) : String(name||"").toLowerCase().trim(); };
  var destKeys = {};
  try {
    var ds = (t && typeof MaxData !== "undefined" && MaxData.getDestinations) ? MaxData.getDestinations(t)
      : ((t && t.destinations) || []);
    (ds || []).forEach(function(d){ if (d && d.place) destKeys[_rk(d.place)] = 1; });
    // Match MaxData.consideredPlaceKeys exactly: a place that appears in
    // ANY stay section is a stay, not a considered sight — exclude it
    // from the count the same way, so the banner == the trip pill.
    //
    // SSOT Stage 2 (kill the 17<->131 bistability): read the stay-section
    // places from the PERSISTED trip (t.placeActivities), NOT the volatile
    // _tb.placeActivities. The render's _applyDiscoveryModelToSights()
    // REASSIGNS _tb.placeActivities every paint; building destKeys from that
    // same mutating array made the exclusion set depend on the render's own
    // output — a feedback loop with two self-consistent fixed points (17 and
    // 131) that flipped on every re-open. The persisted trip is the stable,
    // canonical input MaxData already uses, so deriving destKeys from it makes
    // the considered set deterministic across re-opens (and matches the comment
    // above, which always intended "same as MaxData.consideredPlaceKeys").
    var _pa = (t && Array.isArray(t.placeActivities)) ? t.placeActivities : [];
    _pa.forEach(function(it){
      if (it && window._isStaySection && window._isStaySection(it.section)) {
        (it.requiredPlaces || []).forEach(function(p){ if (p && p.place) destKeys[_rk(p.place)] = 1; });
      }
    });
  } catch(_){}
  return {
    isStaySection: function(s){ return !!window._isStaySection && window._isStaySection(s); },
    originOf: function(p){ return window._placeOrigin ? window._placeOrigin(p) : "max"; },
    isDestination: function(p){
      if (!p || !p.place) return false;
      var k = window.PlaceKey ? PlaceKey.resolve(p.place) : String(p.place).toLowerCase().trim();
      return !!destKeys[k];
    },
    isHub: function(p){ return !!(p && (p._autoCreated || p._origin === "max-hub")); }
  };
}

// SSOT Stage 2: the canonical, render-independent source for every Discovery
// COUNT. The receipt banner used to build its model from _tb.placeActivities —
// the working array the render rewrites every paint. The reconcile pass
// (_reconcileUserListedKeeps -> the PD.256/258/285 orphan-catchall rebuild) can
// DROP whole synthetic-enhance sections from _tb (e.g. the 114-place "Sights
// near places you listed"), and whether it has run depends on a 150ms render
// throttle (PD.376) — so the same trip read the banner as 17 OR 131 depending on
// timing, flipping on every re-open. The PERSISTED trip.placeActivities is the
// stable, lossless source the map and the trip pill already read; deriving the
// count from it makes the banner deterministic across re-opens AND identical to
// the map by construction. Falls back to _tb only if no trip is loaded yet.
function _discoveryCountSource(){
  var t = (typeof TripStore !== "undefined" && TripStore.isLoaded && TripStore.isLoaded()) ? TripStore.trip
    : ((typeof trip !== "undefined") ? trip : null);
  if (t && Array.isArray(t.placeActivities) && t.placeActivities.length) {
    // SSOT Stage 3: unify the two considered pools. Fold the legacy
    // dest.suggestions._considered set into placeActivities (non-destructive)
    // so the banner counts the SAME complete, sectioned set the map draws —
    // banner == map by construction, no more 131-vs-186 gap.
    if (typeof MaxData !== "undefined" && typeof MaxData.foldConsideredSuggestionsIntoPlaceActivities === "function") {
      try { return MaxData.foldConsideredSuggestionsIntoPlaceActivities(t).placeActivities; } catch(_){}
    }
    return t.placeActivities;
  }
  return (typeof _tb !== "undefined" && _tb && Array.isArray(_tb.placeActivities)) ? _tb.placeActivities : [];
}

// PD.401c: the considered count, derived from the SAME model + the SAME
// ingestion every other surface uses. Returns { total, catchall, other }
// so the receipt banner reads the identical set as the chips and the pill.
function _discoveryConsideredCounts(){
  if (typeof _tb === "undefined" || !_tb || !Array.isArray(_tb.placeActivities)) return null;
  if (typeof MaxDiscovery === "undefined" || !MaxDiscovery.DiscoveryModel) return null;
  var S = MaxDiscovery.SECTION, Policy = MaxDiscovery.PlacementPolicy;
  // SSOT Phase 6 (cutover step 1): the live banner now DEPENDS ON the
  // IngestionService — the one trip→model pipeline — rather than re-building its
  // own model inline. Behavior-identical (window._isStaySection delegates to
  // SectionKind.isStay, so the picker and the service share one stay-predicate),
  // but the service is now load-bearing in the live path, not just in tests. The
  // inline build (_discoveryCountSource + _discoveryOpts) remains only as a
  // load-order fallback; once every surface routes through MaxIngestion it goes.
  var _ct = (typeof TripStore !== "undefined" && TripStore.isLoaded && TripStore.isLoaded()) ? TripStore.trip
    : ((typeof trip !== "undefined") ? trip : null);
  var model = (typeof MaxIngestion !== "undefined" && MaxIngestion && typeof MaxIngestion.buildModel === "function" && _ct)
    ? MaxIngestion.buildModel(_ct)
    : MaxDiscovery.DiscoveryModel.fromPlaceActivities(_discoveryCountSource(), _discoveryOpts());
  var unchecked = model.considered();
  var catchall = 0;
  unchecked.forEach(function(p){
    var sec = Policy.sectionFor(p);
    if (sec === S.SIGHTS_NEAR || sec === S.MORE) catchall++;
  });
  return { total: unchecked.length, catchall: catchall, other: unchecked.length - catchall };
}

function _applyDiscoveryModelToSights(){
  if (typeof _tb === "undefined" || !_tb || !Array.isArray(_tb.placeActivities)) return;
  if (typeof MaxDiscovery === "undefined" || !MaxDiscovery.DiscoveryModel) return;
  var S = MaxDiscovery.SECTION;
  // Passthrough = items the model does NOT own (stays, routes, conditions).
  var passthrough = _tb.placeActivities.filter(function(it){
    return it && (window._isStaySection(it.section)
      || it.type === "route" || it.type === "condition"
      || (it.type && /^synthetic-stays$/.test(it.type))
      || /^routes\s*[&]\s*regions/i.test(String(it.section||"")));
  });
  var owned = _tb.placeActivities.filter(function(it){ return passthrough.indexOf(it) === -1; });
  // THE single ingestion — same function MaxData and the banner call.
  var model = MaxDiscovery.DiscoveryModel.fromPlaceActivities(_tb.placeActivities, _discoveryOpts());
  // Rebuild the owned (sight) items from the model's derivation.
  var prevById = {};
  owned.forEach(function(it){ if (it && it.section) prevById[it.section] = it; });
  // When the model RENAMES a section relative to the source LLM item
  // (e.g. "Relax in hot springs" -> "Lakes & lagoons"), prevById (keyed by
  // section NAME) misses, so the editorial flags the LLM stamped (iconic,
  // _headliner, description, category) are lost. Recover them from the
  // previous owned item with the greatest PLACE overlap — placement stays
  // the model's; only the item's editorial attributes are inherited.
  var _ovPk = (window.PlaceKey && PlaceKey.resolve) ? PlaceKey.resolve : function(s){ return String(s||"").toLowerCase().trim(); };
  function _ownedPlaceKeys(it){ return ((it && it.requiredPlaces) || []).map(function(p){ return (p && p.place) ? _ovPk(p.place) : null; }).filter(Boolean); }
  function _bestOverlapItem(grp){
    var gk = {}; (grp.places || []).forEach(function(p){ var nm = p.place || (p.src && p.src.place); var k = nm ? _ovPk(nm) : null; if (k) gk[k] = true; });
    var best = null, bestN = 0;
    owned.forEach(function(it){
      if (!it || (window._isStaySection && window._isStaySection(it.section))) return;
      var n = 0; _ownedPlaceKeys(it).forEach(function(k){ if (gk[k]) n++; });
      if (n > bestN) { bestN = n; best = it; }
    });
    return bestN > 0 ? best : null;
  }
  var newSightItems = model.sections().map(function(grp){
    var template = prevById[grp.section] || {};
    // Clone ALL item-level fields the template carried (iconic,
    // _headliner, description, category, etc.) — the model owns
    // PLACEMENT, not the item's editorial attributes — then override
    // only what placement determines.
    var item = {};
    for (var k in template) { if (Object.prototype.hasOwnProperty.call(template, k)) item[k] = template[k]; }
    // Editorial-flag recovery when the model renamed this section (no
    // exact-name template): inherit from the best place-overlap source item.
    if (!prevById[grp.section]) {
      var _ov = _bestOverlapItem(grp);
      if (_ov) {
        if (_ov.iconic) item.iconic = true;
        if (_ov._headliner) item._headliner = true;
        if (_ov.description && item.description == null) item.description = _ov.description;
        if (_ov.category && item.category == null) item.category = _ov.category;
      }
    }
    item.id = template.id || ("model-" + grp.section.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    item.section = grp.section;
    item.name = template.name || grp.section;
    item.type = template.type || "activity";
    item.checked = grp.places.some(function(p){ return p.decision === "checked"; });
    item.requiredPlaces = grp.places.map(function(p){
      // Reflect the model's decision back onto the source object so
      // downstream readers (publish, counts) see the truth.
      var sp = p.src || { place: p.place };
      sp._keep = (p.decision !== "unchecked");
      sp._rejected = (p.decision === "rejected");
      if (p.decision === "rejected") return null;
      return sp;
    }).filter(Boolean);
    return item;
  });
  // PD.401e: the model DECIDES which places are scenic-route umbrellas
  // (PlacementPolicy → SECTION.SCENIC). Here we honor that decision by
  // merging them into the existing route container (a type:"route" item
  // carries route semantics the model deliberately doesn't own). This
  // replaces the old _routeUmbrellasToScenicRoutes pre-pass: the WHAT is
  // the model's; this is only the WHERE-it-lives plumbing.
  var _scenicGroup = /** @type {any} */ (null);
  newSightItems = newSightItems.filter(function(it){
    if (it && it.section === S.SCENIC) { _scenicGroup = it; return false; }
    return true;
  });
  if (_scenicGroup && _scenicGroup.requiredPlaces && _scenicGroup.requiredPlaces.length) {
    var _routeContainer = passthrough.find(function(it){
      return it && (it.type === "route"
        || /drive\s*scenic\s*routes|scenic\s*routes?|drive\s*the\s*(routes|ring)/i.test(String(it.section||"")));
    });
    var _nrm = (window.PlaceKey && PlaceKey.resolve) ? PlaceKey.resolve
      : function(s){ return String(s||"").toLowerCase().trim(); };
    if (_routeContainer) {
      if (!Array.isArray(_routeContainer.requiredPlaces)) _routeContainer.requiredPlaces = [];
      var _have = {};
      _routeContainer.requiredPlaces.forEach(function(p){ if (p && p.place) _have[_nrm(p.place)] = 1; });
      _scenicGroup.requiredPlaces.forEach(function(p){
        var k = p && p.place ? _nrm(p.place) : null;
        if (!k || _have[k]) return;
        _have[k] = 1; _routeContainer.requiredPlaces.push(p);
      });
    } else {
      // No route container exists — keep the umbrellas grouped so they
      // are not orphaned (fallback; the old pass simply left them).
      newSightItems.push(_scenicGroup);
    }
  }
  // PD.401i: stash the model's per-section place count. This is THE
  // single source every displayed section count reads — the TOC and the
  // section headers no longer each re-dedup placeActivities with their
  // own lowercase key (three copies of "count a section" that could
  // drift). One number, the model's, for every surface.
  var _secCounts = {};
  newSightItems.forEach(function(it){
    if (it && it.section) _secCounts[it.section] = (it.requiredPlaces || []).length;
  });
  window._discoverySectionCounts = _secCounts;
  // Reassemble: passthrough (stays/routes) FIRST in their order, then
  // the model's sight sections. The stays owner already pinned the stay
  // sections to the top of `passthrough`.
  var _newPA = passthrough.concat(newSightItems).filter(function(it){
    return it && Array.isArray(it.requiredPlaces) && (it.requiredPlaces.length || window._isStaySection(it.section) || it.type === "route");
  });
  // PD.445 (#5: render reads, never writes): reassign placeActivities ONLY when
  // the placement actually CHANGED. In the steady state — the data was already
  // model-placed by the last save — this is a structural no-op, so the render
  // stops reassigning the array, stops dirtying _placeSetClean, and stops forcing
  // a canonicalize on every render. The render becomes read-only when nothing
  // changed (killing the mutate-every-render loop/freeze risk). The in-place
  // _keep/_rejected flags set above are idempotent, so skipping the swap loses
  // nothing. When placement DID change, the signatures differ and we reassign.
  function _paSig(arr) {
    return (arr || []).map(function (it) {
      return (it && it.section || "") + "" + ((it && it.requiredPlaces) || []).map(function (p) {
        return (p && p.place) ? p.place : "";
      }).join("");
    }).join("");
  }
  if (_paSig(_newPA) !== _paSig(_tb.placeActivities)) {
    _tb.placeActivities = _newPA;
  }
}

// PD.401i: the ONE accessor for a section's displayed place count. The
// model owns it; the TOC and the section headers read it. Returns null
// for sections the model doesn't own (routes/stays), where the caller
// keeps its own count.
function _pmModelSectionCount(sec){
  var m = window._discoverySectionCounts;
  return (m && Object.prototype.hasOwnProperty.call(m, sec)) ? m[sec] : null;
}

// Export onto the global the same way the inline block did, so existing
// callers (the reconcile chokepoint, the receipt banner) resolve these.
if (typeof globalThis !== "undefined") {
  globalThis._discoveryOpts = _discoveryOpts;
  globalThis._discoveryConsideredCounts = _discoveryConsideredCounts;
  globalThis._applyDiscoveryModelToSights = _applyDiscoveryModelToSights;
  globalThis._pmModelSectionCount = _pmModelSectionCount;
}

export {};
