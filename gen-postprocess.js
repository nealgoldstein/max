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

(function (global) {
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

  var api = {
    normalizePlaceArr: normalizePlaceArr,
    computeTransitOnly: computeTransitOnly,
    mergeDuplicateSections: mergeDuplicateSections,
    decorateConstructedWithCoords: decorateConstructedWithCoords
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.MaxGenPost = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
