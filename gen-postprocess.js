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
    var themed = 0;
    (items || []).forEach(function(it){
      if (!it || !movable[it.section]) return;
      if (!Array.isArray(it.requiredPlaces) || !it.requiredPlaces.length) return;
      // Find the first requiredPlace this map has an assignment for.
      var entry = null, matchP = null;
      for (var i = 0; i < it.requiredPlaces.length; i++) {
        var p = it.requiredPlaces[i];
        if (!p || !p.place) continue;
        var ks = _keysFor(p.place);
        for (var j = 0; j < ks.length; j++) {
          if (byPlace[ks[j]]) { entry = byPlace[ks[j]]; matchP = p; break; }
        }
        if (entry) break;
      }
      if (!entry) return;
      var newSec = (typeof entry.section === "string") ? entry.section.trim() : "";
      if (!newSec) return; // no usable section → leave it in the catch-all
      it.section = newSec;
      if (entry.category && typeof entry.category === "string" && entry.category.trim()) {
        it.category = entry.category.trim();
      }
      if (entry.iconic === true) it.iconic = true;
      // Fill coords on the matched place if it lacked them and we got real ones.
      var lat = parseFloat(entry.lat), lng = parseFloat(entry.lng);
      if (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)
          && (typeof matchP.lat !== "number" || !isFinite(matchP.lat) || matchP.lat === 0)) {
        matchP.lat = lat; matchP.lng = lng;
        if (!matchP.country && entry.country) matchP.country = entry.country;
      }
      themed++;
    });
    return themed;
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
    coerceThemingMap: coerceThemingMap
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.MaxGenPost = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
