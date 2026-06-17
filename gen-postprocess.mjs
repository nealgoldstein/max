// @ts-check
// gen-postprocess.js — PD.403: the pure post-LLM transforms of the
// activity-generation flow, extracted verbatim from
// _generateActivitiesForPlaceImpl in index.html.
//
// These four functions are DOM-free, async-free, and Node-testable.
// The orchestrator (index.html) still owns the async LLM/verify passes,
// the per-item decoration loop, and every write to _tb / TripStore;
// it calls these for the pure data shaping in between:
//
//   normalizePlaceArr(arr, regionCountry)
//     — string entries → {place, country:regionCountry}; objects pass through.
//   computeTransitOnly(items, { normPlaceName, isTransitOnlyByDenylist })
//     — aggregate overnight flags per place across ALL non-route refs,
//       decide transit-only (denylist OR all-refs-overnight:false), and
//       propagate the verdict to every ref. Mutates items; returns stats.
//   mergeDuplicateSections(arr, { normPlaceName })
//     — collapse same-named non-route, non-synthetic sections into one,
//       deduping requiredPlaces by place key. Returns a new array.
//   decorateConstructedWithCoords(constructed, items, { normPlaceName })
//     — constructed places with no coords borrow lat/lng/country from any
//       LLM mention of the same place. Mutates constructed; returns count.
//
// The typeof-function guards are preserved from the inline code, so
// passing the real _normPlaceName / _isTransitOnlyByDenylist reproduces
// behavior exactly, and omitting them falls back identically.

