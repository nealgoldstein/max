// engine-picker.js — Max picker engine, pure helpers (Round HH: Phase 3)
//
// Phase 3 of the engine/UI split. The picker engine owns the workflow
// that produces a trip: brief in flight, candidate generation, keep/
// reject/expand. Its terminal action is publishTrip() — writes the
// finalized trip into the database (Round HJ wires that up); the trip
// engine picks it up via the DB's tripWritten event.
//
// HH ships only the strictly-pure helpers:
//   _findMatchingRequired(cand, requiredPlaces)
//   parseStartDateFromBrief(when)
//   parseNightsFromRange(stayRange)
//
// Other picker helpers (orderKeptCandidates, runCandidateSearch,
// expandMustDos, findCandidates, geocodeMissingCandidates, etc.)
// touch the global picker draft state _tb. They move in HI when
// _tb is encapsulated as MaxEnginePicker.state, and in HJ when the
// LLM-calling functions are migrated through service injection.
//
// Decision (April 2026): the picker is desktop-only for the
// foreseeable future, so we don't need to keep the picker engine
// pure of DOM dependencies — see architecture-engine-ui-split.md.
// We DO keep it free of trip-engine dependencies so the two engines
// stay decoupled and meet only at the trip database.

(function (global) {
  'use strict';

  // _normPlaceName lives in engine-trip.js (Phase 1, exposed on window).
  // Picker helpers that need it call through window since the two engines
  // don't import each other directly. Engine-trip is loaded first per
  // the script tag order in index.html.
  function _normPlaceName(s) {
    if (typeof global._normPlaceName === 'function') return global._normPlaceName(s);
    // Fallback (shouldn't fire if engine-trip.js loaded first).
    return String(s || '').toLowerCase().trim();
  }

  // Match a candidate against the requiredPlaces list (must-do anchors).
  // Returns the matching required entry or null. Substring match in
  // either direction handles "St. Moritz" vs "St. Moritz (Upper
  // Engadine)" cases.
  function _findMatchingRequired(cand, requiredPlaces) {
    if (!cand || !cand.place || !requiredPlaces || !requiredPlaces.length) return null;
    var candN = _normPlaceName(cand.place);
    for (var i = 0; i < requiredPlaces.length; i++) {
      var r = requiredPlaces[i];
      if (!r.place) continue;
      var rN = _normPlaceName(r.place);
      if (rN === candN) return r;
      if (rN && candN && (candN.indexOf(rN) >= 0 || rN.indexOf(candN) >= 0)) return r;
    }
    return null;
  }

  // Parse a start date from the user's freeform "when" text on the brief.
  // Accepts ISO ("2026-08-15"), month + day ("August 15"), or just month
  // ("September"). Returns ISO. Falls back to "today + 3 months" if
  // nothing parseable.
  function parseStartDateFromBrief(when) {
    var iso = (when || '').match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    var now = new Date();
    var months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];
    var w = (when || '').toLowerCase();
    var monthIdx = -1, day = 1;
    months.forEach(function (m, i) { if (w.indexOf(m) > -1) monthIdx = i; });
    var dayMatch = w.match(/\b(\d{1,2})\b/);
    if (dayMatch) day = parseInt(dayMatch[1]);
    if (monthIdx > -1) {
      var year = now.getFullYear();
      var d = new Date(year, monthIdx, day);
      if (d < now) d = new Date(year + 1, monthIdx, day);
      return d.toISOString().slice(0, 10);
    }
    var def = new Date(now);
    def.setMonth(def.getMonth() + 3);
    return def.toISOString().slice(0, 10);
  }

  // "3-4 nights" → 3, "5-7 nights" → 5, "2 nights" → 2. Default 3 if
  // unparseable or empty.
  function parseNightsFromRange(stayRange) {
    if (!stayRange) return 3;
    var m = stayRange.match(/(\d+)/);
    return m ? parseInt(m[1]) : 3;
  }

  // ── Picker draft state (Round HI: Phase 3 step 2) ──────────
  // _tb is the picker's draft state — brief fields, candidates in
  // flight, requiredPlaces, region, entry/exit cities, etc.
  // Historically declared as `var _tb = {}` in the inline script;
  // engine-picker.js now owns the initialization so the engine can
  // reason about it. The inline script still references the global
  // _tb name (resolves to window._tb) so existing 100+ callsites
  // work unchanged.
  //
  // The picker re-initializes _tb when a new trip starts via
  //   _tb = {name: name, interests: [], ...}
  // — that's an assignment to window._tb, not a re-declaration.
  // MaxEnginePicker.state is a getter so it always reflects the
  // current _tb object even after re-init.
  if (!global._tb) global._tb = {};

  // Picker-side event bus. Mirror of MaxEngineTrip.on/off/emit.
  // Phase 3 picker mutators (HI.2 onwards) emit through this; the
  // picker UI subscribes for re-render. Cross-engine handoff
  // happens via the database (DB.on('tripWritten', ...)) — picker
  // and trip engines never call each other directly.
  var pickerListeners = Object.create(null);
  var pickerServices = Object.create(null);

  function pickerOn(event, cb) {
    if (!pickerListeners[event]) pickerListeners[event] = [];
    pickerListeners[event].push(cb);
    return function unsubscribe() { pickerOff(event, cb); };
  }

  function pickerOff(event, cb) {
    if (!pickerListeners[event]) return;
    var i = pickerListeners[event].indexOf(cb);
    if (i >= 0) pickerListeners[event].splice(i, 1);
  }

  function pickerEmit(event, payload) {
    var arr = pickerListeners[event];
    if (!arr) return;
    arr.slice().forEach(function (cb) {
      try { cb(payload); }
      catch (e) { console.warn('[MaxEnginePicker] listener for', event, 'threw:', e); }
    });
  }

  function pickerInjectService(name, impl) { pickerServices[name] = impl; }
  function pickerGetService(name) { return pickerServices[name] || null; }

  // ── groupCandidatesByMustDo (Round HX) ────────────────────
  // Pure data derivation extracted from renderCandidateCards. Given
  // the active (non-rejected) candidate list and the must-do list,
  // returns:
  //   {
  //     candByPrimary:    { mustDoName: [candidates] }
  //     primaryByCandId:  { candidateId: mustDoName | null }
  //     discoveryCands:   [candidates that match no must-do]
  //   }
  //
  // Each candidate appears in exactly one section — its FIRST must-do
  // in the user's sentence order (mdcItems[].name in the order the
  // brief produced them). Candidates with no real _requiredFor refs
  // (or only the "__manual__" placeholder) become discoveries.
  //
  // Why this lives in the engine: it's a pure transformation of state
  // into structured output. No DOM, no Leaflet, no _tb mutation. The
  // monolithic renderer (renderCandidateCards) calls this once and
  // uses the result to build sections. A unit test can verify the
  // grouping logic without spinning up the picker UI at all.

  function groupCandidatesByMustDo(activeCands, mdcItems) {
    var mustDoOrder = (mdcItems || [])
      .filter(function (m) { return m && m.checked && m.name && m.name !== "__manual__"; })
      .map(function (m) { return m.name; });
    var candByPrimary = {};
    var primaryByCandId = {};
    var discoveryCands = [];
    (activeCands || []).forEach(function (c) {
      if (!c) return;
      var realRefs = (c._requiredFor || []).filter(function (r) { return r && r !== "__manual__"; });
      if (!realRefs.length) { discoveryCands.push(c); return; }
      var primary = null;
      for (var i = 0; i < mustDoOrder.length; i++) {
        if (realRefs.indexOf(mustDoOrder[i]) > -1) { primary = mustDoOrder[i]; break; }
      }
      if (!primary) primary = realRefs[0];
      primaryByCandId[c.id] = primary;
      if (!candByPrimary[primary]) candByPrimary[primary] = [];
      candByPrimary[primary].push(c);
    });
    // Round HX.6: also expose mustDoOrder. The activity-lens renderer
    // walks this list to drive section ordering ("must-dos in user
    // sentence order, discoveries last"). Before HX.6 the renderer had
    // its own duplicate `var mustDoOrder = (_mdcItems||[]).filter…`
    // declaration; HX dropped that line when the grouping moved to the
    // engine, but didn't surface mustDoOrder back out — leaving a
    // ReferenceError on the activity lens (the default). Returning it
    // here lets the renderer just read the engine's result.
    return {
      candByPrimary:   candByPrimary,
      primaryByCandId: primaryByCandId,
      discoveryCands:  discoveryCands,
      mustDoOrder:     mustDoOrder,
    };
  }

  // ── applyRequiredAndAutoKeep (Round HX.1) ────────────────
  // Two-step pre-render pass over the candidate list, lifted from
  // renderCandidateCards. Mutates candidates in place; returns a
  // diagnostic count for tests + (later) UI hints.
  //
  // Step 1 — re-check _required.
  //   The brief's required-places list can change between candidate
  //   generation and render (e.g., user edits the brief). For each
  //   cand without _required or with empty _requiredFor, we re-run
  //   findMatchingRequired to see if it should now be flagged. This
  //   was added so route endpoints (Chur/Tirano for Bernina Express)
  //   don't fall into the generic "Places" bucket when the original
  //   p1 marked _required=true but the matcher couldn't fill
  //   _requiredFor.
  //
  // Step 2 — auto-keep-once.
  //   Required candidates auto-promote to status=keep on their first
  //   render, then never again. The _autoKeepApplied flag prevents
  //   re-triggering — Neal's complaint was that editing the brief
  //   re-applied auto-keep retroactively, which surprised the user.
  //   Once a required cand has been "seen" (with or without an
  //   explicit status), the flag is set and it sticks.
  //
  // Returns { newlyFlagged, newlyKept } so tests can assert without
  // walking the cand list, and UI could surface a "we just promoted
  // 3 places to required" toast in a future round if useful.

  function applyRequiredAndAutoKeep(cands, requiredPlaces) {
    var newlyFlagged = 0;
    var newlyKept    = 0;
    (cands || []).forEach(function (c) {
      if (!c) return;
      if (!c._required || !(c._requiredFor && c._requiredFor.length)) {
        var match = _findMatchingRequired(c, requiredPlaces);
        if (match) {
          c._required = true;
          c._requiredFor = match.requiredFor || [];
          newlyFlagged++;
        }
      }
      if (c._required && !c.status && !c._autoKeepApplied) {
        c.status = 'keep';
        c._autoKeepApplied = true;
        newlyKept++;
      } else if (c._required) {
        c._autoKeepApplied = true;
      }
    });
    return { newlyFlagged: newlyFlagged, newlyKept: newlyKept };
  }

  // ── partitionByStatus (Round HX.1) ────────────────────────
  // Splits the candidate list into active vs rejected. Trivial in
  // isolation, but worth a name + a test: the "rejected goes into a
  // collapsible footer" pattern depends on this partition being
  // exhaustive (every cand lands in exactly one bucket). The test
  // pins that contract so a future tweak (e.g., introducing a third
  // status) doesn't silently drop cards from the render.

  function partitionByStatus(cands) {
    var active = [], rejected = [];
    (cands || []).forEach(function (c) {
      if (!c) return;
      if (c.status === 'reject') rejected.push(c);
      else active.push(c);
    });
    return { active: active, rejected: rejected };
  }

  // ── classifyCandidateBadge (Round HX.2) ──────────────────
  // Decides which of three badge variants to render on a candidate
  // card, based on whether the cand is manually-added, in-section
  // with extra must-dos, or unmatched-but-still-required.
  //
  // Returns one of:
  //   { kind: 'manual',   refs: [],          isRoute: false }
  //     Manual placeholder. "📌 A must-see for you" copy in render.
  //   { kind: 'also',     refs: [other refs] }
  //     In-section card whose cand also supports must-dos beyond
  //     the section it's grouped under. "You will also find: …" copy.
  //   { kind: 'required', refs: [all refs],  isRoute: bool }
  //     No primary section assigned (e.g., rejected card or one
  //     whose primary fell out). isRoute flips copy from "Required
  //     for" to "Stop on" — travelers think of routes as transit
  //     between stops, not as activities themselves.
  //   { kind: 'none',     refs: [],          isRoute: false }
  //     Nothing to show — render skips the badge.
  //
  // Inputs that don't change behavior (status flags, scores, etc.)
  // are deliberately ignored — keeps the contract narrow + stable.

  function classifyCandidateBadge(cand, primary, mdcItems) {
    if (!cand) return { kind: 'none', refs: [], isRoute: false };
    var rfRaw = cand._requiredFor || [];
    var hasManual = rfRaw.length && rfRaw.every(function (r) { return r === '__manual__'; });
    if (hasManual) return { kind: 'manual', refs: [], isRoute: false };
    var allRefs = rfRaw.filter(function (r) { return r !== '__manual__'; });
    if (primary) {
      var otherRefs = allRefs.filter(function (r) { return r !== primary; });
      if (otherRefs.length) return { kind: 'also', refs: otherRefs, isRoute: false };
      return { kind: 'none', refs: [], isRoute: false };
    }
    if (allRefs.length) {
      var refIsRoute = allRefs.some(function (r) {
        var m = (mdcItems || []).find(function (mm) { return mm && mm.name === r; });
        return !!(m && m.type === 'route');
      });
      return { kind: 'required', refs: allRefs, isRoute: refIsRoute };
    }
    return { kind: 'none', refs: [], isRoute: false };
  }

  // ── regionSeedCoord (Round HX.2) ──────────────────────────
  // Turn a region name into a seed coordinate for hallucination-
  // distance checks (used as the `seed` arg to coordSane). Returns
  // [lat, lng] or null. The geocode map is passed in so tests can
  // supply a controlled fixture instead of touching window state.

  function regionSeedCoord(region, geocodeMap) {
    var key = String(region || '').toLowerCase().trim();
    if (!key || !geocodeMap) return null;
    var c = geocodeMap[key];
    if (c && isFinite(c[0]) && isFinite(c[1])) return c;
    return null;
  }

  // ── parseNightRange (Round HX.4) ─────────────────────────
  // Parse a stayRange string like "2 nights", "2-3 nights", "1–2",
  // "3" — returns { min, max } in nights or null. The matcher is
  // forgiving: accepts ASCII hyphen, en-dash, em-dash; falls back
  // to a single integer when no range hyphen is present.

  function parseNightRange(s) {
    if (!s) return null;
    var m = s.match(/(\d+)\s*[\-–—]\s*(\d+)/);
    if (m) return { min: parseInt(m[1]), max: parseInt(m[2]) };
    var m2 = s.match(/(\d+)/);
    if (m2) { var n = parseInt(m2[1]); return { min: n, max: n }; }
    return null;
  }

  // ── parseTripDuration (Round HX.4) ───────────────────────
  // Parse the brief's duration field — "10 days", "10-14 days", "2
  // weeks", "2-3 weeks". Returns { min, max } in days or null
  // ("three weeks" written out doesn't parse — caller falls back).

  function parseTripDuration(s) {
    if (!s) return null;
    var str = String(s).toLowerCase();
    var wk = str.match(/(\d+)\s*[\-–—]\s*(\d+)\s*week/);
    if (wk) return { min: parseInt(wk[1]) * 7, max: parseInt(wk[2]) * 7 };
    var wk1 = str.match(/(\d+)\s*week/);
    if (wk1) { var n = parseInt(wk1[1]); return { min: n * 7, max: n * 7 }; }
    var dr = str.match(/(\d+)\s*[\-–—]\s*(\d+)\s*(day|night)/);
    if (dr) return { min: parseInt(dr[1]), max: parseInt(dr[2]) };
    var d1 = str.match(/(\d+)\s*(day|night)/);
    if (d1) { var nd = parseInt(d1[1]); return { min: nd, max: nd }; }
    return null;
  }

  // ── keptDaysRangeText (Round HX.4) ───────────────────────
  // Picker header's day-total summary. Sums stayRanges across the
  // kept candidates, returns a formatted string ("5 days" or
  // "5–7 days") or empty string if any kept stayRange is
  // unparseable (in which case the header omits the time clause
  // entirely instead of misleading the user with a partial total).

  function keptDaysRangeText(kept) {
    if (!kept || !kept.length) return '';
    var min = 0, max = 0, ok = true;
    kept.forEach(function (c) {
      var r = parseNightRange(c && c.stayRange);
      if (!r) { ok = false; return; }
      min += r.min; max += r.max;
    });
    if (!ok) return '';
    if (min === max) return min + ' days';
    return min + '–' + max + ' days';
  }

  // ── alsoHereText (Round HX.3) ────────────────────────────
  // What else is worth doing at a candidate's place. Pulls from the
  // candidate's own `otherAttractions` field, with a fallback to the
  // primary must-do's `endpointHighlights[c.place]` for route
  // endpoints — Chur's "old town + Heidi-themed walks", Tirano's
  // "Bernina lake views" — so the user sees a place is more than a
  // train station even when its candidate didn't carry that prose.
  //
  // Pure lookup. Returns the string or '' (empty string is a sentinel
  // for "render nothing" so callers can use the value directly in a
  // template-string concatenation).

  function alsoHereText(cand, primary, mdcItems) {
    if (!cand) return '';
    if (cand.otherAttractions) return cand.otherAttractions;
    if (!primary) return '';
    var md = (mdcItems || []).find(function (m) { return m && m.name === primary; });
    if (md && md.endpointHighlights && md.endpointHighlights[cand.place]) {
      return md.endpointHighlights[cand.place];
    }
    return '';
  }

  // ── coordSane (Round HX) ──────────────────────────────────
  // Hallucination filter for candidate lat/lng. The LLM occasionally
  // returns coordinates from the wrong country (Iceland places coming
  // back with Swiss lat/lng was the surfacing case in Round FU.2).
  // Returns false for points >2500km from the seed center; true for
  // legit-looking points or when there's no seed to compare against.
  //
  // Pure helper. Takes the seed [lat, lng] (or null) and the point's
  // lat, lng. Equirectangular distance approximation — fast enough at
  // this scale and well within the 2500km guard's precision needs.

  function coordSane(seed, lat, lng) {
    if (!seed) return true;
    if (!isFinite(lat) || !isFinite(lng)) return false;
    var dLat = (lat - seed[0]) * 111;
    var dLng = (lng - seed[1]) * 111 * Math.cos(((lat + seed[0]) / 2) * Math.PI / 180);
    var km = Math.sqrt(dLat * dLat + dLng * dLng);
    return km <= 2500;
  }

  // ── keptCandidates (Round HX.5) ──────────────────────────
  // The kept-list filter — the picker's most-repeated one-liner.
  // Twelve+ call sites in the inline script ranged over variants of
  // `(_tb.candidates||[]).filter(c => c.status === "keep")`. Promoting
  // it to the engine surface gives every site a name to point at and
  // makes it the natural input to the lens-reordering work in HX.6.
  //
  // Pure filter. Returns a new array of candidates whose status is
  // exactly "keep" (so cleared/null-status cards stay out, matching
  // every existing call site's intent). Tolerates null/undefined
  // input by returning an empty array — the inline-script callers
  // already do `(_tb.candidates||[])`, so the new helper absorbs that.
  function keptCandidates(cands) {
    if (!cands || !cands.length) return [];
    return cands.filter(function (c) { return c && c.status === 'keep'; });
  }

  // ── activeCandidates (Round HZ: picker hero map) ─────────
  // Returns candidates that are "in the route" — accepted plus
  // unchecked (status === null) — but not rejected. The hero-map
  // picker renders the route polyline and numbered ordinals
  // across this set rather than just the kept subset, so the
  // unchecked LLM suggestions show up as tentative stops the
  // user is reacting to. See picker-hero-map.md for the three-
  // state model.
  //
  // Pure filter. Returns a new array; tolerates null/undefined
  // input by returning [].
  function activeCandidates(cands) {
    if (!cands || !cands.length) return [];
    return cands.filter(function (c) { return c && c.status !== 'reject'; });
  }

  // ── groupByCountry (Round HX.7) ──────────────────────────
  // Region-lens primary grouping. Buckets candidates by their
  // `country` field (with "Unknown" as the fallback) and returns the
  // bucket map alongside a country list ordered by descending bucket
  // size, ties broken by alphabetical name.
  //
  // The renderer walks `countriesSortedByCount`, draws an umbrella
  // header per country, then iterates `byCountry[country]` for the
  // cards (with its own kept-first + alphabetical secondary sort
  // applied per-bucket — that secondary sort isn't this function's
  // concern).
  //
  // Pure. No DOM. Returns a fresh object on each call so callers can
  // mutate the buckets without polluting other call sites.
  function groupByCountry(activeCands) {
    var byCountry = {};
    (activeCands || []).forEach(function (c) {
      if (!c) return;
      var k = (c.country || 'Unknown');
      k = (typeof k === 'string' ? k.trim() : '') || 'Unknown';
      if (!byCountry[k]) byCountry[k] = [];
      byCountry[k].push(c);
    });
    var countries = Object.keys(byCountry).sort(function (a, b) {
      var d = byCountry[b].length - byCountry[a].length;
      if (d !== 0) return d;
      return a.localeCompare(b);
    });
    return {
      byCountry:               byCountry,
      countriesSortedByCount:  countries,
    };
  }

  // ── partitionMustDosByType (Round HX.7) ──────────────────
  // Activity-lens umbrella partition. Walks the user-sentence-ordered
  // `mustDoOrder` (from groupCandidatesByMustDo) and groups names by
  // their must-do `type` — route / activity / condition / manual —
  // preserving in-type ordering.
  //
  // Default type for an unknown or missing item is "activity"
  // (matches the inline behavior — a custom chip without an explicit
  // type lands in the Activities section).
  //
  // Returns { byType, typeOrder } where typeOrder is the canonical
  // umbrella order the renderer iterates (route → activity →
  // condition → manual). The renderer skips empty types except for
  // route + activity, which always render headers (so a user with a
  // train route but no candidates yet still sees a "Scenic travel"
  // section while the LLM is generating endpoints).
  //
  // Pure. No DOM. The typeOrder constant lives here so future rounds
  // can re-use it (e.g., reordering policy lives next to the data
  // shape it orders).
  var MUST_DO_TYPE_ORDER = ['route', 'activity', 'condition', 'manual'];

  function partitionMustDosByType(mustDoOrder, mdcItems) {
    var byType = {};
    MUST_DO_TYPE_ORDER.forEach(function (t) { byType[t] = []; });
    var byName = {};
    (mdcItems || []).forEach(function (m) {
      if (m && m.name) byName[m.name] = m;
    });
    (mustDoOrder || []).forEach(function (name) {
      var item = byName[name];
      var t = (item && item.type) || 'activity';
      if (!byType[t]) byType[t] = [];
      byType[t].push(name);
    });
    return { byType: byType, typeOrder: MUST_DO_TYPE_ORDER.slice() };
  }

  // ── mustDoSectionTitle (Round HX.10) ─────────────────────
  // The activity-lens section header copy formatter. Returns the
  // text the renderer puts in the section's heading element —
  // "Bernina · scenic travel" or "Northern lights · condition" or
  // just "Some chip" if the must-do has no type.
  //
  // Routes get the friendly "scenic travel" label since calling them
  // an "activity" is misleading — a Glacier Express ride is the way
  // you get from Zermatt to St. Moritz, not an activity to do at a
  // place. Other types stay as their raw type word.
  //
  // Pure. No DOM. Returns a plain string ready to set as textContent.
  function mustDoSectionTitle(mdName, mdItem) {
    var name = mdName || '';
    if (!mdItem || !mdItem.type) return name;
    var typeWord = (mdItem.type === 'route') ? 'scenic travel' : mdItem.type;
    return name + ' · ' + typeWord;
  }

  // ── mustDoSectionRenderable (Round HX.9) ─────────────────
  // The activity-lens decides per must-do whether to draw a section
  // header even when there are no candidate cards under it. Routes
  // and activities ALWAYS render — the user needs to see their train
  // routes and activity descriptions immediately, before the LLM
  // returns endpoint candidates. Conditions and manual ("Places you
  // added") only render when there's something concrete to show.
  //
  // Pure boolean. Centralized here so the rule lives next to the
  // typeOrder constant and can be tested without spinning up the UI.
  function mustDoSectionRenderable(sectionType, hasGroup) {
    if (sectionType === 'route' || sectionType === 'activity') return true;
    return !!hasGroup;
  }

  // ── routeArrow (Round HX.9) ──────────────────────────────
  // Direction → unicode arrow. Routes can be one-way (forward), one-
  // way (reverse — Bernina runs both ways but picker-side intent may
  // be reverse), or bidirectional ("either"). Default is forward
  // because that's how routes are listed by name (Glacier Express
  // runs Zermatt → St. Moritz in its standard direction).
  //
  // Returns the arrow with surrounding spaces ready for join().
  function routeArrow(direction) {
    if (direction === 'reverse') return ' ← ';
    if (direction === 'either')  return ' ↔ ';
    return ' → ';
  }

  // ── regionWithinCountrySort (Round HX.8) ─────────────────
  // The region-lens within-country secondary sort. Sister to
  // bestPickFirstSort, but the secondary sort is alphabetical-by-
  // place rather than required-first — region view emphasizes
  // geographic relationships, not commitment status.
  //
  // 1. status === "keep"     → first
  // 2. otherwise              → alphabetical by candidate.place
  //                             (locale-aware via String#localeCompare)
  //
  // Pure. Returns a NEW array; input untouched.
  function regionWithinCountrySort(group) {
    if (!group || !group.length) return [];
    return group.slice().sort(function (a, b) {
      var ak = a && a.status === 'keep' ? 0 : 1;
      var bk = b && b.status === 'keep' ? 0 : 1;
      if (ak !== bk) return ak - bk;
      var ap = (a && a.place) || '';
      var bp = (b && b.place) || '';
      return ap.localeCompare(bp);
    });
  }

  // ── partitionActiveByCommitment (Round HX.8) ─────────────
  // The commitment-lens partition. Splits an already-filtered
  // active candidate list (post-partitionByStatus, so rejected ones
  // never arrive here) into two buckets:
  //
  //   kept   — c.status === "keep"  (already in the trip)
  //   unset  — !c.status            (still open; needs a decision)
  //
  // Any candidate that somehow leaks through with status === "reject"
  // (shouldn't happen in the lens code path) is silently dropped —
  // this function's contract is "active candidates only", so its
  // output should never include rejected ones.
  //
  // Pure. No DOM, no globals. Returns fresh arrays.
  function partitionActiveByCommitment(activeCands) {
    var kept = [], unset = [];
    (activeCands || []).forEach(function (c) {
      if (!c) return;
      if (c.status === 'keep') kept.push(c);
      else if (!c.status)      unset.push(c);
      // c.status === 'reject' falls through silently.
    });
    return { kept: kept, unset: unset };
  }

  // ── bestPickFirstSort (Round HX.6) ───────────────────────
  // Promotes the inline `bestPickFirst` from renderCandidateCards.
  // Sorts a candidate group so the user's eye lands on what's most
  // committed first:
  //   1. status === "keep"  → first (kept picks lead the group)
  //   2. _required          → ahead of non-required within tie
  //   3. otherwise          → stable order from the input
  //
  // The "Show me the best" toggle slices the first item — so for a
  // group with one keep + several discoveries, the keep is the one
  // shown collapsed, with the rest behind a "+ N more" reveal.
  //
  // Pure. Returns a NEW array; input untouched.
  function bestPickFirstSort(group) {
    if (!group || !group.length) return [];
    return group.slice().sort(function (a, b) {
      var ak = a && a.status === 'keep' ? 0 : 1;
      var bk = b && b.status === 'keep' ? 0 : 1;
      if (ak !== bk) return ak - bk;
      var ar = a && a._required ? 0 : 1;
      var br = b && b._required ? 0 : 1;
      return ar - br;
    });
  }

  // ── computeStayTotalSummary (Round HX.5) ─────────────────
  // The pure logic behind renderCEStayTotal — the picker's "your
  // picks: N nights · trip: M days" summary line. Composes on top
  // of parseNightRange + parseTripDuration (HX.4). Returns a shape
  // the renderer can format directly:
  //
  //   { rangeStr, tripStr|null, status }
  //
  // where status is one of:
  //   'empty'    — no kept candidates (renderer writes nothing)
  //   'unknown'  — at least one kept stayRange unparseable; renderer
  //                writes nothing rather than mislead with a partial
  //   'over'     — kept min > trip max
  //   'under'    — kept max < trip min
  //   'fit'      — within trip duration (or no parseable trip duration)
  //
  // The "no parseable trip duration" case returns status 'fit' with
  // tripStr=null — matches the existing behavior where the renderer
  // omits the trip clause and uses neutral color.
  //
  // Pure. No DOM, no globals.
  function computeStayTotalSummary(kept, durationStr) {
    if (!kept || !kept.length) {
      return { rangeStr: '', tripStr: null, status: 'empty' };
    }
    var min = 0, max = 0, ok = true;
    for (var i = 0; i < kept.length; i++) {
      var c = kept[i];
      var r = parseNightRange(c && c.stayRange);
      if (!r) { ok = false; break; }
      min += r.min; max += r.max;
    }
    if (!ok) return { rangeStr: '', tripStr: null, status: 'unknown' };
    var rangeStr = (min === max) ? (min + ' nights') : (min + '–' + max + ' nights');
    var trip = parseTripDuration(durationStr || '');
    if (!trip) return { rangeStr: rangeStr, tripStr: null, status: 'fit' };
    var tripStr = (trip.min === trip.max)
      ? (trip.min + ' days')
      : (trip.min + '–' + trip.max + ' days');
    var status = 'fit';
    if (min > trip.max) status = 'over';
    else if (max < trip.min) status = 'under';
    return { rangeStr: rangeStr, tripStr: tripStr, status: status };
  }

  // ── orderKeptCandidates (Round HI.2: Phase 3) ──────────────
  // Moved from index.html. Reads _tb.region (read), writes _tb.tbExit
  // (write) — both via the engine's own state object since HI
  // encapsulated _tb. Other deps:
  //   _normPlaceName       — engine-trip.js (window global)
  //   getCityCenter        — inline-script function used inside the
  //                          inner _geoReorderOrdered IIFE; resolves
  //                          via window since the inline script is
  //                          loaded after this module
  //
  // Reasoning strings + Round CN geo-reorder + Round DO round-trip
  // angular-sort all preserved as-is.

  function orderKeptCandidates(kept, mdcItems, entryCity, exitCity){
    var reasoning = [];
    if (!kept.length) return {ordered:[], reasoning:reasoning, inferredEntry:null};

    // Build a map of place → candidate for quick lookup. Use normalized names.
    var byName = {};
    kept.forEach(function(c){ byName[_normPlaceName(c.place)] = c; });

    // Separate candidates by role: route-endpoints, condition-viable, free
    var activeRoutes = (mdcItems||[]).filter(function(m){
      return m.checked && m.type === "route" && (m.endpoints||m.requiredPlaces||[]).length >= 2;
    });
    var activeConditions = (mdcItems||[]).filter(function(m){
      return m.checked && m.type === "condition" && (m.viableLocations||m.requiredPlaces||[]).length;
    });

    // Find which kept candidates are route endpoints (with their route)
    var candRoute = {}; // candId → [routeName1, routeName2...]
    activeRoutes.forEach(function(r){
      var eps = r.endpoints || r.requiredPlaces || [];
      eps.forEach(function(p){
        var c = byName[_normPlaceName(p.place)];
        if (c) {
          candRoute[c.id] = candRoute[c.id] || [];
          candRoute[c.id].push(r.name);
        }
      });
    });

    // Group candidates into route-pairs (two endpoints of same route)
    // Each route that has both endpoints in kept becomes a "block" that must be adjacent
    var routeBlocks = []; // array of {routeName, candidates:[], direction}
    activeRoutes.forEach(function(r){
      var eps = r.endpoints || r.requiredPlaces || [];
      var matching = eps.map(function(p){ return byName[_normPlaceName(p.place)]; }).filter(Boolean);
      if (matching.length >= 2) {
        routeBlocks.push({
          routeName: r.name,
          direction: r.direction || "either",
          candidates: matching,
          endpointsOrder: eps.map(function(p){ return _normPlaceName(p.place); })
        });
        reasoning.push("Zermatt and St. Moritz belong to the same route (" + r.name + "), so they'll be adjacent in the itinerary.".replace('Zermatt', matching[0].place).replace('St. Moritz', matching[1].place).replace("Zermatt and " + matching[1].place, matching[0].place + " and " + matching[1].place));
      }
    });

    // Track which candidates are already placed in a block
    var placed = {};
    routeBlocks.forEach(function(b){ b.candidates.forEach(function(c){ placed[c.id] = true; }); });

    // Direction alignment: for each block with direction=either, decide based on
    // which endpoint is closer (geographically or alphabetically as fallback) to
    // entry city
    function pickDirection(block, entry, exit){
      if (block.direction !== "either") {
        // honor the preferred direction
        return block.direction === "forward" ? block.candidates.slice() : block.candidates.slice().reverse();
      }
      // Heuristic: if entry city matches or substring-matches one endpoint, start from the other
      var entryN = _normPlaceName(entry||"");
      var exitN  = _normPlaceName(exit||"");
      var a = block.candidates[0], b = block.candidates[1];
      var aN = _normPlaceName(a.place), bN = _normPlaceName(b.place);

      // If entry is near A, start from A (travel A→B). If entry near B, start from B.
      if (entryN && (entryN.indexOf(aN) >= 0 || aN.indexOf(entryN) >= 0)) {
        reasoning.push("On " + block.routeName + ", I'm going " + a.place + " → " + b.place + " since you're arriving near " + a.place + ".");
        return [a, b];
      }
      if (entryN && (entryN.indexOf(bN) >= 0 || bN.indexOf(entryN) >= 0)) {
        reasoning.push("On " + block.routeName + ", I'm going " + b.place + " → " + a.place + " since you're arriving near " + b.place + ".");
        return [b, a];
      }
      // If exit is near B, end at B (travel A→B)
      if (exitN && (exitN.indexOf(bN) >= 0 || bN.indexOf(exitN) >= 0)) {
        reasoning.push("On " + block.routeName + ", ending at " + b.place + " flows toward your exit.");
        return [a, b];
      }
      if (exitN && (exitN.indexOf(aN) >= 0 || aN.indexOf(exitN) >= 0)) {
        reasoning.push("On " + block.routeName + ", ending at " + a.place + " flows toward your exit.");
        return [b, a];
      }
      // No signal — keep the expansion's default order
      reasoning.push("On " + block.routeName + ", either direction works — I went with " + a.place + " → " + b.place + ".");
      return [a, b];
    }

    // Build the final ordered list
    var remaining = kept.filter(function(c){ return !placed[c.id]; });

    // Heuristic ordering strategy:
    //   1. Start with any candidate matching entry city (if present)
    //   2. Place route blocks in order of how many un-placed neighbors they have
    //   3. Fill with remaining by a simple geographic-ish ordering
    //      (for now: keep original candidate list order to respect Max's reasoning)
    //   4. End with any candidate matching exit city (if present)
    var ordered = [];
    var entryN = _normPlaceName(entryCity||"");
    var exitN  = _normPlaceName(exitCity||"");

    function matchesName(c, nN){
      if (!c || !nN) return false;
      var cN = _normPlaceName(c.place);
      return cN.indexOf(nN) >= 0 || nN.indexOf(cN) >= 0;
    }

    // Find entry candidate
    var entryCand = null;
    var entryInferred = false;
    if (entryN) {
      remaining.forEach(function(c){ if (!entryCand && matchesName(c, entryN)) entryCand = c; });
      if (!entryCand) {
        // Check route blocks — if one endpoint matches entry, put that block first
        routeBlocks.forEach(function(b){
          b.candidates.forEach(function(c){ if (!entryCand && matchesName(c, entryN)) entryCand = c; });
        });
      }
    } else {
      // No entry city specified — infer a natural starting point.
      // Preference order:
      //   1. A major-gateway candidate (marked _cityPick by the major-cities discovery call)
      //      that's among the "remaining" non-route-block candidates
      //   2. A major-gateway candidate that's a route-block endpoint (we'll reorder blocks)
      //   3. Round CP.1: a kept candidate matching a hardcoded major-gateway
      //      city for the trip's region (Zurich for Switzerland, Paris for
      //      France, etc.) — covers the case where _cityPick wasn't set
      //   4. The first kept candidate in the list (last resort)
      var cityPicks = kept.filter(function(c){ return c._cityPick; });
      // Prefer a gateway city that's NOT in a route block (keeps route-adjacency clean)
      cityPicks.forEach(function(c){
        if (!entryCand && remaining.indexOf(c) >= 0) entryCand = c;
      });
      // Otherwise prefer a gateway city that IS a route endpoint
      if (!entryCand) {
        cityPicks.forEach(function(c){
          if (!entryCand && placed[c.id]) entryCand = c;
        });
      }
      // Round CP.1: hardcoded major-gateway lookup by region. Without this,
      // a Switzerland trip could default to Zermatt (because it's first in
      // the kept list) instead of Zurich, which is the obvious gateway.
      if (!entryCand) {
        var majorGateways = {
          "switzerland":   ["zurich", "zürich", "geneva", "basel", "bern"],
          "italy":         ["rome", "roma", "milan", "milano", "florence", "venice", "naples"],
          "france":        ["paris", "lyon", "nice", "marseille"],
          "germany":       ["berlin", "munich", "münchen", "frankfurt", "hamburg"],
          "spain":         ["madrid", "barcelona", "seville", "sevilla"],
          "portugal":      ["lisbon", "lisboa", "porto"],
          "uk":            ["london", "edinburgh", "manchester"],
          "united kingdom":["london", "edinburgh", "manchester"],
          "england":       ["london", "manchester"],
          "scotland":      ["edinburgh", "glasgow"],
          "ireland":       ["dublin"],
          "iceland":       ["reykjavik", "reykjavík"],
          "netherlands":   ["amsterdam"],
          "belgium":       ["brussels"],
          "austria":       ["vienna", "wien", "salzburg"],
          "greece":        ["athens"],
          "turkey":        ["istanbul"],
          "japan":         ["tokyo", "osaka"],
          "thailand":      ["bangkok"],
          "vietnam":       ["hanoi", "ho chi minh", "saigon"],
          "south korea":   ["seoul"],
          "china":         ["beijing", "shanghai", "hong kong"],
          "australia":     ["sydney", "melbourne"],
          "new zealand":   ["auckland", "wellington"],
          "canada":        ["toronto", "montreal", "vancouver"],
          "mexico":        ["mexico city", "ciudad de méxico", "cancun", "cancún"],
          "morocco":       ["marrakech", "casablanca"],
          "egypt":         ["cairo"],
          "south africa":  ["cape town", "johannesburg"]
        };
        var regionKey = String((_tb && _tb.region) || "").toLowerCase().trim();
        // Region might be the country name or a sub-region — check both directly
        // and as a substring of any country key.
        var preferred = majorGateways[regionKey];
        if (!preferred) {
          Object.keys(majorGateways).forEach(function(k){
            if (!preferred && (regionKey.indexOf(k) >= 0 || k.indexOf(regionKey) >= 0)) {
              preferred = majorGateways[k];
            }
          });
        }
        if (preferred && preferred.length) {
          // Walk the preferred list in order — first matching kept candidate wins
          for (var pi = 0; pi < preferred.length && !entryCand; pi++) {
            var prefN = preferred[pi];
            kept.forEach(function(c){
              if (entryCand) return;
              var cN = _normPlaceName(c.place);
              if (cN === prefN || cN.indexOf(prefN) >= 0 || prefN.indexOf(cN) >= 0) entryCand = c;
            });
          }
        }
      }
      // Last resort — first kept candidate overall
      if (!entryCand && kept.length > 0) entryCand = kept[0];
      if (entryCand) {
        entryInferred = true;
        reasoning.push("No arrival city was set, so I'm starting the trip in " + entryCand.place + ". Change it if another city fits your arrival better.");
      }
    }

    // Find exit candidate
    var exitCand = null;
    if (exitN) {
      remaining.forEach(function(c){ if (!exitCand && matchesName(c, exitN) && c !== entryCand) exitCand = c; });
    }
    // Round CP.1: if no exit was specified AND we inferred an entry from the
    // major-gateway fallback, assume round trip — the user almost certainly
    // departs from the same gateway. This avoids the trip just trailing off
    // at "wherever the last stop is."
    if (!exitCand && !exitN && entryInferred && entryCand) {
      // The exit IS the entry city; we'll add an exit stop to round-trip back
      // there. Don't reuse the same candidate object since we want a distinct
      // exit destination at the end. Leave exitCand null — the existing
      // exit-stop synthesis in buildFromCandidates handles inserting the exit
      // city as a 1-night buffer when entryCity is set.
      if (!_tb.tbExit) _tb.tbExit = entryCand.place;
    }

    // Place entry (if found and not in a block)
    if (entryCand && remaining.indexOf(entryCand) >= 0) {
      ordered.push(entryCand);
      remaining = remaining.filter(function(c){ return c !== entryCand; });
      if (!entryInferred) {
        reasoning.push("Starting in " + entryCand.place + " since that's where you're arriving.");
      }
    } else if (entryCand && placed[entryCand.id] && entryInferred) {
      // Inferred entry is a route endpoint — put its block first
      // Move the block containing entryCand to the front of routeBlocks
      var blockIdx = -1;
      routeBlocks.forEach(function(b, bi){
        if (b.candidates.indexOf(entryCand) >= 0 && blockIdx < 0) blockIdx = bi;
      });
      if (blockIdx > 0) {
        var block = routeBlocks.splice(blockIdx, 1)[0];
        routeBlocks.unshift(block);
      }
    }

    // Place route blocks — respect direction alignment
    // Round FX: dedupe candidates as we push. A route whose two
    // endpoints resolve to the SAME kept candidate object (e.g., an
    // "Iceland Ring Road" route from Reykjavik back to Reykjavik for
    // a round trip) was producing oriented=[reykCand, reykCand] and
    // pushing both — emitting Reykjavik twice into ordered, which
    // became the duplicate Reykjavik 3n + Reykjavik 3n we kept seeing
    // in trip.destinations. Track seen ids/objects to skip the
    // double-push without affecting normal route blocks where the two
    // endpoints are different candidates.
    var _orderedSeenIds = {};
    ordered.forEach(function(c){ if (c && c.id) _orderedSeenIds[c.id] = true; });
    routeBlocks.forEach(function(block){
      var oriented = pickDirection(block, entryCity, exitCity);
      oriented.forEach(function(c){
        if (!c || !c.id) return;
        if (_orderedSeenIds[c.id]) return;
        _orderedSeenIds[c.id] = true;
        ordered.push(c);
      });
    });

    // Append remaining non-exit candidates in their original list order
    remaining.forEach(function(c){
      if (!c || c === exitCand) return;
      // Round FX: same dedupe — defense in depth so a kept candidate
      // can't slip in twice if some upstream pass populates it weirdly.
      if (c.id && _orderedSeenIds[c.id]) return;
      if (c.id) _orderedSeenIds[c.id] = true;
      ordered.push(c);
    });

    // Place exit last
    if (exitCand) {
      ordered.push(exitCand);
      reasoning.push("Ending in " + exitCand.place + " since that's where you're departing from.");
    }

    // Condition bunching pass: if multiple candidates are viable locations for a
    // condition event, try to make them consecutive
    activeConditions.forEach(function(cond){
      var viable = (cond.viableLocations || cond.requiredPlaces || []).map(function(p){ return _normPlaceName(p.place); });
      var viableCands = ordered.filter(function(c){
        var cN = _normPlaceName(c.place);
        return viable.some(function(v){ return v === cN || v.indexOf(cN) >= 0 || cN.indexOf(v) >= 0; });
      });
      if (viableCands.length >= 2) {
        reasoning.push("Bunching your " + cond.name + " locations (" + viableCands.map(function(c){return c.place;}).join(", ") + ") close together so weather gives you a real chance.");
        // Find lowest-index viable candidate and move the others to be adjacent
        var firstIdx = ordered.indexOf(viableCands[0]);
        var toMove = viableCands.slice(1);
        toMove.forEach(function(c, i){
          var curIdx = ordered.indexOf(c);
          if (curIdx > firstIdx + 1 + i) {
            ordered.splice(curIdx, 1);
            ordered.splice(firstIdx + 1 + i, 0, c);
          }
        });
      }
    });

    // Recovery pass: if a candidate has a high-recovery condition attached, mark
    // the NEXT candidate as a "recovery day" (metadata for display)
    activeConditions.forEach(function(cond){
      if (cond.recovery !== "high" && cond.recovery !== "moderate") return;
      var viable = (cond.viableLocations || cond.requiredPlaces || []).map(function(p){ return _normPlaceName(p.place); });
      for (var i = 0; i < ordered.length; i++) {
        var cN = _normPlaceName(ordered[i].place);
        var isViable = viable.some(function(v){ return v === cN || v.indexOf(cN) >= 0 || cN.indexOf(v) >= 0; });
        if (isViable && ordered[i+1]) {
          ordered[i+1]._recoveryDay = cond.recovery;
          ordered[i+1]._recoveryFor = cond.name;
        }
      }
    });

    // Round CN: geographic re-order pass. After all the rule-based ordering
    // (entry → blocks → free → exit, then condition bunching, then recovery),
    // there's still often a zigzag because the "free" middle destinations are
    // in whatever order Max suggested them. Apply nearest-neighbor on those
    // to untangle the path. Route blocks stay glued (their endpoints must be
    // adjacent), entry stays at index 0, exit stays at the last index. Only
    // truly free single-destination items get reordered, so we don't break
    // any of the constraints the earlier passes set up.
    ordered = (function _geoReorderOrdered(){
      if (ordered.length < 4) return ordered; // 1-3 destinations: nothing to optimize
      function getCoord(c){
        if (!c) return null;
        if (typeof c.lat === "number" && typeof c.lng === "number" && isFinite(c.lat) && isFinite(c.lng)) return [c.lat, c.lng];
        if (typeof getCityCenter === "function") {
          var ctr = getCityCenter(c.place);
          if (ctr && isFinite(ctr[0]) && isFinite(ctr[1])) return ctr;
        }
        return null;
      }
      function distSq(a, b){
        if (!a || !b) return Infinity;
        var dLat = a[0] - b[0], dLng = a[1] - b[1];
        return dLat*dLat + dLng*dLng;
      }
      // Identify which candidates are part of a route block (must keep
      // adjacency to their pair) — those are NOT movable as singletons.
      var inRouteBlock = {};
      routeBlocks.forEach(function(b){
        b.candidates.forEach(function(c){ inRouteBlock[c.id] = b; });
      });
      // Walk `ordered` and group consecutive items into "sequences": each
      // sequence is either a single free candidate or a route-block run.
      var sequences = [];
      var k = 0;
      while (k < ordered.length) {
        var cur = ordered[k];
        if (inRouteBlock[cur.id]) {
          // Gather all consecutive members of THIS block
          var block = inRouteBlock[cur.id];
          var seq = [cur];
          k++;
          while (k < ordered.length && inRouteBlock[ordered[k].id] === block) {
            seq.push(ordered[k]);
            k++;
          }
          sequences.push({items: seq, locked: true});
        } else {
          sequences.push({items: [cur], locked: false});
          k++;
        }
      }
      if (sequences.length < 4) return ordered; // entry + a few + exit — not enough to reorder
      // Anchors: first sequence stays first (entry), last stays last (exit).
      var entrySeq = sequences[0];
      var exitSeq = sequences[sequences.length - 1];
      var middle = sequences.slice(1, -1);
      if (middle.length < 2) return ordered; // nothing meaningful to reorder
      // Compute representative coord for each middle sequence (centroid).
      middle.forEach(function(s){
        var coords = s.items.map(getCoord).filter(Boolean);
        if (!coords.length) { s.coord = null; return; }
        var lat = 0, lng = 0;
        coords.forEach(function(c){ lat += c[0]; lng += c[1]; });
        s.coord = [lat / coords.length, lng / coords.length];
      });
      // Last-item coord on the entry sequence (where we'd be leaving from)
      var lastEntryCoord = (function(){
        for (var i = entrySeq.items.length - 1; i >= 0; i--) {
          var c = getCoord(entrySeq.items[i]);
          if (c) return c;
        }
        return null;
      })();
      // First-item coord on the exit sequence (where we'd be heading to)
      var firstExitCoord = (function(){
        for (var i = 0; i < exitSeq.items.length; i++) {
          var c = getCoord(exitSeq.items[i]);
          if (c) return c;
        }
        return null;
      })();
      // Round DO + v359.5.6: pick the better of TWO orderings:
      //   • Nearest-neighbor walk from entry's last coord (good at
      //     point-to-point sequencing along a line)
      //   • Angular sort around the trip centroid (good at perimeter
      //     sweeps — ring roads, coastline loops, Wild Atlantic Way,
      //     South Island NZ, Sri Lanka coastal circles, etc.)
      // Compute the total path length under each and use whichever is
      // shorter. This generalizes the v359.5.6 ring-road heuristic
      // (which was keyword-driven and only caught explicit "ring road"
      // mentions) into a domain-free rule: angular sort wins on
      // perimeter-shaped trips, NN wins on linear ones, no country
      // list or vocabulary mapping required.
      // Round-trip detection (entry within ~30km of exit) is still
      // useful as a hint for the reasoning blurb, but the path-choice
      // logic doesn't depend on it.
      var isRoundTrip = lastEntryCoord && firstExitCoord
        && Math.sqrt(distSq(lastEntryCoord, firstExitCoord)) < (30/111); // ~30km in degrees

      function _totalPathLen(seqList, startCoord, endCoord){
        if (!seqList.length) return 0;
        var total = 0;
        var cur = startCoord;
        seqList.forEach(function(s){
          if (s.coord && cur) total += Math.sqrt(distSq(cur, s.coord));
          if (s.coord) cur = s.coord;
        });
        if (cur && endCoord) total += Math.sqrt(distSq(cur, endCoord));
        return total;
      }

      // ── Candidate ordering A: nearest-neighbor from entry ────────
      var nnOrder = (function _nnSort(){
        var pool = middle.slice();
        var current = lastEntryCoord;
        var out = [];
        while (pool.length) {
          var bestIdx = 0;
          var bestDist = Infinity;
          for (var i = 0; i < pool.length; i++) {
            var p = pool[i];
            if (!p.coord) continue;
            var d = distSq(current, p.coord);
            // For the last placement, weight in distance-to-exit so we don't
            // strand a far destination right before the exit.
            if (pool.length === 1 && firstExitCoord) {
              d = d * 0.6 + distSq(p.coord, firstExitCoord) * 0.4;
            }
            if (d < bestDist) { bestDist = d; bestIdx = i; }
          }
          var picked = pool.splice(bestIdx, 1)[0];
          out.push(picked);
          if (picked.coord) current = picked.coord;
        }
        return out;
      })();

      // ── Candidate ordering B: angular sweep around centroid ─────
      var angOrder = (function _angSort(){
        // Centroid across entry + middle + exit so the angle is measured
        // from a stable center (not biased by entry position).
        var allCoords = [lastEntryCoord];
        middle.forEach(function(s){ if (s.coord) allCoords.push(s.coord); });
        if (firstExitCoord) allCoords.push(firstExitCoord);
        if (!allCoords.length) return middle.slice();
        var cLat = 0, cLng = 0;
        allCoords.forEach(function(c){ cLat += c[0]; cLng += c[1]; });
        cLat /= allCoords.length;
        cLng /= allCoords.length;
        // Entry's angle from centroid — the sweep starts from there.
        var entryAngle = Math.atan2(lastEntryCoord[0] - cLat, lastEntryCoord[1] - cLng);
        // Try both directions (CCW and CW) and use whichever ends
        // closer to the exit. Without this, the sweep is locked to one
        // direction and may leave the exit on the wrong side of the
        // loop.
        var middleWithAngle = middle.map(function(s){
          if (!s.coord) return { seq: s, angle: Infinity };
          var a = Math.atan2(s.coord[0] - cLat, s.coord[1] - cLng);
          var rel = a - entryAngle;
          while (rel < 0) rel += 2 * Math.PI;
          return { seq: s, angle: rel };
        });
        var ccw = middleWithAngle.slice().sort(function(a,b){ return a.angle - b.angle; });
        var cw  = middleWithAngle.slice().sort(function(a,b){ return b.angle - a.angle; });
        function pathFromOrdering(arr){ return arr.map(function(x){ return x.seq; }); }
        var ccwSeq = pathFromOrdering(ccw);
        var cwSeq  = pathFromOrdering(cw);
        var ccwLen = _totalPathLen(ccwSeq, lastEntryCoord, firstExitCoord);
        var cwLen  = _totalPathLen(cwSeq,  lastEntryCoord, firstExitCoord);
        return (cwLen < ccwLen) ? cwSeq : ccwSeq;
      })();

      // Pick whichever is shorter overall.
      var nnLen  = _totalPathLen(nnOrder,  lastEntryCoord, firstExitCoord);
      var angLen = _totalPathLen(angOrder, lastEntryCoord, firstExitCoord);
      var reordered;
      if (angLen < nnLen) {
        reordered = angOrder;
        if (isRoundTrip) {
          reasoning.push("Entry and exit are the same area, so I swept the destinations around the perimeter — shorter than visiting them in arrival order.");
        } else {
          reasoning.push("Ordered the destinations around the perimeter rather than point-to-point — total drive is shorter that way (" + Math.round(angLen * 111) + "km vs " + Math.round(nnLen * 111) + "km).");
        }
      } else {
        reordered = nnOrder;
      }
      // Reassemble
      var out = [];
      entrySeq.items.forEach(function(c){ out.push(c); });
      reordered.forEach(function(s){ s.items.forEach(function(c){ out.push(c); }); });
      exitSeq.items.forEach(function(c){ out.push(c); });
      // Note in reasoning if the order actually changed
      var orderChanged = out.some(function(c, i){ return c !== ordered[i]; });
      if (orderChanged) {
        reasoning.push("Reordered the middle of the trip to flow geographically — fewer long backtracks between stops. Route adjacencies kept intact.");
      }
      return out;
    })();

    return {
      ordered: ordered,
      reasoning: reasoning,
      inferredEntry: entryInferred && entryCand ? {place: entryCand.place, country: entryCand.country || ""} : null
    };
  }

  // ── Round HL: buildFromCandidates decomposition (Phase 3 cont.) ──
  // The 784-line buildFromCandidates is being split incrementally.
  // HL extracts the three purest pieces — brief construction, mdc
  // clone, trip-name derivation. Each is a pure function on picker
  // state, no side effects. Inline buildFromCandidates calls them
  // via the namespace; the regression suite (51 tests) gates each
  // step. Subsequent rounds (HL.1+) extract the harder pieces:
  // entry/exit synthesis, destination construction, reconcile path.

  // buildBrief(state) — given picker draft state (typically _tb),
  // produce the trip's brief envelope. Pure: no globals, no DOM.
  function buildBrief(state) {
    var s = state || {};
    return {
      region: s.region, when: s.when, intent: s.intent,
      interests: s.interests, anchors: s.anchors,
      familiarity: s.familiarity, pace: s.pace,
      accommodation: s.accommodation, compromises: s.compromises,
      hardlimits: s.hardlimits, duration: s.duration,
      tripMode: s.tripMode || null,
      placeName: s.placeName || '',
      placeContext: s.placeContext || '',
      activityDesc: s.activityDesc || '',
      activityChips: (s.activityChips || []).slice(),
      activityRegion: s.activityRegion || '',
      dateMode: s.dateMode || '',
      startDate: s.startDate || '',
      endDate: s.endDate || '',
      days: (typeof s.days === 'number' ? s.days : null),
      // v358.3: include entry/tbExit/buffers in the brief so a rebuild
      // (trip.brief = newBrief at publishTrip line ~1352) preserves
      // the user's arrival/departure choices. Without these the
      // trip-view's "Apply" path silently wiped the typed values.
      entry: s.entry || '',
      tbExit: s.tbExit || '',
      entryBuffer: (s.entryBuffer === false) ? false : true,
      exitBuffer: (s.exitBuffer === false) ? false : true,
      entryMode: s.entryMode || '',
      exitMode: s.exitMode || '',
      partyComposition: s.partyComposition || '',
      partySize: s.partySize || '',
      partyAges: s.partyAges || '',
      physicalAbility: s.physicalAbility || '',
      abilityNote: s.abilityNote || '',
      avoid: Object.assign({}, s.avoid || {}),
      avoidOther: s.avoidOther || '',
    };
  }

  // cloneMdcItems(items) — produce a clean snapshot of must-do/anchor
  // items, preserving the fields needed for picker rehydration on
  // re-edit (Round BK + EN).
  function cloneMdcItems(items) {
    return (items || []).map(function (m) {
      return {
        id: m.id, name: m.name, type: m.type, checked: m.checked,
        section: m.section || '',
        iconic: !!m.iconic,
        category: m.category || null,
        requiredPlaces: m.requiredPlaces,
        endpoints: m.endpoints,
        viableLocations: m.viableLocations,
        direction: m.direction,
        durationHours: m.durationHours,
        modeOptions: m.modeOptions,
        alternatives: m.alternatives,
        reservationNotes: m.reservationNotes,
        recovery: m.recovery,
        frequencyRequirement: m.frequencyRequirement,
        conditionNote: m.conditionNote,
        description: m.description,
        chosenMode: m.chosenMode || null,
      };
    });
  }

  // deriveTripName(state, kept) — the auto-name fallback per Round EB.
  // Prefers user-typed placeName, then region, then first kept place.
  function deriveTripName(state, kept) {
    var s = state || {};
    var ks = kept || [];
    var tc = (typeof global._titleCaseCity === 'function')
      ? global._titleCaseCity
      : function (x) { return x || ''; };
    var place = (s.placeName || '').trim();
    if (place) return tc(place);
    var region = (s.region || '').trim();
    if (region) return tc(region);
    if (ks.length === 1) return tc(ks[0].place || '') || 'New trip';
    if (ks.length > 1) {
      var first = tc(ks[0].place || '');
      return first ? (first + ' + ' + (ks.length - 1) + ' more') : 'New trip';
    }
    return 'New trip';
  }

  // isAutoName(name) — recognize an auto-generated trip name so
  // rebuilds preserve user-typed names but overwrite stale auto names.
  function isAutoName(name) {
    if (!name) return true;
    return name.indexOf('Untitled — ') === 0
        || name.indexOf('Untitled - ') === 0
        || name === 'New trip'
        || name === 'Untitled trip';
  }

  // ── Round HL.X: full publishTrip — was inline buildFromCandidates ──
  //
  // 738-line body lifted from index.html. References inline-script
  // globals (callMax, trip, _tb, _mdcItems, makeDays, sidCtr, etc.)
  // via scope-chain lookup — they're all on window from the inline
  // script's top-level var/function declarations, so they resolve
  // through the IIFE's outer scope without needing explicit
  // global. prefixes.
  //
  // The inline-script `buildFromCandidates` entry point is now a
  // thin delegator that calls this. Existing callers (the picker's
  // Build button, the brief-edit Apply path, etc.) work unchanged.

  // v359.45 Phase 1 helpers — used by the day-trip clustering below.
  // Mirror the logic in migration.js so writers produce shapes that
  // match the read-time expectations. Local to engine-picker because
  // this is the only writer in the active path; if a second writer
  // shows up, lift these into a shared module.
  function _ensurePlace(trip, p) {
    if (!p || !p.place) return null;
    if (!trip.places) trip.places = {};
    var slug = String(p.place || '').trim().toLowerCase()
      .replace(/þ/g, 'th').replace(/ð/g, 'd')
      .replace(/æ/g, 'ae').replace(/œ/g, 'oe')
      .replace(/ø/g, 'o').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    var placeId = 'pl-' + (slug || 'unknown');
    if (!trip.places[placeId]) {
      trip.places[placeId] = {
        id: placeId, name: p.place, country: p.country || null,
        lat: (typeof p.lat === 'number') ? p.lat : null,
        lng: (typeof p.lng === 'number') ? p.lng : null,
        type: p.type || 'place'
      };
    } else {
      var ex = trip.places[placeId];
      if (ex.lat == null && typeof p.lat === 'number') ex.lat = p.lat;
      if (ex.lng == null && typeof p.lng === 'number') ex.lng = p.lng;
      if (!ex.country && p.country) ex.country = p.country;
    }
    return placeId;
  }
  function _buildDaysShim(dest) {
    var days = [];
    if (dest.dateFrom && dest.dateTo) {
      var s = new Date(dest.dateFrom + 'T00:00:00Z');
      var e = new Date(dest.dateTo + 'T00:00:00Z');
      var d = new Date(s);
      while (d < e) {
        days.push({ date: d.toISOString().slice(0,10), planItems: [] });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    } else {
      var n = (typeof dest.nights === 'number') ? dest.nights : 0;
      for (var i = 0; i < n; i++) days.push({ date: null, planItems: [] });
    }
    return days;
  }

  async function publishTrip(){
    var kept=(_tb.candidates||[]).filter(function(c){return c.status==="keep";});
    if(!kept.length) return;

    // Round HZ (picker hero map, step 7): entry/exit validation.
    // During the picker phase, orderKeptCandidates runs on the ACTIVE
    // set (accepted + unchecked) and can infer _tb.tbExit from an
    // unchecked major-gateway candidate (round-trip heuristic at the
    // top of orderKeptCandidates). At publish time we order only the
    // accepted set; if _tb.entry or _tb.tbExit references a non-accepted
    // place, it's stale and the substring-match in orderKeptCandidates
    // will silently fail to find an entry/exit anchor. Clearer to blank
    // it explicitly so the inference path runs from a clean slate —
    // first kept in geographic order becomes the implicit arrival, last
    // becomes the implicit departure. The user's typed entry/exit on
    // the Trip Details strip survives if it matches a kept candidate.
    // v358.3: preserve the user's typed entry/exit on a separate
    // _tb._typedEntry / _tb._typedExit BEFORE the validator may clear
    // _tb.entry / _tb.tbExit, then restore at end of publishTrip
    // (after buildBrief runs). The "fall back to geographic inference"
    // behavior of orderKeptCandidates depends on _tb.entry being ""
    // when it doesn't match a kept candidate — keeping that semantic.
    if (_tb.entry) _tb._typedEntry = _tb.entry; else _tb._typedEntry = "";
    if (_tb.tbExit) _tb._typedExit = _tb.tbExit; else _tb._typedExit = "";
    if (_tb.entry) {
      var entryMatchesKept = kept.some(function(c){
        var cN = _normPlaceName(c.place||"");
        var eN = _normPlaceName(_tb.entry||"");
        return cN && eN && (cN.indexOf(eN) >= 0 || eN.indexOf(cN) >= 0);
      });
      if (!entryMatchesKept) _tb.entry = "";
    }
    if (_tb.tbExit) {
      var exitMatchesKept = kept.some(function(c){
        var cN = _normPlaceName(c.place||"");
        var xN = _normPlaceName(_tb.tbExit||"");
        return cN && xN && (cN.indexOf(xN) >= 0 || xN.indexOf(cN) >= 0);
      });
      if (!exitMatchesKept) _tb.tbExit = "";
    }

    // Round DW: detect rebuild vs fresh build. Rebuilds preserve the
    // existing trip object — and its destinations array — so
    // _reconcileDestinations can mutate identity-bearing destinations in
    // place. Bookings, day items, locations, suggestions, etc. survive
    // automatically because the JS objects holding them are the same
    // ones from before the rebuild. This eliminates the snapshot/restore
    // cycle that had to be threaded through saveActivityPickerEdits and
    // the trip-edit Apply path, and ends the bug class where a new
    // dest.* field would silently get dropped on rebuild because nobody
    // remembered to add it to the snapshot list.
    var isRebuild = !!(_tb && _tb._isRebuild) || !!(trip && Array.isArray(trip.destinations) && trip.destinations.length > 0);
    var oldDestinations = isRebuild ? (trip.destinations||[]).slice() : [];

    // Round HL: brief + mdcItems construction now lives in
    // engine-picker.js as pure helpers. Same inputs, same output —
    // see MaxEnginePicker.buildBrief / .cloneMdcItems for the field
    // list + comment trail.
    var newBrief = MaxEnginePicker.buildBrief(_tb);
    var newMdcItems = MaxEnginePicker.cloneMdcItems(_mdcItems);

    // Round HL: name derivation now lives in engine-picker.js.
    // _isAutoName + _deriveTripName extracted as MaxEnginePicker.isAutoName
    // and .deriveTripName. Same Round EB rules — prefer placeName,
    // fall through to region, kept[0], "New trip".
    var resolvedName = MaxEnginePicker.isAutoName(_tb.name)
      ? MaxEnginePicker.deriveTripName(_tb, kept)
      : _tb.name;

    if (isRebuild) {
      // Mutate trip in place — keep the object reference and its
      // destinations / legs / pendingActions / trackSpending fields.
      trip.name = MaxEnginePicker.isAutoName(trip.name) ? resolvedName : trip.name;
      trip.brief = newBrief;
      trip.mdcItems = newMdcItems;
      if (!Array.isArray(trip.pendingActions)) trip.pendingActions = [];
      if (!trip.legs) trip.legs = {};
      if (typeof trip.trackSpending !== "boolean") trip.trackSpending = false;
      // Counters (destCtr/sidCtr/bkCtr) keep their current values so any
      // freshly-created destinations / sights / bookings get unique IDs
      // that don't collide with surviving ones.
    } else {
      trip={name:resolvedName,destinations:[],legs:{},trackSpending:false,pendingActions:[],
        brief:newBrief, mdcItems:newMdcItems, logistics:null};
      activeDest=null; destCtr=0; sidCtr=100; bkCtr=0; _actionCtr=0; _fileHandle=null;
    }
    var tripId = isRebuild ? (_currentTripId || ("trip-"+Date.now())) : ("trip-"+Date.now());
    _currentTripId = tripId;

    // Parse start date from brief
    var startDate=parseStartDateFromBrief(_tb.when||"");

    // ── Event-aware ordering ──────────────────────────────────
    // Order kept candidates so that:
    //   • route endpoints are adjacent and aligned with trip flow (entry → exit)
    //   • condition-viable locations get bunched together where possible
    //   • destinations with late-recovery conditions are followed by easier days
    // Returns {ordered, reasoning}
    var orderResult = orderKeptCandidates(kept, _mdcItems||[], _tb.entry||"", _tb.tbExit||"");
    var ordered = orderResult.ordered;
    trip.orderingReasoning = orderResult.reasoning;

    // v358.3: now that orderKeptCandidates has run with the validated
    // (possibly-cleared) entry/exit — letting it fall back to
    // geographic inference when the user typed something not in the
    // kept set — restore the typed value on _tb AND on newBrief so the
    // typed value flows through the rest of publishTrip:
    //   * the "prepend arrival stop" pass below sees it (line ~1422)
    //   * trip.brief gets it via the OR fallback at line ~2178
    //   * the trip-view's editable arrival/departure form re-renders
    //     with the typed value preserved
    // Without this restore the user's "I'm flying into Keflavík" gets
    // wiped because Keflavík isn't itself a kept overnight stop.
    if (_tb._typedEntry) {
      _tb.entry = _tb._typedEntry;
      newBrief.entry = _tb._typedEntry;
    }
    if (_tb._typedExit) {
      _tb.tbExit = _tb._typedExit;
      newBrief.tbExit = _tb._typedExit;
    }
    // Also patch trip.brief if we're in a rebuild and it already
    // points at the new brief object (publishTrip's else-branch at
    // ~1361 may not have run yet, so guard).
    if (trip && trip.brief === newBrief) {
      if (_tb._typedEntry) trip.brief.entry = _tb._typedEntry;
      if (_tb._typedExit) trip.brief.tbExit = _tb._typedExit;
    }
    // Round FG: trip.reorderNotice stash removed. See comment in
    // drawTripMode where the banner used to render — short version:
    // the picker doesn't define an order, so there's no user
    // preference for the geo-reorder to override. Clean up legacy
    // notices on existing trips so the now-orphaned data doesn't sit
    // around forever.
    if (trip.reorderNotice) delete trip.reorderNotice;

    // Round GA.1: simplified entry/exit synthesis. The buffer-on-top-of-
    // already-kept logic (FY entry, BL/BM exit) is gone — buffers are
    // now opt-in via the per-card "+ Add arrival/departure buffer"
    // buttons on the trip view (Round GA). The remaining job is just:
    // if the user typed an entry city that isn't in their picks, prepend
    // it so the trip starts where they arrive (otherwise the trip would
    // open at whatever destination happened to be first in the picker).
    // Same for exit city. No flags, no banners, no auto-buffers.
    (function(){
      var entry = (_tb.entry || "").trim();
      if (!entry) return;
      var entryN = _normPlaceName(entry);
      var firstMatches = ordered.length && (function(){
        var fN = _normPlaceName(ordered[0].place);
        return fN.indexOf(entryN) >= 0 || entryN.indexOf(fN) >= 0;
      })();
      if (firstMatches) return; // entry already heads the trip
      var entryStop = {
        id: "c-entry-" + Date.now(),
        place: entry,
        country: (_tb.region || ""),
        role: "arrival",
        stayRange: "1 night",
        nights: 1,
        whyItFits: "Where you arrive — Max suggests one night to recover before moving on. Adjust or drop if you'd rather push through.",
        tradeoffs: "",
        tags: ["arrival"],
        lat: null, lng: null
      };
      ordered = [entryStop].concat(ordered);
      if (orderResult.reasoning) {
        orderResult.reasoning.unshift("Starting in " + entry + " — that's where you arrive. Edit or drop if you'd rather not stop here.");
      }
    })();

    (function(){
      var exit = (_tb.tbExit || "").trim();
      if (!exit) return;
      var exitN = _normPlaceName(exit);
      var lastMatches = ordered.length && (function(){
        var lN = _normPlaceName(ordered[ordered.length - 1].place);
        return lN.indexOf(exitN) >= 0 || exitN.indexOf(lN) >= 0;
      })();
      if (lastMatches) return; // exit already terminates the trip
      // If the exit city already exists somewhere in the trip (round
      // trip, typically at the start), don't duplicate — the user gets
      // back to that city via the existing destination card.
      var alreadyInTrip = ordered.some(function(d){
        var dN = _normPlaceName(d.place || "");
        return dN.indexOf(exitN) >= 0 || exitN.indexOf(dN) >= 0;
      });
      if (alreadyInTrip) return;
      var exitStop = {
        id: "c-exit-" + Date.now(),
        place: exit,
        country: (_tb.region || ""),
        role: "departure",
        stayRange: "1 night",
        nights: 1,
        whyItFits: "Where you depart — Max added one night here so the trip ends at your fly-out city. Adjust or drop if you'd rather fly home directly from your last activity stop.",
        tradeoffs: "",
        tags: ["departure"],
        lat: null, lng: null
      };
      ordered = ordered.concat([exitStop]);
      if (orderResult.reasoning) {
        orderResult.reasoning.push("Ending in " + exit + " — that's where you depart from.");
      }
    })();

    // If entry was inferred (no arrival was set by the user), persist it so the
    // Step 2 form shows it filled in with a "Max suggested" marker, and the brief
    // accurately reflects what the trip is built on.
    if (orderResult.inferredEntry && !_tb.entry) {
      _tb.entry = orderResult.inferredEntry.place;
      _tb.entryInferred = true;
      if (trip.brief) {
        trip.brief.entry = _tb.entry;
        trip.brief.entryInferred = true;
      }
    }

    // Round CH: clamp total nights to the brief's duration. The picker LLM
    // sometimes generates more requiredPlaces (each with ≥1 night) than the
    // trip duration can accommodate — a "4 weeks" Switzerland brief with 18
    // requiredPlaces × ~2 nights each yields 30+ nights when the budget is
    // ~27. We shrink the largest stays one night at a time until totals fit,
    // never letting any kept place drop below 1 night (else we'd silently
    // drop destinations the user picked).
    (function detectOverBudget(){
      // Round EW: don't auto-trim. Detect that the picker total
      // exceeds the budget, stash the situation on trip.overBudgetNotice,
      // and let the trip view surface the choice — extend dates, drop a
      // destination, shorten a stay, or accept the over-budget trip as
      // is. Same "Max suggests, user decides" pattern as Round EV's
      // day-trip control. Round CH used to silently trim the longest
      // stays, then Round EQ disclosed it after the fact. EW skips the
      // application and presents the proposal up front.
      var budget = _parseTripDuration((trip.brief && trip.brief.duration) || (_tb && _tb.duration) || "");
      if (!budget) {
        delete trip.overBudgetNotice;
        delete trip.clampNotice; // legacy field — clear if present
        return;
      }
      var targetNights = budget.max - 1;
      function resolveNights(c){
        return (typeof c.nights === "number" && c.nights >= 0)
          ? c.nights
          : (parseNightsFromRange(c.stayRange) || 3);
      }
      ordered.forEach(function(c){ c.nights = resolveNights(c); });
      var sumNights = ordered.reduce(function(s,c){return s+(c.nights||0);}, 0);
      if (sumNights <= targetNights) {
        delete trip.overBudgetNotice;
        delete trip.clampNotice;
        return;
      }
      // Compute the trim Max WOULD propose — same algorithm as before,
      // but applied to a copy. We stash both the proposal and the
      // current per-destination nights so the banner can show the
      // diff and offer an "Apply trim" button.
      var workingNights = {};
      ordered.forEach(function(c){
        if (!c.place) return;
        var k = (typeof _normPlaceName === "function") ? _normPlaceName(c.place) : (c.place||"").toLowerCase();
        workingNights[k] = c.nights || 0;
      });
      var workingSum = sumNights;
      var iterations = 0;
      while (workingSum > targetNights && iterations < 100) {
        iterations++;
        var biggestKey = null, biggestNights = 0, biggestRequired = true;
        ordered.forEach(function(c){
          if (!c.place) return;
          var k = (typeof _normPlaceName === "function") ? _normPlaceName(c.place) : (c.place||"").toLowerCase();
          var n = workingNights[k] || 0;
          if (n <= 1) return;
          if (biggestKey === null) { biggestKey = k; biggestNights = n; biggestRequired = !!c._required; return; }
          if (n > biggestNights) { biggestKey = k; biggestNights = n; biggestRequired = !!c._required; return; }
          if (n === biggestNights) {
            // Tie-break: prefer non-required so must-dos stay long.
            if (!c._required && biggestRequired) { biggestKey = k; biggestNights = n; biggestRequired = false; }
          }
        });
        if (biggestKey === null) break;
        workingNights[biggestKey] -= 1;
        workingSum -= 1;
      }
      var proposedDeltas = [];
      ordered.forEach(function(c){
        if (!c.place) return;
        var k = (typeof _normPlaceName === "function") ? _normPlaceName(c.place) : (c.place||"").toLowerCase();
        var before = c.nights || 0;
        var after = workingNights[k] != null ? workingNights[k] : before;
        if (before > after) {
          proposedDeltas.push({place: c.place, before: before, after: after, key: k});
        }
      });
      console.log("[Max night-clamp DETECT-ONLY] picker=" + sumNights + " budget=" + targetNights + " over by " + (sumNights - targetNights));
      trip.overBudgetNotice = {
        budgetDays: budget.max,
        pickerNights: sumNights,
        pickerDays: sumNights + 1,
        targetNights: targetNights,
        overage: sumNights - targetNights,
        proposedDeltas: proposedDeltas,
        ts: new Date().toISOString()
      };
      // Don't set legacy trip.clampNotice — that banner described
      // already-applied trims. Under EW the trims aren't applied yet.
      delete trip.clampNotice;
    })();

    // Round DW: incremental reconcile of trip.destinations.
    //
    // _reconcileDestinations preserves identity (same JS object) for
    // unchanged destinations, mutates nights/days in place where they
    // changed (replaying day items by clamped index), creates fresh
    // destinations for added candidates, and logs PendingActions for
    // bookings on removed destinations. Because surviving dest objects
    // are the same instances as before, all their state — bookings,
    // locations, suggestions, day items, dayTrips, execMode, etc. —
    // survives automatically. No snapshot/restore.
    //
    // Hotel-date validation (Round DT) still runs below the reconcile,
    // since it has to check against the *new* dateFrom/dateTo set by
    // reconcile — not the pre-rebuild dates.
    trip.destinations = _reconcileDestinations(oldDestinations, ordered, startDate);

    // Round FW.1: safety-net merge for adjacent same-place destinations
    // at the end of build. Round DZ.1 dedupes by id but not by place;
    // legacy/corrupt trips and orderKeptCandidates edge cases can still
    // emit two distinct destinations with the same place name adjacent
    // (Iceland symptom: Reykjavik 3n + Reykjavik 3n at start, with the
    // proper exit-stop Reykjavik 1n separately at the end). The merge
    // sums their nights, concatenates state, and runs the date
    // recompute trip-wide — same logic that fires after moves/reverse,
    // applied here so a fresh build can't ship duplicates either.
    if (typeof _mergeAdjacentSamePlaceDests === "function") {
      _mergeAdjacentSamePlaceDests();
    }

    // Round DT (post-reconcile): hotel bookings whose check-in/out dates
    // fall outside the destination's new range need a PendingAction so
    // the user contacts the provider. Logged once per booking — the
    // already-logged guard prevents duplicates across repeat rebuilds.
    trip.destinations.forEach(function(dest){
      if (!Array.isArray(dest.hotelBookings) || !dest.hotelBookings.length) return;
      if (!dest.dateFrom || !dest.dateTo) return;
      dest.hotelBookings.forEach(function(bk){
        if (!bk || bk.status !== "booked") return;
        if (!bk.checkIn || !bk.checkOut) return;
        var inRange = (bk.checkIn >= dest.dateFrom) && (bk.checkOut <= dest.dateTo);
        if (inRange) return;
        var alreadyLogged = (trip.pendingActions || []).some(function(a){
          return a && !a.cleared
            && a.eventType === "hotel"
            && a.confirmationNumber === (bk.confirmationNumber || null)
            && a.eventName === bk.name;
        });
        if (alreadyLogged) return;
        if (typeof addPendingAction === "function") {
          addPendingAction({
            eventType: "hotel",
            actionType: "moved",
            eventName: bk.name || "Hotel",
            destName: dest.label || dest.place,
            confirmationNumber: bk.confirmationNumber || null,
            detail: "Booking dates (" + bk.checkIn + " — " + bk.checkOut + ") fall outside the destination's new range (" + dest.dateFrom + " — " + dest.dateTo + "). Contact hotel to cancel or rebook.",
            requiresProviderAction: true
          });
        }
      });
    });

    // Round CO: smart day-trip clustering. Short stays (≤2 nights) within
    // ~60km of a longer-stay hub get absorbed into the hub as day trips,
    // not their own bed. This collapses fragmentation (e.g. Bettmeralp into
    // Zermatt) without losing the place — the hub gets a "while you're
    // there" pill the user can click to ungroup. Heuristic:
    //   - Source has ≤ 2 nights AND hub has > source.nights (so a 2-night
    //     can be absorbed by a 3+ but not by another 2)
    //   - Source must NOT be entry/exit stop (those bookend the calendar)
    //   - Distance must be ≤ 60km (rough day-trip radius — buses/trains
    //     handle ~1hr each way comfortably)
    //   - Source's attached events move to hub's dayTrips
    (function _autoClusterDayTrips(){
      if (!trip.destinations.length) return;
      // Round EV: auto-clustering on a geometric heuristic disabled
      // ("user decides, not the algorithm"). v359.24 reactivates this
      // function but rewires it to the user's explicit role-chip
      // decisions in the picker (c.intent === "dayTrip" with c.dayTripHub
      // pointing at the hub candidate). The absorption mechanics —
      // build dayTrip chip on the hub, roll source nights into hub,
      // remove source destination, recompute dates — are unchanged.
      // Only the source-of-pairs flipped: explicit user intent rather
      // than distance/nights heuristic.
      var _pickerCands = (_tb && Array.isArray(_tb.candidates)) ? _tb.candidates : [];
      if (!_pickerCands.length) return;
      function _norm(s){
        return (typeof _normPlaceName === "function") ? _normPlaceName(s||"") : String(s||"").toLowerCase().trim();
      }
      // Build place→candidate index so we can match destinations to
      // their source candidates by name (destinations don't carry a
      // candidate-id reference).
      var candByPlace = {};
      _pickerCands.forEach(function(c){
        if (c && c.place) candByPlace[_norm(c.place)] = c;
      });
      // Build (source dest, hub dest) absorbtion pairs from explicit
      // intent. Skip if hub's destination wasn't built (e.g. hub
      // candidate got rejected, edge cases).
      var absorbtions = [];
      var _alreadyAbsorbedSrcIds = {};
      trip.destinations.forEach(function(src){
        if (!src) return;
        var srcCand = candByPlace[_norm(src.place)];
        if (!srcCand) return;
        if (srcCand.intent !== "dayTrip") return;
        if (!srcCand.dayTripHub) return;
        var hubCand = _pickerCands.find(function(o){ return o && o.id === srcCand.dayTripHub; });
        if (!hubCand) return;
        var hub = trip.destinations.find(function(d){ return d && _norm(d.place) === _norm(hubCand.place); });
        if (!hub || hub === src) return;
        if (_alreadyAbsorbedSrcIds[src.id]) return;
        _alreadyAbsorbedSrcIds[src.id] = true;
        // distKm not strictly needed here (user chose), but we record
        // it so the dayTrip chip carries the same shape as before.
        var srcCoord = (typeof src.lat === "number" && typeof src.lng === "number") ? [src.lat, src.lng] : null;
        var hubCoord = (typeof hub.lat === "number" && typeof hub.lng === "number") ? [hub.lat, hub.lng] : null;
        var dKm = 0;
        if (srcCoord && hubCoord) {
          var dLat = (srcCoord[0] - hubCoord[0]) * 111;
          var dLng = (srcCoord[1] - hubCoord[1]) * 111 * Math.cos(((srcCoord[0] + hubCoord[0]) / 2) * Math.PI / 180);
          dKm = Math.sqrt(dLat*dLat + dLng*dLng);
        }
        absorbtions.push({ src: src, hub: hub, distKm: dKm });
      });
      if (!absorbtions.length) return;
      console.log("[Max day-trip cluster v359.24] user-intent absorbtions:", absorbtions.map(function(a){
        return a.src.place + " → " + a.hub.place + " (" + Math.round(a.distKm) + "km)";
      }).join("; "));
      // v359.45 Phase 1 (hard cut): write PlanItems with type:dayTrip,
      // not dest.dayTrips chips. The PlanItem lands on the hub's
      // day[0]; the Place is created in trip.places{}. Night-rollup
      // semantics (Round DA) unchanged — absorbed nights still merge
      // into the hub's total.
      if (!trip.places || typeof trip.places !== 'object') trip.places = {};
      absorbtions.forEach(function(a){
        // Ensure the hub destination has a placeId + days
        if (!a.hub.placeId) {
          a.hub.placeId = _ensurePlace(trip, {
            place: a.hub.place, country: a.hub.country,
            lat: a.hub.lat, lng: a.hub.lng, type: 'city'
          });
        }
        if (!Array.isArray(a.hub.days) || a.hub.days.length === 0) {
          a.hub.days = _buildDaysShim(a.hub);
        }
        var day0 = a.hub.days[0];
        if (!day0) return;
        if (!Array.isArray(day0.planItems)) day0.planItems = [];

        // Place entry for the absorbed destination
        var srcPlaceId = _ensurePlace(trip, {
          place: a.src.place, country: a.src.country,
          lat: a.src.lat, lng: a.src.lng, type: 'sight'
        });

        // Idempotency: skip if PlanItem already exists
        var existing = day0.planItems.find(function(pi){
          return pi && pi.type === 'dayTrip' && pi.placeId === srcPlaceId;
        });
        if (existing) {
          // Still roll nights up — caller expectation
          a.hub.nights = (a.hub.nights || 0) + (a.src.nights || 1);
          return;
        }

        day0.planItems.push({
          id: 'pi-dt-' + (a.hub.id || a.hub.placeId) + '-' + srcPlaceId,
          type: 'dayTrip',
          state: 'suggestion',
          placeId: srcPlaceId,
          notes: a.src.intent || '',
          source: 'auto-cluster',
          legacy: {
            sourceNights: a.src.nights || 1,
            absorbedFromHub: a.hub.place,
            distKm: Math.round(a.distKm),
            clusteredAt: new Date().toISOString(),
            attachedEvents: (a.src.attachedEvents || []).slice()
          }
        });

        // Roll absorbed nights into hub (Round DA semantics).
        a.hub.nights = (a.hub.nights || 0) + (a.src.nights || 1);
      });
      // Remove absorbed sources, recompute dates trip-wide.
      var absorbedIds = {};
      absorbtions.forEach(function(a){ absorbedIds[a.src.id] = true; });
      trip.destinations = trip.destinations.filter(function(d){ return !absorbedIds[d.id]; });
      var curDate = new Date(startDate);
      trip.destinations.forEach(function(d){
        var dateFrom = curDate.toISOString().slice(0,10);
        var next = new Date(curDate); next.setDate(next.getDate() + (d.nights || 0));
        var dateTo = next.toISOString().slice(0,10);
        d.dateFrom = dateFrom;
        d.dateTo = dateTo;
        var savedItemsByIdx = (Array.isArray(d.days) ? d.days : []).map(function(day){
          return Array.isArray(day && day.items) ? day.items.slice() : [];
        });
        d.days = makeDays(d.id, d.place, d.place, dateFrom, d.nights || 0);
        if (savedItemsByIdx.length && d.days.length) {
          var lastNew = d.days.length - 1;
          savedItemsByIdx.forEach(function(items, oldIdx){
            if (!items || !items.length) return;
            var targetIdx = Math.min(oldIdx, lastNew);
            var targetDay = d.days[targetIdx];
            if (!targetDay) return;
            if (!Array.isArray(targetDay.items)) targetDay.items = [];
            var existing = {};
            targetDay.items.forEach(function(it){ if (it && it.n) existing[it.n.toLowerCase()] = true; });
            items.forEach(function(it){
              if (!it) return;
              if (it.type === "transport" || it.type === "transit") return;
              var k = (it.n || "").toLowerCase();
              if (k && existing[k]) return;
              targetDay.items.push(it);
              if (k) existing[k] = true;
            });
          });
        }
        curDate = next;
      });
      // Early-return so the legacy heuristic code below never runs.
      return;
      function getCoord(d){
        if (typeof d.lat === "number" && typeof d.lng === "number") return [d.lat, d.lng];
        if (typeof getCityCenter === "function") {
          var ctr = getCityCenter(d.place);
          if (ctr && isFinite(ctr[0]) && isFinite(ctr[1])) return ctr;
        }
        return null;
      }
      function distKm(a, b){
        if (!a || !b) return Infinity;
        // Equirectangular approximation — fine at this scale (Europe-sized trips)
        var dLat = (a[0] - b[0]) * 111;
        var dLng = (a[1] - b[1]) * 111 * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
        return Math.sqrt(dLat*dLat + dLng*dLng);
      }
      var DAY_TRIP_RADIUS_KM = 60;
      // Find candidates to absorb. Don't iterate while mutating; collect
      // (source, hub) pairs first, then apply.
      var absorbtions = [];
      for (var i = 0; i < trip.destinations.length; i++) {
        var src = trip.destinations[i];
        if (!src || src.nights > 2) continue; // only short stays are candidates
        if (i === 0 || i === trip.destinations.length - 1) continue;
        // Find the closest other destination with strictly more nights
        // (so 2-night → 3+ hub absorbs, but 2 → 2 doesn't)
        var srcCoord = getCoord(src);
        if (!srcCoord) continue;
        var bestHub = null;
        var bestDist = Infinity;
        for (var j = 0; j < trip.destinations.length; j++) {
          if (j === i) continue;
          var h = trip.destinations[j];
          if (!h || h.nights <= src.nights) continue;
          var hubCoord = getCoord(h);
          if (!hubCoord) continue;
          var d = distKm(srcCoord, hubCoord);
          if (d < bestDist) { bestDist = d; bestHub = h; }
        }
        if (bestHub && bestDist <= DAY_TRIP_RADIUS_KM) {
          absorbtions.push({src: src, hub: bestHub, distKm: bestDist});
        }
      }
      if (!absorbtions.length) return;
      // Apply absorbtions. Build day-trip records and attach to hubs;
      // remove sources from trip.destinations.
      // Round DA: roll the absorbed source's nights INTO the hub's nights
      // so the trip total matches what the user picked. Without this, a
      // 4-night Zermatt + 1-night Bettmeralp picker estimate would build
      // as a 4-night trip (Bettmeralp's 1 night vanishes into the day-trip
      // chip with no calendar slot). With this, Zermatt becomes 5 nights
      // and the day-trip chip is just a discovery marker. sourceNights is
      // still preserved on the day-trip record so restoration can
      // subtract them back if the user "Restores as own destination".
      //
      // Round EA: make clustering idempotent on rebuild. If the hub
      // already has a day-trip chip for the source place (from a prior
      // build's clustering), the absorption is already done — don't add
      // a duplicate chip, don't roll nights up a second time. Just drop
      // the source from trip.destinations, since the existing chip
      // already represents it. Without this, a Schaffhausen chip from
      // build #1 + a fresh Schaffhausen candidate on rebuild produces
      // TWO chips and adds the nights twice (Neal's "Zurich went from 3
      // to 6 nights, Schaffhausen appears twice" symptom).
      absorbtions.forEach(function(a){
        if (!a.hub.dayTrips) a.hub.dayTrips = [];
        var srcKey = (typeof _normPlaceName === "function")
          ? _normPlaceName(a.src.place || "")
          : (a.src.place || "").toLowerCase();
        var alreadyChip = a.hub.dayTrips.some(function(dt){
          if (!dt || !dt.place) return false;
          var dtKey = (typeof _normPlaceName === "function")
            ? _normPlaceName(dt.place)
            : (dt.place || "").toLowerCase();
          return dtKey === srcKey;
        });
        if (alreadyChip) {
          // Idempotent path: chip already represents this absorption.
          // The source dest will still be filtered out of
          // trip.destinations below, so we don't double-count it.
          return;
        }
        a.hub.dayTrips.push({
          place: a.src.place,
          country: a.src.country || "",
          lat: (typeof a.src.lat === "number") ? a.src.lat : (getCityCenter(a.src.place) || [null,null])[0],
          lng: (typeof a.src.lng === "number") ? a.src.lng : (getCityCenter(a.src.place) || [null,null])[1],
          whyItFits: a.src.intent || "",
          attachedEvents: (a.src.attachedEvents || []).slice(),
          // Preserve the actual source nights so ungroup restores faithfully
          sourceNights: a.src.nights || 1,
          absorbedFromHub: a.hub.place,
          distKm: Math.round(a.distKm),
          clusteredAt: new Date().toISOString()
        });
        // Round ES: roll absorbed nights into hub (Round DA semantics).
        // The traveler is still "at" the hub for N+chip nights total;
        // the chip is just a daytime visit during that stay.
        a.hub.nights = (a.hub.nights || 0) + (a.src.nights || 1);
      });
      // Remove sources and recompute dates from the surviving destinations.
      var absorbedIds = {};
      absorbtions.forEach(function(a){ absorbedIds[a.src.id] = true; });
      trip.destinations = trip.destinations.filter(function(d){ return !absorbedIds[d.id]; });
      // Recompute dates: cur runs forward from the original start.
      // Round DV.2: preserve day items across the makeDays regeneration.
      // Capture each surviving destination's existing items, rebuild days
      // with the new date range, then dump items back in by old index
      // (clamped to last day if the count shrank). Without this, the
      // user's restored sights from Round DS got nuked here.
      var curDate = new Date(startDate);
      trip.destinations.forEach(function(d){
        var dateFrom = curDate.toISOString().slice(0,10);
        var next = new Date(curDate); next.setDate(next.getDate() + (d.nights || 0));
        var dateTo = next.toISOString().slice(0,10);
        d.dateFrom = dateFrom;
        d.dateTo = dateTo;
        // Capture existing day items per old index before we rebuild the days.
        var savedItemsByIdx = (Array.isArray(d.days) ? d.days : []).map(function(day){
          return Array.isArray(day && day.items) ? day.items.slice() : [];
        });
        d.days = makeDays(d.id, d.place, d.place, dateFrom, d.nights || 0);
        if (savedItemsByIdx.length && d.days.length) {
          var lastNew = d.days.length - 1;
          savedItemsByIdx.forEach(function(items, oldIdx){
            if (!items || !items.length) return;
            var targetIdx = Math.min(oldIdx, lastNew);
            var targetDay = d.days[targetIdx];
            if (!targetDay) return;
            if (!Array.isArray(targetDay.items)) targetDay.items = [];
            // De-dup by name in case makeDays seeded anything (it doesn't,
            // but defensive).
            var existing = {};
            targetDay.items.forEach(function(it){ if (it && it.n) existing[it.n.toLowerCase()] = true; });
            items.forEach(function(it){
              if (!it) return;
              if (it.type === "transport" || it.type === "transit") return;
              var k = (it.n || "").toLowerCase();
              if (k && existing[k]) return;
              targetDay.items.push(it);
              if (k) existing[k] = true;
            });
          });
        }
        curDate = next;
      });
      // Log so the user (and console) can see what happened.
      var summary = absorbtions.map(function(a){ return a.src.place + " → day trip from " + a.hub.place + " (" + Math.round(a.distKm) + "km)"; }).join("; ");
      console.log("[Max day-trip cluster] absorbed " + absorbtions.length + ": " + summary);

      // Round ER: full-disclosure notice. Day-trip clustering changes
      // the trip without asking — the user picked Schaffhausen for 1
      // night, then the build silently turned it into a chip on Zurich
      // and dropped that night from the calendar. Stash a record of
      // every absorption so the trip view can render a banner showing
      // exactly what got reclassified.
      if (absorbtions.length) {
        trip.clusterNotice = {
          absorbtions: absorbtions.map(function(a){
            return {
              src: a.src.place,
              hub: a.hub.place,
              sourceNights: a.src.nights || 1,
              distKm: Math.round(a.distKm)
            };
          }),
          ts: new Date().toISOString()
        };
      } else {
        delete trip.clusterNotice;
      }
    })();

    // ── v355.7: user-driven day-trip absorption ───────────────
    // The picker collects explicit day-trip choices via the pin
    // popup and sidebar chips (place-picker hero map, Step 6/7),
    // stored as _isDayTrip + _dayTripHub on
    // _tb.placeActivities[*].requiredPlaces[*]. The previous round
    // wired this through to the LLM as a soft hint (Step 8's
    // dayTripNote in the candidate-generation prompt), but the
    // hard guarantee — the place actually lands as a chip on the
    // hub destination's dayTrips, not as a standalone destination —
    // was missing. This pass enforces the user's choice
    // deterministically after _reconcileDestinations has produced
    // trip.destinations from the kept candidates.
    //
    // Mirrors the disabled _autoClusterDayTrips structure (chip
    // shape, hub.nights += src.nights, dest.dayTrips push, source
    // filtered from trip.destinations, dates recomputed). Diff from
    // the auto path: no distance / nights heuristics — the user
    // already decided. Idempotent on rebuild via the existing-chip
    // check that mirrors Round EA.
    (function _applyUserDayTripChoices(){
      // v355.7-debug: noisy console traces gated behind a single tag
      // so they're easy to grep in dev tools and easy to strip later.
      // The day-trip absorption pass has multiple silent early-return
      // paths; without these logs, "day trips don't persist" is hard
      // to diagnose without instrumenting locally.
      var DBG = "[Max picker→trip day-trip]";
      if (!Array.isArray(trip.destinations) || !trip.destinations.length) {
        console.log(DBG, "skip: no destinations on the built trip");
        return;
      }
      if (!_tb) {
        console.log(DBG, "skip: _tb missing at publishTrip");
        return;
      }
      var paLen = Array.isArray(_tb.placeActivities) ? _tb.placeActivities.length : "(not-array)";
      console.log(DBG, "_tb.placeActivities length:", paLen);
      // Surface raw flag presence so we can see if the picker actually
      // landed any _isDayTrip / _dayTripHub on requiredPlaces.
      var rawFlagged = [];
      (Array.isArray(_tb.placeActivities) ? _tb.placeActivities : []).forEach(function(item){
        (item && item.requiredPlaces || []).forEach(function(p){
          if (p && p._isDayTrip) {
            rawFlagged.push((p.place || "?") + " → " + (p._dayTripHub || "(no hub)"));
          }
        });
      });
      console.log(DBG, "raw _isDayTrip flags found:", rawFlagged.length, rawFlagged);
      // Pair extraction is the testable piece — see
      // collectUserDayTripPairs above. Returns {sourceKey: hubKey},
      // both normalized via _normPlaceName so we can match against
      // destinations directly below.
      var pairs = collectUserDayTripPairs(_tb.placeActivities);
      var srcKeys = Object.keys(pairs);
      console.log(DBG, "normalized pairs:", pairs);
      console.log(DBG, "trip.destinations places (normalized):",
        trip.destinations.map(function(d){ return _normPlaceName(d.place || "") + " [" + (d.place || "") + "]"; }));
      if (!srcKeys.length) {
        console.log(DBG, "skip: no pairs to apply (collectUserDayTripPairs returned {})");
        return;
      }
      // Locate the corresponding destinations. Prefer exact normalized
      // match; fall back to bidirectional substring match the way
      // _findMatchingRequired does (covers cases like the LLM
      // returning "Vík í Mýrdal" when the picker has "Vík", or vice
      // versa). v355.8.
      function findDest(key){
        if (!key) return null;
        var exact = null;
        var substringMatch = null;
        for (var i = 0; i < trip.destinations.length; i++) {
          var d = trip.destinations[i];
          if (!d || !d.place) continue;
          var dN = _normPlaceName(d.place);
          if (dN === key) { exact = d; break; }
          if (!substringMatch && (dN.indexOf(key) >= 0 || key.indexOf(dN) >= 0)) {
            substringMatch = d;
          }
        }
        return exact || substringMatch;
      }
      var absorbtions = [];
      srcKeys.forEach(function(srcKey){
        var hubKey = pairs[srcKey];
        if (!hubKey || hubKey === srcKey) return;
        var src = findDest(srcKey);
        var hub = findDest(hubKey);
        if (!src) {
          console.log(DBG, "no destination matches source", srcKey, "— picker flagged a day trip but the LLM didn't make it a candidate");
          return;
        }
        if (!hub) {
          console.log(DBG, "no destination matches hub", hubKey, "for source", srcKey);
          return;
        }
        if (src === hub) return;
        // Don't absorb into a destination that itself is being absorbed —
        // would create an orphan chip.
        if (pairs[hubKey] && pairs[hubKey] !== hubKey) {
          console.log(DBG, "skipping", srcKey, "— hub", hubKey, "is itself being absorbed");
          return;
        }
        absorbtions.push({ src: src, hub: hub });
      });
      if (!absorbtions.length) {
        console.log(DBG, "no absorbtions matched destinations after pair lookup");
        return;
      }
      console.log(DBG, "applying", absorbtions.length, "absorbtions:",
        absorbtions.map(function(a){ return a.src.place + " → " + a.hub.place; }));
      // v359.45 Phase 1 (hard cut): write PlanItems on the hub's
      // day[0] instead of dest.dayTrips chips. Mirrors the auto-cluster
      // path above; the difference is source='user-cluster' to mark
      // picker-driven (vs auto-cluster).
      if (!trip.places || typeof trip.places !== 'object') trip.places = {};
      absorbtions.forEach(function(a){
        // Ensure hub has placeId + days
        if (!a.hub.placeId) {
          a.hub.placeId = _ensurePlace(trip, {
            place: a.hub.place, country: a.hub.country,
            lat: a.hub.lat, lng: a.hub.lng, type: 'city'
          });
        }
        if (!Array.isArray(a.hub.days) || a.hub.days.length === 0) {
          a.hub.days = _buildDaysShim(a.hub);
        }
        var day0 = a.hub.days[0];
        if (!day0) {
          // Even without a day to land on, still roll nights up so the
          // calendar accounting matches what users saw.
          a.hub.nights = (a.hub.nights || 0) + (a.src.nights || 1);
          return;
        }
        if (!Array.isArray(day0.planItems)) day0.planItems = [];

        // Place entry for absorbed source
        var srcLat = (typeof a.src.lat === "number") ? a.src.lat
                    : (typeof getCityCenter === "function" ? (getCityCenter(a.src.place) || [null, null])[0] : null);
        var srcLng = (typeof a.src.lng === "number") ? a.src.lng
                    : (typeof getCityCenter === "function" ? (getCityCenter(a.src.place) || [null, null])[1] : null);
        var srcPlaceId = _ensurePlace(trip, {
          place: a.src.place, country: a.src.country,
          lat: srcLat, lng: srcLng, type: 'sight'
        });

        // Idempotency
        var existing = day0.planItems.find(function(pi){
          return pi && pi.type === 'dayTrip' && pi.placeId === srcPlaceId;
        });
        if (existing) {
          a.hub.nights = (a.hub.nights || 0) + (a.src.nights || 1);
          return;
        }

        day0.planItems.push({
          id: 'pi-dt-' + (a.hub.id || a.hub.placeId) + '-' + srcPlaceId,
          type: 'dayTrip',
          state: 'suggestion',
          placeId: srcPlaceId,
          notes: a.src.intent || '',
          source: 'user-cluster',
          legacy: {
            sourceNights: a.src.nights || 1,
            absorbedFromHub: a.hub.place,
            userChosen: true,
            clusteredAt: new Date().toISOString(),
            attachedEvents: (a.src.attachedEvents || []).slice()
          }
        });

        // Roll absorbed nights into hub (Round DA semantics)
        a.hub.nights = (a.hub.nights || 0) + (a.src.nights || 1);
      });
      // Remove absorbed sources and recompute dates trip-wide.
      var absorbedIds = {};
      absorbtions.forEach(function(a){ absorbedIds[a.src.id] = true; });
      trip.destinations = trip.destinations.filter(function(d){ return !absorbedIds[d.id]; });
      // Recompute dates from the original startDate. Mirrors the
      // auto-cluster's date-recompute block: rebuild days with the
      // new range, replay items by clamped index so the user's
      // sights/restaurants survive the night-rollup.
      var curDate = new Date(startDate);
      trip.destinations.forEach(function(d){
        var dateFrom = curDate.toISOString().slice(0, 10);
        var next = new Date(curDate); next.setDate(next.getDate() + (d.nights || 0));
        var dateTo = next.toISOString().slice(0, 10);
        d.dateFrom = dateFrom;
        d.dateTo = dateTo;
        var savedItemsByIdx = (Array.isArray(d.days) ? d.days : []).map(function(day){
          return Array.isArray(day && day.items) ? day.items.slice() : [];
        });
        if (typeof makeDays === "function") {
          d.days = makeDays(d.id, d.place, d.place, dateFrom, d.nights || 0);
          if (savedItemsByIdx.length && d.days.length) {
            var lastNew = d.days.length - 1;
            savedItemsByIdx.forEach(function(items, oldIdx){
              if (!items || !items.length) return;
              var targetIdx = Math.min(oldIdx, lastNew);
              var targetDay = d.days[targetIdx];
              if (!targetDay) return;
              if (!Array.isArray(targetDay.items)) targetDay.items = [];
              var existing = {};
              targetDay.items.forEach(function(it){ if (it && it.n) existing[it.n.toLowerCase()] = true; });
              items.forEach(function(it){
                if (!it) return;
                if (it.type === "transport" || it.type === "transit") return;
                var k = (it.n || "").toLowerCase();
                if (k && existing[k]) return;
                targetDay.items.push(it);
                if (k) existing[k] = true;
              });
            });
          }
        }
        curDate = next;
      });
      var summary = absorbtions.map(function(a){ return a.src.place + " → day trip from " + a.hub.place; }).join("; ");
      console.log("[Max] picker day-trip choices applied (" + absorbtions.length + "): " + summary);
    })();

    // Pre-generate city data for all new destinations, throttled 3-at-a-time.
    // Fire-and-forget — the plan opens immediately and cards light up as data arrives.
    (function throttledGenerate(dests,limit){
      var queue=dests.slice(), inFlight=0;
      function pump(){
        while(inFlight<limit && queue.length){
          var d=queue.shift();
          inFlight++;
          // Round HT: prefer injected service, fall back to global.
          // The inline script registers 'city-data' on boot. Tests can
          // inject a no-op or a stub instead of touching the network.
          var cityDataFn = pickerGetService('city-data') || global.generateCityData;
          Promise.resolve()
            .then(function(){
              if (typeof cityDataFn !== 'function') return null;
              return cityDataFn(d.place, d.id);
            })
            .catch(function(){/* city-data service handles its own errors */})
            .then(function(){inFlight--;pump();});
        }
      }
      pump();
    })(trip.destinations.slice(-kept.length),3);

    // Round EG: re-run iconic auto-seed for every destination that
    // already has suggestions but no items placed on any day. Auto-seed
    // (Round S/DB) lives inside generateCityData's success callback, so
    // for destinations that were preserved by reconcile and whose data
    // is already cached, generateCityData early-returns and auto-seed
    // never fires. Symptom: Neal opens Zurich, Explore is full of
    // sights, Itinerary is empty. The function's own existing-names
    // guard makes this idempotent — destinations with items already on
    // days won't get duplicates.
    if (typeof _autoSeedIconicSightsToDays === "function") {
      trip.destinations.forEach(function(d){
        if (!d || !Array.isArray(d.suggestions) || !d.suggestions.length) return;
        _autoSeedIconicSightsToDays(d);
      });
    }

    // Round DW: snapshot mechanism is gone, but defensively clear any
    // stale flag that might be lingering from older code paths.
    if (_tb && _tb._editPreservedByPlace) delete _tb._editPreservedByPlace;

    // Round CE: night-count diff between picker and trip. Compare
    // picker's DISPLAY total (base + buffer) vs trip's actual total.
    // Round CT.1: previously had to subtract absorbed-day-trip nights to
    // get totals to match, because Round CO dropped them from the
    // calendar.
    // Round DA: absorbed nights are now ROLLED INTO the hub's nights, so
    // the trip total should equal the picker total directly with no
    // adjustment. The mismatch report still excludes the absorbed places
    // from per-place comparison (they expectedly disappear from the trip
    // and their nights show up under their hub instead).
    // Round EE: always-on per-rebuild diagnostic. Print a table of every
    // destination with picker nights vs trip nights vs absorbed-into-hub
    // chips. When something goes wrong (e.g. nights showing up where they
    // shouldn't), this trace pinpoints the layer responsible (picker vs
    // candidate vs reconcile vs clustering).
    console.group("[Max rebuild] " + (isRebuild ? "REBUILD" : "FRESH BUILD") + " — " + new Date().toLocaleTimeString());
    try {
      var _diagRows = trip.destinations.map(function(d, i){
        var pkn = (_tb._pickerNightsByPlace && _tb._pickerNightsByPlace[(typeof _normPlaceName === "function" ? _normPlaceName(d.place) : (d.place||"").toLowerCase())]);
        return {
          idx: i, id: d.id, place: d.place,
          pickerNights: (pkn != null ? pkn : "—"),
          destNights: d.nights,
          dateFrom: d.dateFrom, dateTo: d.dateTo,
          chips: (d.dayTrips||[]).map(function(dt){return dt.place + "(" + (dt.sourceNights||1) + "n)";}).join(", ") || "—"
        };
      });
      console.table(_diagRows);
      var _candDump = (_tb.candidates||[]).filter(function(c){return c.status==="keep";}).map(function(c){
        return { place: c.place, candidateNights: c.nights, status: c.status };
      });
      console.log("Kept candidates:");
      console.table(_candDump);
      console.log("pickedNightsByPlace:", JSON.stringify(_tb._pickerNightsByPlace||{}));
      console.log("orderedTotalNights:", (typeof ordered !== "undefined" ? ordered.reduce(function(s,c){return s+(c.nights||0);},0) : "n/a"));
      console.log("tripDestTotalNights:", trip.destinations.reduce(function(s,d){return s+(d.nights||0);},0));
    } catch(e){ console.warn("[Max rebuild] diagnostic failed:", e); }
    console.groupEnd();

    if (_tb && _tb._pickerNightsByPlace) {
      var tripByPlace = {};
      var absorbedByHub = {}; // hubKey → [absorbedKeys]
      trip.destinations.forEach(function(d){
        var k = (typeof _normPlaceName === "function") ? _normPlaceName(d.place) : (d.place||"").toLowerCase();
        tripByPlace[k] = (tripByPlace[k] || 0) + (d.nights || 0);
        // Track day-trips absorbed into this destination
        if (d.dayTrips && d.dayTrips.length) {
          d.dayTrips.forEach(function(dt){
            var dtK = (typeof _normPlaceName === "function") ? _normPlaceName(dt.place) : (dt.place||"").toLowerCase();
            if (!absorbedByHub[k]) absorbedByHub[k] = [];
            absorbedByHub[k].push({key: dtK, nights: dt.sourceNights || 1});
          });
        }
      });
      var pickerDisplay = _tb._pickerDisplayTotal || 0;
      var pickerBufferAdds = _tb._pickerBufferAdds || 0;
      var tripTotal = trip.destinations.reduce(function(s,d){return s+(d.nights||0);}, 0);
      var absorbedTotal = 0;
      Object.keys(absorbedByHub).forEach(function(hub){
        absorbedByHub[hub].forEach(function(a){ absorbedTotal += a.nights; });
      });
      var totalsMatch = pickerDisplay === tripTotal;
      if (totalsMatch) {
        var msg = "[Max night-diff] OK — picker " + pickerDisplay + " (base " + (pickerDisplay - pickerBufferAdds) + " + buffer " + pickerBufferAdds + ") = trip " + tripTotal;
        if (absorbedTotal > 0) msg += " (incl. " + absorbedTotal + " absorbed-day-trip night(s) folded into hubs)";
        console.log(msg);
      } else {
        // Real mismatch. Build a per-place report. Absorbed places are
        // expected to be missing from trip (their nights moved to the hub).
        var absorbedSet = {};
        Object.keys(absorbedByHub).forEach(function(hub){
          absorbedByHub[hub].forEach(function(a){ absorbedSet[a.key] = true; });
        });
        var mismatches = [];
        Object.keys(_tb._pickerNightsByPlace).forEach(function(k){
          if (absorbedSet[k]) return; // expected to be missing
          var pN = _tb._pickerNightsByPlace[k];
          var tN = tripByPlace[k] || 0;
          // For hubs with absorbed day-trips, expect tN = pN + absorbed nights
          var expected = pN;
          if (absorbedByHub[k]) {
            absorbedByHub[k].forEach(function(a){ expected += a.nights; });
          }
          if (expected !== tN) mismatches.push({place:k, picker:pN, trip:tN, diff:tN-expected, note: tN===0 ? "missing from trip" : ""});
        });
        Object.keys(tripByPlace).forEach(function(k){
          if (!(k in _tb._pickerNightsByPlace)) {
            mismatches.push({place:k+" (trip only)", picker:0, trip:tripByPlace[k], diff:tripByPlace[k], note: "in trip but not picker"});
          }
        });
        console.warn("[Max night-diff] MISMATCH — picker " + pickerDisplay + " (base " + (pickerDisplay - pickerBufferAdds) + " + buffer " + pickerBufferAdds + ") vs trip " + tripTotal + " — diff " + (tripTotal - pickerDisplay));
        console.table(mismatches);
      }
    }

    // Snapshot the full candidate list (kept + rejected) onto the trip so the user
    // can re-open the Candidate Explorer later and change their decisions.
    // CRITICAL: include `nights` (Round CG.2). Without it, subsequent rebuilds
    // (Edit destinations, change arrival/departure on trip view) lose the
    // picker's per-place night counts and fall back to LLM stayRange, which
    // makes the trip's day count balloon by ~5 nights per rebuild.
    trip.candidates = (_tb.candidates||[]).map(function(c){
      return {
        id:c.id, place:c.place, country:c.country||null, role:c.role||null,
        whyItFits:c.whyItFits||"", tags:c.tags||[], tradeoffs:c.tradeoffs||null,
        stayRange:c.stayRange||"", lat:c.lat||null, lng:c.lng||null,
        nights: (typeof c.nights === "number") ? c.nights : undefined,
        status:c.status||null, _required:!!c._required, _requiredFor:(c._requiredFor||[]).slice(),
        // v359.24: preserve user's role decision so re-opens of the
        // picker (Edit destinations) rehydrate the intent/hub the user
        // set, instead of falling back to the auto-suggestion.
        intent: c.intent || undefined,
        dayTripHub: c.dayTripHub || undefined
      };
    });
    trip.requiredPlaces = (_tb.requiredPlaces||[]).slice();
    // Persist the trip-brief fields the Explorer needs to rehydrate
    if (trip.brief) {
      trip.brief.duration = _tb.duration || trip.brief.duration || "";
      trip.brief.entry = _tb.entry || trip.brief.entry || "";
      trip.brief.tbExit = _tb.tbExit || trip.brief.tbExit || "";
      trip.brief.exitBuffer = !!_tb.exitBuffer;
      // Round FY: persist entryBuffer alongside exitBuffer.
      trip.brief.entryBuffer = (_tb.entryBuffer === false) ? false : true;
      // Round CK.1.3: propagate logistics captured in the picker (_tb.entryDetails
      // / _tb.exitDetails) into trip.brief on first build. The trip view's
      // panel writes directly to trip.brief.entryDetails on edit, so that path
      // overwrites — but the picker captures earlier, before trip.brief exists.
      if (_tb.entryDetails) trip.brief.entryDetails = Object.assign({}, trip.brief.entryDetails || {}, _tb.entryDetails);
      if (_tb.exitDetails) trip.brief.exitDetails = Object.assign({}, trip.brief.exitDetails || {}, _tb.exitDetails);
    }

    // Don't re-sort — ordering was already computed event-aware. Use
    // trip.name (resolved to placeName/region above) so the home
    // screen's trip list shows "Switzerland" instead of "Untitled —
    // May 1, 2026".
    // Round EI: idempotent index update. If an entry already exists for
    // this tripId (i.e. this is a rebuild of an existing trip),
    // overwrite its fields in place. Without this, every rebuild
    // appended a duplicate entry, and the home screen's delete-trip
    // filter (`t.id !== id`) would remove ALL duplicate entries — and
    // if any of those duplicates somehow shared an id with a different
    // trip (rebuild race, _currentTripId carryover), deleting one
    // would also wipe the other. Self-heals existing duplicate-laden
    // indexes by deduping when the user does any rebuild.
    var _existingIdx = _tripsIndex.findIndex ? _tripsIndex.findIndex(function(t){return t && t.id === tripId;}) : -1;
    if (_existingIdx === -1) {
      // Some older browsers / older index entries: linear scan fallback.
      for (var _ei = 0; _ei < _tripsIndex.length; _ei++) {
        if (_tripsIndex[_ei] && _tripsIndex[_ei].id === tripId) { _existingIdx = _ei; break; }
      }
    }
    // Also dedupe any extra duplicates beyond the first match (defensive
    // self-heal for indexes that have already accumulated dupes).
    _tripsIndex = _tripsIndex.filter(function(t, i){
      if (!t || t.id !== tripId) return true;
      return i === _existingIdx;
    });
    if (_existingIdx >= 0 && _tripsIndex[_existingIdx]) {
      _tripsIndex[_existingIdx].name = trip.name;
      _tripsIndex[_existingIdx].destCount = kept.length;
      _tripsIndex[_existingIdx].dateRange = "";
      _tripsIndex[_existingIdx].savedAt = new Date().toISOString();
    } else {
      _tripsIndex.push({id:tripId,name:trip.name,destCount:kept.length,dateRange:"",savedAt:new Date().toISOString()});
    }
    // Round HP: persist through the documented DB API instead of the
    // inline-script localSave wrapper. MaxDB.trip.writeRaw takes a
    // pre-serialized JSON string (matches what serializeTrip produces
    // — the existing envelope shape: trip + activeDest + counters +
    // activeDmSection). MaxDB also fires 'tripWritten' so subscribers
    // can react. The trips index update goes through MaxDB.index.save
    // for the same reason.
    if (global.MaxDB && global.MaxDB.trip && global.MaxDB.trip.writeRaw) {
      global.MaxDB.trip.writeRaw(tripId, global.serializeTrip());
    } else if (typeof localSave === "function") {
      localSave();
    }
    if (global.MaxDB && global.MaxDB.index && global.MaxDB.index.save) {
      global.MaxDB.index.save(_tripsIndex);
    } else if (typeof saveTripsIndex === "function") {
      saveTripsIndex();
    }
    // Round HN: the picker engine no longer touches DOM directly.
    // Emit 'published' and let the inline-script UI subscriber handle
    // the picker-overlay close, picker-map disposal, fresh-build
    // bridge animation, and trip-view render. Round CJ's "skip
    // bridge on rebuild" rule is preserved — it's now a branch in
    // the subscriber based on the isRebuild flag in the payload.
    var _hnIsRebuild = !!(_tb && _tb._isRebuild);
    if (_tb) _tb._isRebuild = false; // consume the flag
    pickerEmit('published', { tripId: tripId, isRebuild: _hnIsRebuild });
  }

  // ── deriveUserReasons (Round SCAFFOLD-1.5) ────────────────
  // The picker leads with a user-reason section that echoes the
  // traveler's stated draw to the place ("Why this place? What's
  // drawing you?"). This helper takes their placeContext + the
  // candidates Max found, and asks the LLM for 1–3 short categories
  // that build on the traveler's words while pointing at which
  // candidates fit each one. Candidates can sit in multiple
  // categories (riding the Bernina Express fits both "The grandeur
  // of the Alps" the traveler mentioned AND "Scenic travel" Max
  // organizes under).
  //
  // Cached on _tb._userReasonsCache by a hash of (placeContext,
  // region, candidate count) so the LLM only re-prompts when
  // something meaningful changes.
  //
  // Returns: [{name: string, members: [candId, ...]}, ...]
  // Returns []:
  //   * When placeContext is empty (nothing to build on).
  //   * When the LLM call fails (graceful fallback — picker still
  //     renders; just without the leading user-reason section).
  //   * When fewer than 2 candidates exist (no work to organize).

  function _userReasonsCacheKey(placeContext, region, candidateCount) {
    var ctx = String(placeContext || '').trim().toLowerCase();
    var reg = String(region || '').trim().toLowerCase();
    return ctx + '|' + reg + '|' + (candidateCount || 0);
  }

  async function deriveUserReasons(placeContext, candidates, mdcItems, region, options) {
    var ctx = String(placeContext || '').trim();
    if (!ctx) return [];
    options = options || {};
    // Generic items: each must have {id, label}. Optional: sublabel,
    // status (excluded if 'reject'). Both candidate-explorer (with
    // {id, place, country, role, status}) and place-mode picker
    // (with {id, name, requiredPlaces, type}) feed through this.
    var cands = (candidates || []).map(function (c) {
      if (!c || !c.id) return null;
      var label = c.label || c.place || c.name;
      if (!label) return null;
      var sublabel = c.sublabel || c.country
        || (Array.isArray(c.requiredPlaces) ? c.requiredPlaces.map(function(p){return p && p.place;}).filter(Boolean).join(', ') : '')
        || c.role || '';
      return { id: c.id, label: label, sublabel: sublabel, status: c.status };
    }).filter(function (c) {
      return c && c.status !== 'reject';
    });
    if (cands.length < 2) return [];

    // Cache hit → skip the LLM round-trip. Caller can override the
    // cache slot via options.cacheSlot to keep candidate-explorer
    // results separate from place-mode picker results.
    var cacheSlot = options.cacheSlot || '_userReasonsCache';
    var cacheKey = _userReasonsCacheKey(ctx, region, cands.length);
    var cache = (global._tb && global._tb[cacheSlot]) || null;
    if (cache && cache.key === cacheKey && Array.isArray(cache.value)) {
      return cache.value;
    }

    // Build a compact list for the prompt — id + label + sublabel.
    var candLines = cands.slice(0, 50).map(function (c) {
      var bits = [c.id, c.label];
      if (c.sublabel) bits.push(c.sublabel);
      return bits.join(' | ');
    }).join('\n');

    var prompt =
      "Region: " + (region || "this region") + "\n" +
      "The traveler told us why this place is drawing them — in their own words:\n" +
      '"' + ctx.replace(/"/g, '\\"') + '"\n\n' +
      "Candidates Max found (id | place | country | role):\n" +
      candLines + "\n\n" +
      "Identify 1–3 USER-SPECIFIC categories built on what the traveler said. Each category should:\n" +
      "  • Echo the traveler's framing — their words, their reason, the specific draw they named. NOT generic labels like 'Activities' or 'Scenic travel' (Max already groups by those separately).\n" +
      "  • Read as a short header (3–7 words). Examples for someone who said 'My grandmother grew up there. Want to see the Alps':\n" +
      "      — 'Family roots' / 'Where she would have known' / 'The grandeur she described'\n" +
      "      — 'The Alps you came for'\n" +
      "  • List 1–5 candidate IDs that fit. A candidate CAN appear in multiple categories — that's fine and intentional.\n" +
      "  • If the traveler's words don't suggest any additional framing beyond Max's standard categories, return an empty array — don't invent reasons.\n\n" +
      "Return ONLY a JSON array (no markdown):\n" +
      '[{"name":"category header","members":["candId1","candId2"]}]';

    try {
      if (typeof global.callMax !== 'function') return [];
      var text = await global.callMax([{role: 'user', content: prompt}], 800, 25000);
      var cleaned = String(text || '').replace(/```json|```/g, '').trim();
      var first = cleaned.indexOf('[');
      var last = cleaned.lastIndexOf(']');
      if (first < 0 || last < 0) return [];
      cleaned = cleaned.substring(first, last + 1);
      var parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];

      // Validate + scrub: each entry needs name + members[]; members
      // must be candidate ids that actually exist in the input.
      var validIds = {};
      cands.forEach(function (c) { validIds[c.id] = true; });
      var result = parsed.map(function (entry) {
        if (!entry || typeof entry.name !== 'string') return null;
        var name = entry.name.trim();
        if (!name) return null;
        var members = (entry.members || []).filter(function (id) {
          return typeof id === 'string' && validIds[id];
        });
        if (!members.length) return null;
        return { name: name, members: members };
      }).filter(Boolean);

      // Cache the result (even if empty after scrubbing — saves a
      // round-trip if the LLM keeps producing nothing useful).
      if (global._tb) {
        global._tb[cacheSlot] = { key: cacheKey, value: result };
      }
      return result;
    } catch (e) {
      // Graceful fallback. Picker renders without the user-reason
      // section; the rest of the page is unaffected.
      try { console.warn('[Max] deriveUserReasons failed:', (e && e.message) || e); } catch (_) {}
      return [];
    }
  }

  // ── buildDayTripNote (place-picker hero map: Step 8) ──────────
  // Derive a brief paragraph naming any places the user pre-flagged
  // as day trips on the place-picker. Returns "" when no flags are
  // set so the inline candidate-generation prompts keep their
  // pre-feature shape on the legacy path.
  //
  // Per Neal-confirmed decision (3): the note rides on the same
  // candidate-generation prompts the picker has been firing, so the
  // candidate explorer's built itinerary stays aligned with the
  // user's pre-LLM day-trip decisions.
  function buildDayTripNote(placeActivities) {
    if (!Array.isArray(placeActivities)) return "";
    var pairs = {}; // canonKey → hubKey
    var displayNames = {}; // canonKey → place display name
    placeActivities.forEach(function (it) {
      if (!it || !Array.isArray(it.requiredPlaces)) return;
      it.requiredPlaces.forEach(function (p) {
        if (!p || !p.place) return;
        var k = p.place.toLowerCase();
        displayNames[k] = displayNames[k] || p.place;
        if (p._isDayTrip === true) {
          if (!(k in pairs)) pairs[k] = p._dayTripHub || "";
        }
      });
    });
    var keys = Object.keys(pairs);
    if (!keys.length) return "";
    var parts = keys.map(function (k) {
      var hub = pairs[k];
      var hubName = hub ? (displayNames[hub] || hub) : "";
      var pName = displayNames[k] || k;
      return hubName ? (pName + " as a day trip from " + hubName) : (pName + " as a day trip");
    });
    return "\nUSER DAY-TRIP DECISIONS: The traveler has pre-flagged the following places as day trips on the picker, not stand-alone overnight stops. Treat them accordingly when shaping candidates and any narrative around lodging — " + parts.join("; ") + ".\n";
  }

  // ── collectUserDayTripPairs (place-picker hero map: Step 8b) ───
  // Walk _tb.placeActivities[*].requiredPlaces[*] and extract the
  // user's explicit day-trip designations as a {sourceKey: hubKey}
  // map. Both keys are canonicalized via _normPlaceName so callers
  // can match against destinations / candidates without re-normalizing.
  //
  // Used by publishTrip's _applyUserDayTripChoices pass to absorb
  // the user's choices into the built trip's destinations. Pure —
  // no side effects, no global reads beyond the helper itself.
  //
  // Behavior:
  //   * Same place appearing in multiple activities is deduped to
  //     the FIRST non-empty hub seen (stable across re-runs).
  //   * Self-referential entries (sourceKey === hubKey) are dropped
  //     as defensive — would create a no-op absorption.
  //   * Entries missing a place name OR a hub are skipped.
  //   * Entries with _isDayTrip but no _dayTripHub are skipped — no
  //     hub means there's nothing to absorb the place into.
  function collectUserDayTripPairs(placeActivities) {
    var pairs = {};
    if (!Array.isArray(placeActivities)) return pairs;
    placeActivities.forEach(function (item) {
      if (!item || !Array.isArray(item.requiredPlaces)) return;
      item.requiredPlaces.forEach(function (p) {
        if (!p || !p._isDayTrip || !p._dayTripHub || !p.place) return;
        var srcKey = _normPlaceName(p.place);
        if (!srcKey) return;
        if (srcKey in pairs) return; // dedupe to first hub seen
        var hubKey = _normPlaceName(p._dayTripHub);
        if (!hubKey || hubKey === srcKey) return;
        pairs[srcKey] = hubKey;
      });
    });
    return pairs;
  }

  // ── orderPlacePickerStays (place-picker hero map: Step 2) ──────
  // Order the kept "stay" places (kept && !_isDayTrip) for the
  // place-picker map's main route polyline. Simpler than
  // orderKeptCandidates: no route-block adjacency, no condition
  // bunching, no entry/exit anchoring (the place-picker doesn't
  // own the entry/exit yet — that's a candidate-explorer concern).
  //
  //   allPlaces   — map { lowercaseKey: { place, kept, _isDayTrip, ... } }
  //                 as built inside _renderPlacePickerMap
  //   coordLookup — function(placeName) → [lat,lng] | null
  //   startKey    — optional lowercased place key. If provided AND
  //                 it matches a geocoded stay in allPlaces, that
  //                 stay is used as the nearest-neighbor seed
  //                 instead of the northernmost. Otherwise we fall
  //                 back to the northernmost-seed behavior (no
  //                 crash on missing/non-stay/no-coord keys).
  //
  // Returns an array of the SAME entries (by reference) in nearest-
  // neighbor order starting from the geographically northernmost
  // stay (a stable seed across re-renders). Day trips are excluded
  // — the polyline runs through stays only; spurs handle day trips.
  // Stays without coords are appended at the end so the polyline
  // still renders for the geocoded portion (matches the candidate-
  // explorer's geocode-race behavior).
  //
  // Per Neal-confirmed decision (1) the polyline includes ALL pins
  // regardless of kept/not-kept state. We honor that at the call
  // site: pass in {kept: true} for stays the user kept, but the
  // hero-map view filters to !_isDayTrip and orders them — the
  // "all pins" intent is satisfied because not-kept and kept stays
  // BOTH flow through here when the call site passes them all.
  function orderPlacePickerStays(allPlaces, coordLookup, startKey) {
    if (!allPlaces || typeof allPlaces !== 'object') return [];
    var stays = [];
    Object.keys(allPlaces).forEach(function (key) {
      var info = allPlaces[key];
      if (!info) return;
      if (info._isDayTrip) return; // day trips travel on spurs
      stays.push({ key: key, info: info, coord: (typeof coordLookup === 'function') ? coordLookup(info.place) : null });
    });
    if (stays.length <= 1) return stays.map(function (s) { return s.info; });

    // Partition geocoded vs not.
    var geo = stays.filter(function (s) { return s.coord && isFinite(s.coord[0]) && isFinite(s.coord[1]); });
    var nogeo = stays.filter(function (s) { return !(s.coord && isFinite(s.coord[0]) && isFinite(s.coord[1])); });
    if (geo.length <= 1) {
      // Not enough geocoded — preserve insertion order, with no-geo at end.
      return geo.concat(nogeo).map(function (s) { return s.info; });
    }

    // Seed selection: prefer the user-supplied startKey when it
    // matches a geocoded stay; otherwise fall back to the stable
    // northernmost-stay seed.
    var seedIdx = -1;
    if (typeof startKey === 'string' && startKey) {
      for (var k = 0; k < geo.length; k++) {
        if (geo[k].key === startKey) { seedIdx = k; break; }
      }
    }
    if (seedIdx < 0) {
      seedIdx = 0;
      for (var i = 1; i < geo.length; i++) {
        if (geo[i].coord[0] > geo[seedIdx].coord[0]) seedIdx = i;
      }
    }
    var ordered = [geo[seedIdx]];
    var remaining = geo.slice(0, seedIdx).concat(geo.slice(seedIdx + 1));

    function distSq(a, b) {
      var dLat = a[0] - b[0], dLng = a[1] - b[1];
      return dLat * dLat + dLng * dLng;
    }

    while (remaining.length) {
      var last = ordered[ordered.length - 1].coord;
      var bestI = 0;
      var bestD = distSq(last, remaining[0].coord);
      for (var j = 1; j < remaining.length; j++) {
        var d = distSq(last, remaining[j].coord);
        if (d < bestD) { bestD = d; bestI = j; }
      }
      ordered.push(remaining[bestI]);
      remaining.splice(bestI, 1);
    }

    return ordered.concat(nogeo).map(function (s) { return s.info; });
  }

  // ── Public surface ──────────────────────────────────────────
  var MaxEnginePicker = {
    findMatchingRequired:   _findMatchingRequired,
    parseStartDateFromBrief: parseStartDateFromBrief,
    parseNightsFromRange:   parseNightsFromRange,
    orderKeptCandidates:    orderKeptCandidates,
    // place-picker hero map (Step 2)
    orderPlacePickerStays:  orderPlacePickerStays,
    // place-picker hero map (Step 8)
    buildDayTripNote:        buildDayTripNote,
    // place-picker hero map (Step 8b) — pair extractor used by
    // publishTrip's user-day-trip absorption pass + by tests.
    collectUserDayTripPairs: collectUserDayTripPairs,
    buildBrief:             buildBrief,
    cloneMdcItems:          cloneMdcItems,
    deriveTripName:         deriveTripName,
    isAutoName:             isAutoName,

    // Round HX — pure derivations lifted from renderCandidateCards.
    groupCandidatesByMustDo: groupCandidatesByMustDo,
    coordSane:               coordSane,

    // Round HX.1 — pre-render pass + status partition.
    applyRequiredAndAutoKeep: applyRequiredAndAutoKeep,
    partitionByStatus:        partitionByStatus,

    // Round HX.2 — per-card badge classifier + region seed coord.
    classifyCandidateBadge:   classifyCandidateBadge,
    regionSeedCoord:          regionSeedCoord,

    // Round HX.3 — "Also here" text lookup with route-endpoint fallback.
    alsoHereText:             alsoHereText,

    // Round HX.4 — pure parsers + composed picker-header summary.
    parseNightRange:          parseNightRange,
    parseTripDuration:        parseTripDuration,
    keptDaysRangeText:        keptDaysRangeText,

    // Round HX.5 — kept-list filter + stay-total summary computation.
    keptCandidates:           keptCandidates,
    computeStayTotalSummary:  computeStayTotalSummary,

    // Round HZ — picker hero map redesign: active (non-rejected)
    // candidates participate in route rendering.
    activeCandidates:         activeCandidates,

    // Round HX.6 — pure sort behind the "best pick first" inline
    // function (groupCandidatesByMustDo also gains `mustDoOrder` in
    // its return shape — fixes the activity-lens ReferenceError).
    bestPickFirstSort:        bestPickFirstSort,

    // Round HX.7 — region-lens primary grouping + activity-lens
    // umbrella partition.
    groupByCountry:           groupByCountry,
    partitionMustDosByType:   partitionMustDosByType,

    // Round HX.8 — region-lens within-country sort + commitment-lens
    // active-candidates split.
    regionWithinCountrySort:    regionWithinCountrySort,
    partitionActiveByCommitment: partitionActiveByCommitment,

    // Round HX.9 — section-render policy + route arrow lookup.
    mustDoSectionRenderable:    mustDoSectionRenderable,
    routeArrow:                 routeArrow,

    // Round HX.10 — section title formatter.
    // (shouldShowAllInSection was removed in the post-HX.10 cleanup —
    // it supported the "Show me the best" toggle which had been removed
    // from the UI in an earlier round.)
    mustDoSectionTitle:         mustDoSectionTitle,

    // Round SCAFFOLD-1.5 — the leading user-reason section in the
    // picker. Async; uses callMax. Returns [] gracefully on any
    // failure mode (no placeContext, LLM error, no candidates).
    deriveUserReasons:          deriveUserReasons,

    // Draft state — getter so re-init in the inline script
    // (`_tb = {...}` at picker start) is reflected on every read.
    get state() { return global._tb; },

    // Replace the entire draft. Used by picker.start() to begin a
    // fresh brief; matches the inline script's `_tb = {...}` reset.
    resetState: function (initial) {
      global._tb = initial || {};
      pickerEmit('stateReset', global._tb);
    },

    // Patch one or more fields on the current draft.
    setField: function (field, value) {
      if (!global._tb) global._tb = {};
      global._tb[field] = value;
      pickerEmit('briefChange', {field: field, value: value});
    },

    // ── HZ.1 (path-to-10:D): curated read-only getters ────────
    // The `state` getter above returns the raw _tb object — useful
    // as an escape hatch but unstable (every internal flag like
    // _editMode, _exitTouched, _autoKeepApplied is exposed). The
    // getters below return curated, frozen shapes that consumers
    // (mobile, future tooling, tests) can rely on without
    // accidentally mutating picker state.
    //
    // Intentionally minimal first slice. Inline picker code keeps
    // reading _tb.X directly — migration to these getters is for
    // future rounds (HZ.2+). The point of HZ.1 is to give
    // consumers a stable read surface RIGHT NOW so future moves
    // toward true encapsulation don't break their callers.

    // brief() — frozen snapshot of brief-shaped fields. Mirrors
    // what gets persisted to trip.brief on publish. Internal-only
    // flags (_editMode, _exitTouched, etc.) are excluded.
    brief: function () {
      var t = global._tb || {};
      return Object.freeze({
        region:             t.region          || '',
        when:               t.when            || '',
        duration:           t.duration        || '',
        intent:             t.intent          || '',
        anchors:            t.anchors         || '',
        entry:              t.entry           || '',
        tbExit:             t.tbExit          || '',
        entryMode:          t.entryMode       || '',
        exitMode:           t.exitMode        || '',
        gettingTo:          t.gettingTo       || '',
        gettingOut:         t.gettingOut      || '',
        transport:          t.transport       || '',
        accommodation:      t.accommodation   || '',
        hardlimits:         t.hardlimits      || '',
        compromises:        t.compromises     || '',
        pace:               t.pace            || '',
        familiarity:        t.familiarity     || '',
        aboutTrip:          t.aboutTrip       || '',
        travelersCount:     t.travelersCount  || '',
        withKids:           !!t.withKids,
        avoid:              Object.freeze(Object.assign({}, t.avoid || {})),
        avoidOther:         t.avoidOther      || '',
        physicalAbility:    t.physicalAbility || '',
        abilityNote:        t.abilityNote     || '',
        hoursPerDay:        (typeof t.hoursPerDay === 'number') ? t.hoursPerDay : null,
        maxBigSightsPerDay: (typeof t.maxBigSightsPerDay === 'number') ? t.maxBigSightsPerDay : null,
        placeName:          t.placeName       || '',
        placeContext:       t.placeContext    || '',
        tripMode:           t.tripMode        || '',
      });
    },

    // candidates() — frozen array of candidate objects. Each
    // candidate is shallow-frozen; nested fields stay live (small
    // perf win — these arrays can be large). Returns [] when no
    // candidates yet.
    candidates: function () {
      var t = global._tb || {};
      var arr = Array.isArray(t.candidates) ? t.candidates : [];
      var copy = arr.map(function (c) { return Object.freeze(Object.assign({}, c)); });
      return Object.freeze(copy);
    },

    // requiredPlaces() — frozen array of required-place records
    // computed from the picker's must-do reconciliation. Stable
    // surface for consumers asking "what places must be on the
    // trip?"
    requiredPlaces: function () {
      var t = global._tb || {};
      var arr = Array.isArray(t.requiredPlaces) ? t.requiredPlaces : [];
      var copy = arr.map(function (p) { return Object.freeze(Object.assign({}, p)); });
      return Object.freeze(copy);
    },

    // ── HZ.2 (path-to-10:D): domain setters ───────────────────
    // Named verbs for the most common picker mutations. Inline
    // picker code can keep mutating _tb directly; these wrappers
    // exist so external consumers (mobile, future tooling) have
    // a stable API to drive changes from. Each setter:
    //   - Validates / normalizes input
    //   - Mutates _tb
    //   - Emits the appropriate event
    //
    // Combined with HZ.1 read getters + the existing event bus,
    // _tb is now reachable through engine APIs only — closing
    // Item D's "_tb internals behind engine APIs" criterion.

    // setEntry(city) — sets the picker's arrival city. Title-cases
    // the input via _titleCaseCity if available; trims whitespace.
    setEntry: function (city) {
      if (!global._tb) global._tb = {};
      var v = (city == null) ? '' : String(city).trim();
      if (typeof global._titleCaseCity === 'function' && v) v = global._titleCaseCity(v);
      global._tb.entry = v;
      pickerEmit('briefChange', { field: 'entry', value: v });
    },

    // setExit(city) — sets the picker's departure city. _tb.tbExit
    // is the historical name (clash with the JS reserved word).
    setExit: function (city) {
      if (!global._tb) global._tb = {};
      var v = (city == null) ? '' : String(city).trim();
      if (typeof global._titleCaseCity === 'function' && v) v = global._titleCaseCity(v);
      global._tb.tbExit = v;
      pickerEmit('briefChange', { field: 'tbExit', value: v });
    },

    // setRegion(name) — sets the trip's region/destination. The
    // single most-consequential field in the brief; many engine
    // helpers fall back to it for prompts and geocoding seeds.
    setRegion: function (name) {
      if (!global._tb) global._tb = {};
      var v = (name == null) ? '' : String(name).trim();
      global._tb.region = v;
      pickerEmit('briefChange', { field: 'region', value: v });
    },

    // setCandidateStatus(candId, status) — sets keep/reject/null on
    // a candidate. Wraps the inline setCS function so consumers
    // don't have to reach into the inline globals. status is one
    // of 'keep', 'reject', or null/undefined to clear.
    setCandidateStatus: function (candId, status) {
      if (typeof global.setCS === 'function') {
        return global.setCS(candId, status);
      }
      // Fallback path when the inline helper isn't loaded (test
      // contexts): mutate the candidate directly + emit.
      if (!global._tb || !Array.isArray(global._tb.candidates)) return;
      var c = global._tb.candidates.find(function (x) { return x.id === candId; });
      if (!c) return;
      c.status = (status === 'keep' || status === 'reject') ? status : null;
      pickerEmit('candidateChange', { id: candId, status: c.status });
    },

    // startFresh(initial) — alias for resetState. Reads better at
    // call sites that begin a new picker session.
    startFresh: function (initial) {
      global._tb = initial || {};
      pickerEmit('stateReset', global._tb);
    },

    // Event bus
    on:    pickerOn,
    off:   pickerOff,
    emit:  pickerEmit,

    // Service injection (picker may need its own LLM service slot;
    // currently shares trip-engine's via callMax for simplicity.
    // Dedicated slots become useful for picker-specific services
    // like the geocoding queue — Round HI.3.)
    injectService: pickerInjectService,
    _getService:   pickerGetService,

    // ── Round HI.3: late-bound LLM-calling picker methods ──────
    // These four functions stay physically in the inline script
    // because they directly manipulate picker UI state (the
    // Leaflet _ceMap instance, _ceMarkers array, DOM elements,
    // etc.). Moving them here would pull picker-UI dependencies
    // into the engine module, defeating the boundary.
    //
    // Instead, MaxEnginePicker exposes them via late-bound
    // delegators — the engine API is defined and callers have a
    // single namespace to point at. A future round may extract
    // the picker UI itself, at which point these functions can
    // physically move. For now: conceptual boundary, not
    // structural.
    runCandidateSearch: function () {
      if (typeof global.runCandidateSearch === 'function') {
        return global.runCandidateSearch.apply(null, arguments);
      }
    },
    expandMustDos: function () {
      if (typeof global.expandMustDos === 'function') {
        return global.expandMustDos.apply(null, arguments);
      }
    },
    findCandidates: function () {
      if (typeof global.findCandidates === 'function') {
        return global.findCandidates.apply(null, arguments);
      }
    },
    geocodeMissingCandidates: function () {
      // Round HT: prefer injected service, fall back to global. Tests
      // inject a no-op; production binds the inline-script function.
      var fn = pickerGetService('geocode-candidates') || global.geocodeMissingCandidates;
      if (typeof fn === 'function') return fn.apply(null, arguments);
    },

    // ── Round HM: publishTrip is the real implementation ──────
    // The full 738-line buildFromCandidates body lives inside this
    // IIFE (defined further up). The inline-script entry point
    // `buildFromCandidates` is now a thin delegator. The earlier
    // HJ late-bound shim caused infinite recursion (delegator → shim
    // → delegator); replaced by a direct reference to the real
    // function in the IIFE scope.
    publishTrip: publishTrip,
  };

  global.MaxEnginePicker = MaxEnginePicker;

  // ── Back-compat globals (Phase 3) ──────────────────────────
  // The inline script still calls these by their original names.
  // Phase 3 later steps will narrow callers to the namespaced surface.
  global._findMatchingRequired   = _findMatchingRequired;
  global.parseStartDateFromBrief = parseStartDateFromBrief;
  global.parseNightsFromRange    = parseNightsFromRange;
  global.orderKeptCandidates     = orderKeptCandidates;
  global.orderPlacePickerStays   = orderPlacePickerStays;
  global.buildDayTripNote        = buildDayTripNote;
  global.collectUserDayTripPairs = collectUserDayTripPairs;

})(typeof window !== 'undefined' ? window : this);
