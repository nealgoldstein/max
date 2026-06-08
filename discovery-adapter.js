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
    var _pa = (typeof _tb !== "undefined" && _tb && Array.isArray(_tb.placeActivities)) ? _tb.placeActivities : [];
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

// PD.401c: the considered count, derived from the SAME model + the SAME
// ingestion every other surface uses. Returns { total, catchall, other }
// so the receipt banner reads the identical set as the chips and the pill.
function _discoveryConsideredCounts(){
  if (typeof _tb === "undefined" || !_tb || !Array.isArray(_tb.placeActivities)) return null;
  if (typeof MaxDiscovery === "undefined" || !MaxDiscovery.DiscoveryModel) return null;
  var S = MaxDiscovery.SECTION, Policy = MaxDiscovery.PlacementPolicy;
  var model = MaxDiscovery.DiscoveryModel.fromPlaceActivities(_tb.placeActivities, _discoveryOpts());
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
  var newSightItems = model.sections().map(function(grp){
    var template = prevById[grp.section] || {};
    // Clone ALL item-level fields the template carried (iconic,
    // _headliner, description, category, etc.) — the model owns
    // PLACEMENT, not the item's editorial attributes — then override
    // only what placement determines.
    var item = {};
    for (var k in template) { if (Object.prototype.hasOwnProperty.call(template, k)) item[k] = template[k]; }
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
  var _scenicGroup = null;
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
  _tb.placeActivities = passthrough.concat(newSightItems).filter(function(it){
    return it && Array.isArray(it.requiredPlaces) && (it.requiredPlaces.length || window._isStaySection(it.section) || it.type === "route");
  });
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