const global = /** @type {any} */ (globalThis);
  "use strict";

  function normalizePlaceArr(arr, regionCountry){
      if(!Array.isArray(arr)) return arr;
      return arr.map(function(p){
        if(typeof p === "string") return {place:p, country:regionCountry};
        if(p && typeof p === "object" && p.place) return p;
        return p;
      });
    }

  function computeTransitOnly(items, opts){
    opts = opts || {};
    var _normPlaceName = opts.normPlaceName;
    var _isTransitOnlyByDenylist = opts.isTransitOnlyByDenylist;
    var _placeStates = {}; // normalized place → {anyOvernightTrue, anyOvernightFalse, anyDenylist}
    items.forEach(function(item){
      if (item.type === "route") return;
      if (!Array.isArray(item.requiredPlaces)) return;
      item.requiredPlaces.forEach(function(p){
        if (!p || !p.place) return;
        var k = (typeof _normPlaceName === "function") ? _normPlaceName(p.place) : p.place.toLowerCase();
        if (!_placeStates[k]) _placeStates[k] = {anyOvernightTrue:false, anyOvernightFalse:false, anyDenylist:false};
        var st = _placeStates[k];
        if (typeof _isTransitOnlyByDenylist === "function" && _isTransitOnlyByDenylist(p.place)) {
          st.anyDenylist = true;
        }
        if (p.overnight === false) st.anyOvernightFalse = true;
        else if (p.overnight === true) st.anyOvernightTrue = true;
      });
    });
    // Decide transit-only per place: denylist always wins; otherwise need
    // ALL refs to say overnight:false (no ref has overnight:true).
    var _transitPlaces = {};
    Object.keys(_placeStates).forEach(function(k){
      var st = _placeStates[k];
      if (st.anyDenylist) _transitPlaces[k] = "denylist";
      else if (st.anyOvernightFalse && !st.anyOvernightTrue) _transitPlaces[k] = "llm";
    });
    // Propagate the verdict to every requiredPlace ref of those places
    var _markedTransit = 0;
    var _denylistApplied = 0;
    items.forEach(function(item){
      if (item.type === "route") return;
      if (!Array.isArray(item.requiredPlaces)) return;
      item.requiredPlaces.forEach(function(p){
        if (!p || !p.place) return;
        var k = (typeof _normPlaceName === "function") ? _normPlaceName(p.place) : p.place.toLowerCase();
        if (_transitPlaces[k]) {
          p.overnight = false;
          p._transitOnly = true;
          _markedTransit++;
          if (_transitPlaces[k] === "denylist") _denylistApplied++;
        } else {
          // Place has at least one overnight:true ref — clear stale flags
          p._transitOnly = false;
          if (p.overnight !== true) p.overnight = true;
        }
      });
    });
    return { transitPlaceCount: Object.keys(_transitPlaces).length, markedTransit: _markedTransit, denylistApplied: _denylistApplied };
  }

  function mergeDuplicateSections(arr, opts){
    opts = opts || {};
    var _normPlaceName = opts.normPlaceName;
      var nrmKey = function(s){ return String(s||"").toLowerCase().trim().replace(/\s+/g," "); };
      var nrmPlc = (typeof _normPlaceName === "function")
        ? _normPlaceName
        : function(s){ return String(s||"").toLowerCase().trim(); };
      var out = [];
      var byKey = {};  // section-name → first item in out
      arr.forEach(function(it){
        if (!it || !it.section) { out.push(it); return; }
        if (it.type === "route") { out.push(it); return; }
        if (typeof it.type === "string" && /^synthetic-/.test(it.type)) { out.push(it); return; }
        var k = nrmKey(it.section);
        if (!byKey[k]) {
          byKey[k] = it;
          out.push(it);
          return;
        }
        // Merge this duplicate into the canonical item.
        var canon = byKey[k];
        canon.requiredPlaces = canon.requiredPlaces || [];
        var seen = {};
        canon.requiredPlaces.forEach(function(p){
          if (p && p.place) seen[nrmPlc(p.place)] = true;
        });
        (it.requiredPlaces || []).forEach(function(p){
          if (!p || !p.place) return;
          var pk = nrmPlc(p.place);
          if (seen[pk]) return;
          seen[pk] = true;
          canon.requiredPlaces.push(p);
        });
        // Pick richer description if canon's is short.
        if (it.description && (!canon.description || canon.description.length < it.description.length)) {
          canon.description = it.description;
        }
        // If any duplicate is iconic/checked, the merged section is.
        if (it.iconic) canon.iconic = true;
        if (it.checked) canon.checked = true;
      });
      return out;
  }

  function decorateConstructedWithCoords(_constructed, items, opts){
    opts = opts || {};
    var _normPlaceName = opts.normPlaceName;
      var _nrmM = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
      var _coordIdx = {};
      items.forEach(function(it){
        ["requiredPlaces","endpoints","viableLocations"].forEach(function(arr){
          (it && it[arr] || []).forEach(function(p){
            if (p && p.place && typeof p.lat === "number" && isFinite(p.lat) && p.lat !== 0) {
              var k = _nrmM(p.place);
              if (k && !_coordIdx[k]) _coordIdx[k] = p;
            }
          });
        });
      });
      var _decorated = 0;
      _constructed.forEach(function(it){
        (it.requiredPlaces || []).forEach(function(p){
          if (!p || !p.place) return;
          var hit = _coordIdx[_nrmM(p.place)];
          if (hit && (typeof p.lat !== "number" || !isFinite(p.lat) || p.lat === 0)) {
            p.lat = hit.lat; p.lng = hit.lng;
            if (!p.country && hit.country) p.country = hit.country;
            _decorated++;
          }
        });
      });
    return _decorated;
  }

  // PD.404 (#80): apply the theming pass's section/category assignments to
  // the constructed user-listed sight stubs. Those stubs are created in a
  // catch-all section ("From your list" / "More places to consider") before
  // generation; the theming pass returns, per listed place, the section it
  // belongs in. This moves each matched stub out of the catch-all into its
  // themed section (and fills coords if the stub lacked them), so the
  // generation prompt no longer has to re-emit the list to get it themed.
  //
  //   items       : array of placeActivities items (constructed + others)
  //   themingMap  : [{place, section, category?, iconic?, lat?, lng?, country?}]
  //   opts        : { normPlaceName, movableSections:[section names] }
  //
  // Only items whose CURRENT section is in movableSections are re-themed,
  // so user "Overnight stays" and Max's own sections are never disturbed.
  // Pure: mutates the passed items; returns the count re-themed.
  function applyTheming(items, themingMap, opts){
    opts = opts || {};
    var _normPlaceName = (typeof opts.normPlaceName === "function")
      ? opts.normPlaceName
      : function(s){ return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); };
    var movable = {};
    (opts.movableSections || []).forEach(function(s){ movable[String(s)] = true; });
    // PD.404: the theming model frequently appends a country to the name
    // ("Vík" → "Vík, Iceland") even when asked not to, while the catch-all
    // stubs are bare ("Vík"). Key BOTH the full normalized name AND a "base"
    // form with a trailing ", …" segment stripped, on both sides, so the
    // suffix never blocks a match.
    function _keysFor(name){
      var keys = [];
      var full = _normPlaceName(name);
      if (full) keys.push(full);
      var s = String(name || "");
      var ci = s.lastIndexOf(",");
      if (ci > 0) {
        var base = _normPlaceName(s.slice(0, ci));
        if (base && keys.indexOf(base) < 0) keys.push(base);
      }
      return keys;
    }
    var byPlace = {};
    (themingMap || []).forEach(function(e){
      if (!e || !e.place) return;
      _keysFor(e.place).forEach(function(k){ if (!byPlace[k]) byPlace[k] = e; });
    });
    // PD.404: a catch-all section is ONE item grouping many places, so the
    // theme can't live on the item (its places belong in DIFFERENT themes).
    // Stamp the theme on each PLACE (_themeFit); the DiscoveryModel reads it
    // per-place and splits the group, placing each place in its own theme.
    // Returns the count of PLACES re-themed (not items).
    var themed = 0;
    (items || []).forEach(function(it){
      if (!it || !Array.isArray(it.requiredPlaces) || !it.requiredPlaces.length) return;
      // Movable = a catch-all section, OR a PD.405 per-place fallback category
      // (a single un-themed sight whose section is just its own name). The
      // latter matters because PD.405 places kept-but-uncategorized sights in
      // their own category at the construction render — BEFORE the theming
      // pass runs — so they're no longer sitting in a catch-all here. Without
      // this, the theming pass can't re-theme them (the PD.404/PD.405 clash).
      var isMovable = !!movable[it.section];
      if (!isMovable && it.requiredPlaces.length === 1) {
        var only = it.requiredPlaces[0];
        if (only && only.place && _normPlaceName(it.section) === _normPlaceName(only.place)) isMovable = true;
      }
      if (!isMovable) return;
      it.requiredPlaces.forEach(function(p){
        if (!p || !p.place) return;
        var ks = _keysFor(p.place);
        var entry = null;
        for (var j = 0; j < ks.length; j++) { if (byPlace[ks[j]]) { entry = byPlace[ks[j]]; break; } }
        if (!entry) return;
        var newSec = (typeof entry.section === "string") ? entry.section.trim() : "";
        if (!newSec) return;          // no usable theme → leave the place where it is
        if (movable[newSec]) return;  // never re-theme a place INTO another catch-all
        p._themeFit = newSec;
        if (entry.category && typeof entry.category === "string" && entry.category.trim()) p._themeCategory = entry.category.trim();
        if (entry.iconic === true) p._iconic = true;
        // Fill coords if the place lacked them and we got real ones.
        var lat = parseFloat(entry.lat), lng = parseFloat(entry.lng);
        if (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)
            && (typeof p.lat !== "number" || !isFinite(p.lat) || p.lat === 0)) {
          p.lat = lat; p.lng = lng;
          if (!p.country && entry.country) p.country = entry.country;
        }
        themed++;
      });
    });
    return themed;
  }

  // ── Orphan-theme consolidation ────────────────────────────────────────
  // The "Geysir (1)" / "Goðafoss Waterfall (1)" fix. A kept sight the theming
  // pass left UN-themed renders in its OWN single-member, place-named category
  // (PD.405). This re-homes such a sight into the best-fitting EXISTING theme,
  // matched by geographic FEATURE CONCEPT: a waterfall ("…foss") joins the
  // waterfalls theme, a geyser the thermal theme, a glacier ("…jökull") the
  // glaciers theme. Deterministic and CONSERVATIVE — it only moves a place
  // when a theme sharing its concept already exists, so it can never mis-file
  // a sight into an unrelated category, and it never touches a stay or an
  // already-themed place. Returns the count re-homed.
  //
  // Concept synonyms span English + Icelandic feature terms (so the theme name
  // "waterfalls" and the place "Goðafoss" map to the same concept). Order is
  // significant: the more distinctive concept wins (glacier before mountain so
  // "Snæfellsjökull" reads as glacier, not "fell"→mountain).
  var _CONCEPTS = [
    ["waterfall", ["foss", "waterfall", "falls"]],
    ["glacier",   ["jokull", "jökull", "glacier", "icecap", "ice cap"]],
    ["thermal",   ["geyser", "geysir", "thermal", "hot spring", "hverir", "baths", "bath", "laug"]],
    ["volcanic",  ["volcano", "volcanic", "crater", "lava", "gigur", "gígur", "fissure", "eldfjall", "caldera"]],
    ["canyon",    ["canyon", "gorge", "ravine", "gljufur", "gljúfur"]],
    ["fjord",     ["fjord", "fjörður", "fjordur", "fjords"]],
    ["beach",     ["beach", "sandur", "strönd", "strond", "shore", "coast", "coastal", "coastline"]],
    ["cliff",     ["cliff", "cliffs", "bjarg", "sea cliff"]],
    ["lake",      ["lagoon", "lake", "vatn", "lón", "lon"]],
    ["cave",      ["cave", "hellir", "lava tube"]],
    ["mountain",  ["mountain", "peak", "peaks", "fell", "tindar", "summit", "ridge"]]
  ];
  function _conceptOf(name, norm) {
    var s = norm(name);
    if (!s) return null;
    for (var ci = 0; ci < _CONCEPTS.length; ci++) {
      var syns = _CONCEPTS[ci][1];
      for (var i = 0; i < syns.length; i++) {
        if (s.indexOf(syns[i]) >= 0) return _CONCEPTS[ci][0];
      }
    }
    return null;
  }

  // A default, growable, CONCEPT-named theme for each feature concept. Used as
  // the fallback when an orphan/route-only sight has a clear concept but no
  // same-concept theme already exists to re-home it into. This is what keeps
  // "Kirkjufell" (a mountain) out of the generic "Unique sights" pool: it gets
  // a real "Mountains & peaks" category it shares with any other peak, instead
  // of a place-named singleton. Concept-less sights (a town like Húsavík) still
  // pool — there is no honest feature category for them.
  var _CONCEPT_THEME = {
    waterfall: "Chase waterfalls",
    glacier:   "Glaciers & ice caps",
    thermal:   "Soak in thermal waters",
    volcanic:  "Volcanic landscapes",
    canyon:    "Canyons & gorges",
    fjord:     "Fjords & coastline",
    beach:     "Beaches & black sand",
    cliff:     "Sea cliffs & coast",
    lake:      "Lakes & lagoons",
    cave:      "Caves & lava tubes",
    mountain:  "Mountains & peaks"
  };
  // Resolve the theme an orphan with concept `c` should join: prefer a theme
  // that already carries the concept (so we don't fork a near-duplicate), else
  // the default concept theme. Registers the choice in `byConcept` so siblings
  // of the same concept all land together rather than each forking a variant.
  function _themeForConcept(c, byConcept) {
    if (!c) return null;
    var t = (byConcept && byConcept[c]) || _CONCEPT_THEME[c] || null;
    if (t && byConcept) byConcept[c] = t;
    return t;
  }

  function consolidateOrphanThemes(items, opts) {
    opts = opts || {};
    var norm = (typeof opts.normPlaceName === "function")
      ? opts.normPlaceName
      : function (s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); };
    // The theme universe = the distinct themes places were assigned to.
    var themeSet = {};
    (items || []).forEach(function (it) {
      (it.requiredPlaces || []).forEach(function (p) { if (p && p._themeFit) themeSet[p._themeFit] = true; });
    });
    var themes = Object.keys(themeSet);
    // NOTE: we do NOT bail when there are no existing themes — a recognized
    // concept can OPEN its default theme (via _themeForConcept) even when the
    // trip carries none yet, so an all-orphan set still categorizes.
    // Map a concept → the existing theme that carries it (by the theme's NAME,
    // e.g. "Hike to waterfalls" → waterfall). First theme wins per concept.
    var themeByConcept = {};
    themes.forEach(function (th) { var c = _conceptOf(th, norm); if (c && !themeByConcept[c]) themeByConcept[c] = th; });
    var rehomed = 0;
    (items || []).forEach(function (it) {
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place || p._themeFit || p.role === "stay") return;
        var c = _conceptOf(p.place, norm);
        if (!c) return;
        // Prefer an existing same-concept theme; otherwise open the default
        // concept theme ("Mountains & peaks" …) so a recognized feature is
        // never dumped in the generic pool just because the LLM didn't name
        // a matching theme. Concept-less sights are left for the pool.
        var target = _themeForConcept(c, themeByConcept);
        if (target) { p._themeFit = target; rehomed++; }
      });
    });
    return rehomed;
  }

  // ── Surface route-only sights ──────────────────────────────────────────
  // A sight that exists ONLY as a waypoint on a scenic-route umbrella (e.g.
  // "Ásbyrgi Canyon", "Kirkjufell" strung onto "Drive the Ring Road") is
  // invisible as a sight: it's folded into the single "Drive scenic routes (1)"
  // chip and never appears in a theme section, so the user can't see it and the
  // section counts don't reconcile with the page total. This files each such
  // place ALSO into its proper theme (by feature concept — canyon → "Walk in
  // canyons", glacier → glaciers …), or into "More places to consider" when no
  // theme matches, so it shows individually. The route keeps its waypoint (the
  // drive line is intact); the place just also becomes a visible sight. Bases
  // are never affected — they live in stay sections, so they aren't route-only.
  // Returns the count surfaced.
  function surfaceRouteOnlySights(items, opts) {
    opts = opts || {};
    var norm = (typeof opts.normPlaceName === "function") ? opts.normPlaceName
      : function (s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); };
    var isStay = (typeof opts.isStaySection === "function") ? opts.isStaySection : function () { return false; };
    var CATCH = { "Sights near places you listed": 1, "More places to consider": 1 };
    var nonRoute = {}, routeRef = {};
    (items || []).forEach(function (it) {
      if (!it) return;
      var onRoute = (it.type === "route");
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place) return;
        var k = norm(p.place);
        if (onRoute) { if (!routeRef[k]) routeRef[k] = p; }
        else nonRoute[k] = true;
      });
    });
    var routeOnly = Object.keys(routeRef).filter(function (k) { return !nonRoute[k]; });
    if (!routeOnly.length) return 0;
    var themeByConcept = {};
    (items || []).forEach(function (it) {
      if (!it || it.type === "route" || !it.section || CATCH[it.section] || isStay(it.section)) return;
      var c = _conceptOf(it.section, norm);
      if (c && !themeByConcept[c]) themeByConcept[c] = it.section;
    });
    function _sightItemFor(sec) {
      var it = (items || []).find(function (x) { return x && x.type !== "route" && x.section === sec; });
      if (!it) {
        it = { id: "synth-route-sight-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5),
               type: "activity", section: sec, name: sec, checked: false, requiredPlaces: [] };
        items.push(it);
      }
      if (!Array.isArray(it.requiredPlaces)) it.requiredPlaces = [];
      return it;
    }
    var surfaced = 0;
    routeOnly.forEach(function (k) {
      var p = routeRef[k];
      var c = _conceptOf(p.place, norm);
      // A recognized feature (mountain, glacier, canyon …) surfaces into its
      // concept theme — existing or default — not the catch-all. Only a
      // concept-less waypoint (a town) goes to "More places to consider".
      var theme = _themeForConcept(c, themeByConcept);
      var dest = _sightItemFor(theme || "More places to consider");
      if (dest.requiredPlaces.some(function (q) { return q && norm(q.place) === k; })) return;
      dest.requiredPlaces.push({
        place: p.place, lat: p.lat, lng: p.lng, country: p.country,
        _keep: p._keep === true, _origin: p._origin || "max",
        _themeFit: theme || null, _surfacedFromRoute: true
      });
      surfaced++;
    });
    return surfaced;
  }

  // PD.404 (#80): robustly coerce the theming pass's raw LLM text into an
  // array of assignment objects. The model sometimes wraps the array in
  // prose, fences it, nests it under a key, or (on long lists) truncates it
  // mid-array. Recover from all of those rather than silently returning [].
  // Pure; returns [] only when nothing array-shaped can be salvaged.
  function coerceThemingMap(text){
    if (!text || typeof text !== "string") return [];
    var s = text.replace(/```json|```/g, "").trim();
    function tryParse(str){ try { return JSON.parse(str); } catch (_) { return undefined; } }
    // 1. Clean parse.
    var v = tryParse(s);
    if (Array.isArray(v)) return v;
    // 2. Object that wraps the array under some key.
    if (v && typeof v === "object") {
      for (var k in v) { if (Array.isArray(v[k])) return v[k]; }
    }
    // 3. Slice to the outermost [ ... ] (strips leading/trailing prose).
    var i = s.indexOf("["), j = s.lastIndexOf("]");
    if (i !== -1 && j > i) {
      v = tryParse(s.slice(i, j + 1));
      if (Array.isArray(v)) return v;
    }
    // 4. Truncation recovery: chop at the last complete object and close.
    var cut = s.lastIndexOf("},");
    if (i !== -1 && cut > i) {
      v = tryParse(s.slice(i, cut + 1) + "]");
      if (Array.isArray(v)) return v;
    }
    return [];
  }

  var api = {
    normalizePlaceArr: normalizePlaceArr,
    computeTransitOnly: computeTransitOnly,
    mergeDuplicateSections: mergeDuplicateSections,
    decorateConstructedWithCoords: decorateConstructedWithCoords,
    applyTheming: applyTheming,
    consolidateOrphanThemes: consolidateOrphanThemes,
    surfaceRouteOnlySights: surfaceRouteOnlySights,
    coerceThemingMap: coerceThemingMap
  };
  global.MaxGenPost = api;

export default api;

/* #2 Stage 2 interim: expose this module's non-colliding top-level bindings
   as globals (restores pre-ESM flat-script behavior for bare-global + window.*
   consumers, incl. app-main.js boot refs). esbuild isolates each .mjs to an IIFE;
   any-cast keeps it tsc-valid; the import-rewiring phase removes this. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.normalizePlaceArr = normalizePlaceArr;
  __expg.computeTransitOnly = computeTransitOnly;
  __expg.mergeDuplicateSections = mergeDuplicateSections;
  __expg.decorateConstructedWithCoords = decorateConstructedWithCoords;
  __expg.applyTheming = applyTheming;
  __expg._CONCEPTS = _CONCEPTS;
  __expg._conceptOf = _conceptOf;
  __expg._CONCEPT_THEME = _CONCEPT_THEME;
  __expg._themeForConcept = _themeForConcept;
  __expg.consolidateOrphanThemes = consolidateOrphanThemes;
  __expg.surfaceRouteOnlySights = surfaceRouteOnlySights;
  __expg.coerceThemingMap = coerceThemingMap;
}
