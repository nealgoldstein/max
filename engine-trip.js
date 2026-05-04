// engine-trip.js — Max trip engine, pure helpers (Round HB: Phase 1)
//
// Phase 1 of the engine/UI split. This module owns the trip engine's
// pure helpers — math, parsers, normalizers — that don't touch the
// trip object, the DOM, the LLM, or any other module-level state.
//
// State-dependent engine functions (mutators, queries that read the
// global trip, async functions that call the LLM) stay in the inline
// script for Phase 1. They move in Phase 2, after the event system
// is in place.
//
// Functions are exposed in two ways:
//   1. window.MaxEngineTrip.<name> — the namespaced engine surface
//   2. window.<name> — back-compat alias so the inline script can
//      keep calling them by their original names unchanged.
//
// Phase 2 will narrow callers to the namespaced surface and drop the
// window aliases.

(function (global) {
  'use strict';

  // ── Geographic affordance (FQ) — pure pieces ───────────────
  // Round FQ shipped a pairwise transit + verdict engine. The pure
  // arithmetic and string normalization pieces live here; the LLM
  // call (_fqGetTransitInfo) and the per-session memos
  // (_fqPairMemo, _fqInflight, _fqLastSig, _fqLastVerdict) stay
  // in the inline script for now — they'll move in Phase 2 when
  // service injection lands.

  // Haversine great-circle distance in kilometers between two
  // (lat, lng) pairs. Returns Infinity if any input is non-finite —
  // callers treat that as "no data" rather than a real distance.
  function _fqHaversineKm(lat1, lng1, lat2, lng2) {
    if (![lat1, lng1, lat2, lng2].every(function (n) {
      return typeof n === 'number' && isFinite(n);
    })) return Infinity;
    var R = 6371; // km
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
          + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
          * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Sorted-pair signature so (A,B) and (B,A) hash to the same prompt
  // text and therefore the same callMax cache entry.
  function _fqPairKey(a, b) {
    var pa = (a || '').trim().toLowerCase();
    var pb = (b || '').trim().toLowerCase();
    return pa < pb ? pa + '|' + pb : pb + '|' + pa;
  }

  // Door-to-door fastest practical mode time, in hours. Walks the
  // transit-info object the LLM returns and picks the smallest of
  // {drive, train, flight} that's actually applicable.
  function _fqFastestPractical(info) {
    if (!info) return Infinity;
    var times = [];
    if (typeof info.driveHours === 'number' && isFinite(info.driveHours)) times.push(info.driveHours);
    if (typeof info.trainHours === 'number' && isFinite(info.trainHours)) times.push(info.trainHours);
    if (info.flightAvailable && typeof info.flightHours === 'number' && isFinite(info.flightHours)) {
      times.push(info.flightHours);
    }
    if (!times.length) return Infinity;
    return Math.min.apply(null, times);
  }

  // Stable signature for a set of place names (lowercased + sorted).
  // Used by the verdict memo to detect "same set, different order".
  function _fqPlacesSig(places) {
    return places.map(function (p) { return (p.name || '').toLowerCase(); })
                 .sort()
                 .join('|');
  }

  // ── Hour parsing / formatting (FT day-trip threshold) ──────
  // Accepts plain decimals ("3", "3.5"), h:mm ("3:30"), Xh ("3h"),
  // or "Xh Ym" ("3h 30m"). Returns decimal hours, or null on
  // unparseable input. Callers fall back to a default (typically 3).
  function _ftParseHoursInput(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim().toLowerCase();
    if (!s) return null;
    var m;
    // h:mm
    if ((m = s.match(/^(\d+):(\d{1,2})$/))) {
      var h1 = parseInt(m[1], 10);
      var mm1 = parseInt(m[2], 10);
      if (mm1 >= 60) return null;
      return h1 + mm1 / 60;
    }
    // Xh Ym (e.g., "3h 30m" or "3h")
    if ((m = s.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?$/))) {
      var h2 = parseInt(m[1], 10);
      var mm2 = m[2] ? parseInt(m[2], 10) : 0;
      return h2 + mm2 / 60;
    }
    // decimal
    var n = parseFloat(s);
    if (isFinite(n) && n > 0) return n;
    return null;
  }

  // Format decimal hours as "3h" / "3:30" / "3:05". Empty string for
  // non-finite input.
  function _ftFormatHours(hours) {
    if (typeof hours !== 'number' || !isFinite(hours)) return '';
    var h = Math.floor(hours);
    var m = Math.round((hours - h) * 60);
    if (m === 0) return h + 'h';
    if (m === 60) return (h + 1) + 'h';
    return h + ':' + (m < 10 ? '0' : '') + m;
  }

  // ── Place-name canonicalization ────────────────────────────

  // Title-case a city/place name so user-typed lowercase input
  // ("zurich") becomes display-friendly ("Zurich"). Handles
  // multi-word names, hyphenated names, and "St." prefixes.
  // Preserves intentional all-caps for short abbreviations
  // (≤4 chars, all letters) so airport codes like "ZRH" / "NYC"
  // survive untouched.
  function _titleCaseCity(s) {
    if (!s) return s;
    var t = String(s).trim();
    if (!t) return t;
    if (t.length <= 4 && /^[A-Z]+$/.test(t)) return t;
    return t.toLowerCase().replace(/\b([a-zà-ÿ])([a-zà-ÿ']*)/g, function (_, first, rest) {
      return first.toUpperCase() + rest;
    }).replace(/\bSt\b\.?/g, 'St.');
  }

  // Aggressive normalization for equality testing. Strips diacritics,
  // collapses whitespace, removes common prefixes. "St. Moritz" and
  // "Saint-Moritz" and "st moritz" all normalize identically.
  function _normPlaceName(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
      .replace(/\bsaint\b/g, 'st')                       // saint → st
      .replace(/\bst\.?\s+/g, 'st ')                     // st. / st  → st
      .replace(/[^\w\s]/g, ' ')                          // punct → space
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Event bus (Round HC: Phase 2 step 1) ───────────────────
  // The trip engine emits events when its state changes. The UI
  // subscribes to re-render. Engines never call drawXxx() directly
  // — that's the whole point of the split.
  //
  // Standard events:
  //   'tripChange'    — the trip object changed; re-render whichever
  //                     view is active
  //   'mapDataChange' — destination coords / pins changed; re-render
  //                     the visible map
  //   'absorbedChange' — the FZ.6 stash changed (peer day-trip
  //                      target restored or absorbed)
  //
  // Phase 2 emits coarse events. Phase 3 may add finer events when
  // a UI surface needs to react to a specific change without re-
  // rendering the whole view.
  var listeners = Object.create(null);

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
    return function unsubscribe() { off(event, cb); };
  }

  function off(event, cb) {
    if (!listeners[event]) return;
    var i = listeners[event].indexOf(cb);
    if (i >= 0) listeners[event].splice(i, 1);
  }

  function emit(event, payload) {
    var arr = listeners[event];
    if (!arr) return;
    arr.slice().forEach(function (cb) {
      try { cb(payload); }
      catch (e) { console.warn('[MaxEngineTrip] listener for', event, 'threw:', e); }
    });
  }

  // ── Service injection (Round HC: Phase 2 step 2) ───────────
  // Some engine functions need services that live outside the
  // engine — currently only the LLM (callMax). Tests inject mocks;
  // production injects the real implementation. The engine never
  // imports the service directly; it asks for it by name.
  //
  // Today only 'llm' is meaningful. Future: 'geocode', 'storage'.
  var services = Object.create(null);

  function injectService(name, impl) {
    services[name] = impl;
  }

  function getService(name) {
    return services[name] || null;
  }

  // ── FQ async verdict pipeline (Round HF: Phase 2 step 4) ────
  // The pairwise transit + dense/spread/mixed verdict engine. Async
  // because it calls the LLM for each pair's transit info; results
  // are memoized at two levels:
  //   _fqPairMemo[key]  — per-pair info (survives this session)
  //   _fqLastSig + _fqLastVerdict — per-set cache so re-renders with
  //                                  the same place set don't re-walk
  //                                  the pair grid
  // The LLM responses themselves are also cached at the callMax layer
  // (IDB), so even a fresh-page reload gets cache hits for pairs the
  // user has already evaluated.
  //
  // Service injection: callMax is injected from the inline script via
  // MaxEngineTrip.injectService('llm', callMax). The engine never
  // imports callMax directly. Tests inject a mock; production injects
  // the real Anthropic-API wrapper.
  //
  // _fqPairMemo and _fqInflight are shared with the inline script via
  // window globals so _ftPeerDayTripCandidates can read cached transit
  // info to filter day-trip candidates without hitting the LLM again.

  var _fqInflight = {};
  var _fqPairMemo = {};
  var _fqLastSig = null;
  var _fqLastVerdict = null;

  async function _fqGetTransitInfo(placeA, placeB, distKm) {
    var llm = getService('llm');
    var key = _fqPairKey(placeA, placeB);
    if (_fqPairMemo[key]) return _fqPairMemo[key];
    if (_fqInflight[key]) return _fqInflight[key];

    // Sort the pair for the prompt too — same key, same prompt, same
    // callMax cache entry across (A,B) and (B,A).
    var first = placeA, second = placeB;
    if ((placeA || '').toLowerCase() > (placeB || '').toLowerCase()) {
      first = placeB; second = placeA;
    }
    var fallback = {driveHours: null, trainHours: null, flightAvailable: false,
                    flightHours: null, primary: 'unknown', note: ''};

    if (!llm) {
      // No LLM service injected — return fallback so callers don't hang.
      _fqPairMemo[key] = fallback;
      return fallback;
    }

    var prompt = 'For travel between ' + first + ' and ' + second
      + ' (approx. ' + Math.round(distKm) + ' km apart), return a JSON object describing realistic transit options.'
      + '\n\nFormat (raw JSON, no markdown fences):\n'
      + '{"driveHours": number-or-null, "trainHours": number-or-null, "flightAvailable": bool, "flightHours": number-or-null, "primary": "drive"|"train"|"fly"|"mixed", "note": "short-string"}\n\n'
      + 'driveHours: realistic door-to-door drive time in hours (decimal OK). null if no road connection.\n'
      + 'trainHours: door-to-door fastest direct or near-direct train time in hours. null if no rail.\n'
      + 'flightAvailable: true only if a regularly scheduled commercial flight exists between these two cities.\n'
      + 'flightHours: total flight + transfer + airport time in hours. null if not applicable.\n'
      + 'primary: which mode most travelers would actually use for this pair.\n'
      + 'note: one short sentence (under 14 words) describing what\'s most useful to know — e.g., \'direct train every 30 min\', \'no rail; 5h drive on the Ring Road\', \'long haul; flight saves a day\'.';

    var p = (async function () {
      try {
        var raw = await llm([{role: 'user', content: prompt}], 300, 12000);
        var clean = raw.replace(/```json\s*/i, '').replace(/```\s*$/, '').trim();
        var parsed = JSON.parse(clean);
        _fqPairMemo[key] = parsed;
        delete _fqInflight[key];
        return parsed;
      } catch (e) {
        console.warn('[MaxEngineTrip FQ] transit-info parse failed for', first, '↔', second, e);
        delete _fqInflight[key];
        _fqPairMemo[key] = fallback;
        return fallback;
      }
    })();
    _fqInflight[key] = p;
    return p;
  }

  // places: array of {name, lat, lng}
  // returns: { verdict, pairs, summary, ready }
  async function _fqComputeVerdict(places) {
    var n = places.length;
    if (n < 2) return {verdict: 'none', pairs: [], summary: '', ready: true};
    var pairs = [];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = places[i], b = places[j];
        var km = _fqHaversineKm(a.lat, a.lng, b.lat, b.lng);
        pairs.push({a: a.name, b: b.name, km: km, info: null, fastestH: Infinity});
      }
    }
    await Promise.all(pairs.map(function (p) {
      return _fqGetTransitInfo(p.a, p.b, p.km).then(function (info) {
        p.info = info;
        p.fastestH = _fqFastestPractical(info);
      });
    }));
    var dense = 0, spread = 0;
    pairs.forEach(function (p) {
      if (p.fastestH <= 2) dense++;
      else if (p.fastestH > 4) spread++;
    });
    var total = pairs.length;
    var verdict;
    if (total > 0 && dense / total >= 0.6) verdict = 'dense';
    else if (total > 0 && spread / total >= 0.5) verdict = 'spread';
    else verdict = 'mixed';
    var summary;
    if (verdict === 'dense') {
      summary = "As you explore these places, you'll find opportunities for day trips between them.";
    } else if (verdict === 'spread') {
      summary = 'These places are spread out. Expect real travel time between stops, and plan time to resettle when you arrive.';
    } else {
      summary = 'Mixed geography. Some hops are short; others are longer hauls. Sequence will matter.';
    }
    return {verdict: verdict, pairs: pairs, summary: summary, ready: true};
  }

  // Per-set memoization keyed on a stable signature of place names.
  async function _fqVerdictForPlaces(places) {
    var sig = _fqPlacesSig(places);
    if (sig === _fqLastSig && _fqLastVerdict) return _fqLastVerdict;
    var v = await _fqComputeVerdict(places);
    // Only commit if signature still current (user might have toggled
    // again mid-fetch; later fetch will commit its own).
    if (_fqPlacesSig(places) === sig) {
      _fqLastSig = sig;
      _fqLastVerdict = v;
    }
    return v;
  }

  // ── Round HO: trip-engine functions moved from inline script ──
  // These were classified as TE (trip engine) in the architecture doc
  // but lived in inline script. Moving them here closes the boundary
  // leak — the picker engine's publishTrip used to call them as
  // inline-script globals; now it calls them via MaxEngineTrip.
  //
  //   _reEvaluateOverBudget        (~60 lines, recomputes the budget banner)
  //   _reconcileDestinations       (~375 lines, Round DW saga)
  //   addPendingAction             (~20 lines, push to trip.pendingActions)
  //   _mergeAdjacentSamePlaceDests (~90 lines, Round FW)
  //
  // All four still mutate global.trip and reference inline-script
  // globals (autoSave, getCityCenter, etc.) via scope chain. They
  // physically live in the trip engine module now; deeper service
  // injection is future work.

  function _reEvaluateOverBudget(){
    if (!trip || !Array.isArray(trip.destinations) || !trip.destinations.length) {
      delete trip.overBudgetNotice;
      return;
    }
    var budget = _parseTripDuration((trip.brief && trip.brief.duration) || (typeof _tb !== "undefined" && _tb && _tb.duration) || "");
    if (!budget) {
      delete trip.overBudgetNotice;
      return;
    }
    var targetNights = budget.max - 1;
    var sumNights = trip.destinations.reduce(function(s, d){ return s + (d.nights || 0); }, 0);
    if (sumNights <= targetNights) {
      delete trip.overBudgetNotice;
      return;
    }
    // Build a proposed trim, same algorithm as detectOverBudget.
    var workingNights = {};
    trip.destinations.forEach(function(d){
      if (!d || !d.place) return;
      var k = (typeof _normPlaceName === "function") ? _normPlaceName(d.place) : (d.place||"").toLowerCase();
      workingNights[k] = d.nights || 0;
    });
    var workingSum = sumNights;
    var iterations = 0;
    while (workingSum > targetNights && iterations < 100) {
      iterations++;
      var biggestKey = null, biggestNights = 0;
      trip.destinations.forEach(function(d){
        if (!d || !d.place) return;
        var k = (typeof _normPlaceName === "function") ? _normPlaceName(d.place) : (d.place||"").toLowerCase();
        var n = workingNights[k] || 0;
        if (n <= 1) return;
        if (biggestKey === null || n > biggestNights) {
          biggestKey = k; biggestNights = n;
        }
      });
      if (biggestKey === null) break;
      workingNights[biggestKey] -= 1;
      workingSum -= 1;
    }
    var proposedDeltas = [];
    trip.destinations.forEach(function(d){
      if (!d || !d.place) return;
      var k = (typeof _normPlaceName === "function") ? _normPlaceName(d.place) : (d.place||"").toLowerCase();
      var before = d.nights || 0;
      var after = workingNights[k] != null ? workingNights[k] : before;
      if (before > after) {
        proposedDeltas.push({place: d.place, before: before, after: after, key: k});
      }
    });
    trip.overBudgetNotice = {
      budgetDays: budget.max,
      pickerNights: sumNights,
      pickerDays: sumNights + 1,
      targetNights: targetNights,
      overage: sumNights - targetNights,
      proposedDeltas: proposedDeltas,
      ts: new Date().toISOString()
    };
  }

  function _reconcileDestinations(oldDests, ordered, startDate){
    oldDests = Array.isArray(oldDests) ? oldDests : [];
    ordered = Array.isArray(ordered) ? ordered : [];
    // Index existing destinations by normalized place name. Round DZ:
    // use ARRAYS per key (not single refs) so round-trip itineraries
    // where the same city appears as both entry and exit (e.g. Zurich
    // → Bern → ... → Zurich) keep their two calendar entries as
    // separate destination objects. Without this, both ordered
    // candidates resolve to the same existing object, the SAME ref ends
    // up in trip.destinations twice, and the date-recompute pass writes
    // each iteration's dates onto the shared object — producing the
    // "Jul 24 — Jul 25, 25 days" banner Neal saw on a Switzerland
    // round trip.
    var byKey = {};
    // Round DZ.1: dedupe by destination id while building byKey. If a
    // trip is already corrupted by the original Round DW bug — same
    // object reference at multiple indices in trip.destinations — naive
    // bucketing would push that one reference twice, and shift() would
    // hand it out twice on rebuild, persisting the corruption forever.
    // Deduping by id means a corrupted trip self-heals on the next
    // edit: only the first instance is claimable, the second iteration
    // falls through to fresh-creation, and trip.destinations ends up
    // with two distinct objects.
    var seenIds = {};
    oldDests.forEach(function(d){
      if (!d || !d.place) return;
      if (d.id && seenIds[d.id]) return;
      if (d.id) seenIds[d.id] = true;
      var k = (typeof _normPlaceName === "function") ? _normPlaceName(d.place) : (d.place||"").toLowerCase();
      if (!k) return;
      if (!byKey[k]) byKey[k] = [];
      byKey[k].push(d);
    });
    // Round EF.1: build a set of place keys that exist as dayTrip chips
    // on surviving hubs. If a kept candidate's place matches a chip, we
    // skip creating a fresh standalone destination for it — the chip
    // already represents that place. Without this, Lucerne (kept by
    // user, previously a chip on Zurich) would become its own
    // destination AND the chip cleanup would drop it from Zurich,
    // splitting the trip and shrinking Zurich's nights. Symptom Neal
    // saw: unchecked Appenzell+Emmental → Zurich went from 6n
    // (3 + Schaffhausen + Lucerne) to 4n (3 + Schaffhausen) and trip
    // total grew because Lucerne became its own destination.
    var chipPlaceSet = {};
    oldDests.forEach(function(d){
      if (!d || !Array.isArray(d.dayTrips)) return;
      d.dayTrips.forEach(function(dt){
        if (!dt || !dt.place) return;
        var ck = (typeof _normPlaceName === "function") ? _normPlaceName(dt.place) : (dt.place||"").toLowerCase();
        if (ck) chipPlaceSet[ck] = true;
      });
    });
    var claimedIds = {};
    var newArr = [];
    var cur = new Date(startDate + "T12:00:00");
    ordered.forEach(function(c){
      var key = (typeof _normPlaceName === "function") ? _normPlaceName(c.place || "") : (c.place||"").toLowerCase();
      var nights = (typeof c.nights === "number" && c.nights >= 0)
        ? c.nights
        : (typeof parseNightsFromRange === "function" ? (parseNightsFromRange(c.stayRange) || 3) : 3);

      // Claim one existing destination per ordered slot. If the same
      // place appears multiple times in ordered (round-trip entry/exit),
      // each iteration claims a separate existing dest from the bucket.
      // Empty bucket → fall through to fresh creation.
      var bucket = byKey[key];
      var existing = (bucket && bucket.length) ? bucket.shift() : null;
      if (existing) claimedIds[existing.id] = true;

      // Round EF.1: if no existing dest matched AND this place is
      // already a chip on a surviving hub, skip creation. The chip
      // represents this place; the hub's nights already include it.
      // Don't advance `cur` because the chip's nights are accounted for
      // in the hub iteration.
      if (!existing && chipPlaceSet[key]) {
        return;
      }

      // Round ES: chip nights roll into hub (Round DA semantics
      // restored). Neal's reasoning: a day trip from Zurich to
      // Schaffhausen takes the same total time as overnighting in
      // Schaffhausen — the traveler still rides out, spends the day,
      // rides back. The night belongs to the hub. EQ+ER banners now
      // disclose this transparently ("Schaffhausen → day trip from
      // Zurich, 1n absorbed into Zurich's stay"), so the inflation no
      // longer looks like a mystery. Trip total stays = picker total.
      var _chipNightsBase = 0;
      if (existing && Array.isArray(existing.dayTrips)) {
        existing.dayTrips.forEach(function(dt){
          _chipNightsBase += (dt && dt.sourceNights) || 0;
        });
      }
      var effectiveNights = nights + _chipNightsBase;
      var dateFrom = cur.toISOString().slice(0, 10);
      var nextDate = new Date(cur); nextDate.setDate(nextDate.getDate() + effectiveNights);
      var dateTo = nextDate.toISOString().slice(0, 10);

      if (existing) {
        // Round EF: PRESERVE dayTrips on rebuild instead of clearing
        // them. Combined with skipping auto-clustering on rebuild
        // (below in _autoClusterDayTrips), this means clustering is a
        // one-time setup decision at first build — not a continuous
        // re-evaluation that surprises the user with new absorbtions
        // every time they edit. Symptom this fixes: Neal unchecked
        // Appenzell + Emmental and Lucerne suddenly appeared as a
        // day-trip chip on Zurich (Lucerne's "closest hub" recomputed
        // when Appenzell was removed). With EF, existing chips stay
        // exactly as they were and no new chips get auto-added — the
        // user controls clustering via the picker prediction at first
        // build and via "Restore as own destination" thereafter.
        // Mutate in place so identity (and all references) survive.
        existing.dateFrom = dateFrom;
        existing.dateTo = dateTo;
        // Update intent string only if it was clearly auto-generated; user
        // edits to intent (rare) survive otherwise. Heuristic: if intent
        // starts with "<place> — ", it was auto-generated.
        var newIntent = c.place + (c.whyItFits ? " — " + String(c.whyItFits).substring(0, 60) : "");
        if (!existing.intent || existing.intent.indexOf(c.place + " — ") === 0 || existing.intent === c.place) {
          existing.intent = newIntent;
        }
        if (existing.nights !== effectiveNights) {
          // Round EP: rebalance items across the new day grid by
          // duration budget instead of just clamping each old day onto
          // the new day with the same index. Old behavior (clamp-to-
          // last) made items pile up on the final day when nights
          // shrunk — Neal's "Zurich went 3→2 nights and all the sights
          // ended up on the departure day" symptom. New behavior:
          // collect all preserved items into one pool, then place each
          // onto the first new day with remaining duration capacity
          // (4 hours for arrival/departure days, 6 for middle days,
          // matching auto-seed). Items that don't fit go onto the
          // lightest day.
          var oldDays = Array.isArray(existing.days) ? existing.days : [];
          var allOldItems = [];
          oldDays.forEach(function(day){
            if (Array.isArray(day && day.items)) {
              day.items.forEach(function(it){
                if (!it) return;
                if (it.type === "transport" || it.type === "transit") return;
                allOldItems.push(it);
              });
            }
          });
          existing.nights = effectiveNights;
          existing.days = makeDays(existing.id, existing.place, existing.place, dateFrom, effectiveNights);
          if (existing.days.length && allOldItems.length) {
            var newDayCount = existing.days.length;
            function _budgetForDayEP(idx){
              if (newDayCount <= 1) return 4;
              if (idx === 0 || idx === newDayCount - 1) return 4;
              return 6;
            }
            function _hoursOnDayEP(idx){
              var h = 0;
              (existing.days[idx].items || []).forEach(function(it){
                h += (typeof it.durationHours === "number" && it.durationHours > 0) ? it.durationHours : 2;
              });
              return h;
            }
            var existingNamesEP = {};
            allOldItems.forEach(function(it){
              if (it && it.n) existingNamesEP[it.n.toLowerCase()] = (existingNamesEP[it.n.toLowerCase()] || 0);
            });
            var seenNames = {};
            allOldItems.forEach(function(it){
              var k2 = (it.n || "").toLowerCase();
              if (k2 && seenNames[k2]) return; // de-dup by name
              if (k2) seenNames[k2] = true;
              var dur = (typeof it.durationHours === "number" && it.durationHours > 0) ? it.durationHours : 2;
              // Place on first day with capacity. If nothing fits,
              // place on lightest day so items don't get lost.
              var targetIdx = -1;
              for (var di = 0; di < newDayCount; di++) {
                var used = _hoursOnDayEP(di);
                var budget = _budgetForDayEP(di);
                if (used + dur <= budget) { targetIdx = di; break; }
              }
              if (targetIdx === -1) {
                // Fallback: lightest day.
                var lightestIdx = 0, lightestUsed = _hoursOnDayEP(0);
                for (var di2 = 1; di2 < newDayCount; di2++) {
                  var u2 = _hoursOnDayEP(di2);
                  if (u2 < lightestUsed) { lightestUsed = u2; lightestIdx = di2; }
                }
                targetIdx = lightestIdx;
              }
              var target = existing.days[targetIdx];
              if (!target) return;
              if (!Array.isArray(target.items)) target.items = [];
              target.items.push(it);
            });
          }
        } else {
          // Same nights — just refresh the day labels for the new dates.
          if (Array.isArray(existing.days)) {
            existing.days.forEach(function(day, idx){
              try {
                var dd = new Date(dateFrom + "T12:00:00");
                dd.setDate(dd.getDate() + idx);
                day.lbl = dd.toLocaleDateString("en-US", {month:"short", day:"numeric"});
                if (idx === 0) day.note = day.note || "arrival";
              } catch(_){}
            });
          }
        }
        // Refresh attached events from the latest mdcItems set.
        if (typeof findAttachedEvents === "function") {
          existing.attachedEvents = findAttachedEvents(c, _mdcItems || []);
        }
        // Round FE.1: propagate _exitStop flag from the candidate. Set
        // by the buffer-night logic (line ~12547) when the exit city
        // wasn't already the last destination. Without this, the
        // reconcile pass dropped the flag and the trip-view buffer-night
        // banner had nothing to detect — symptom: trip ends with the
        // exit city but no banner appears. Clear when the candidate
        // doesn't carry the flag, in case a previous build set it on a
        // dest whose role has now changed.
        existing._exitStop = !!c._exitStop;
        // Round FY: also propagate _entryStop. Without this the entry
        // buffer's flag is dropped during reconcile, the merge then
        // sees two unflagged adjacent same-place destinations and
        // folds them into one — losing the buffer/main distinction.
        existing._entryStop = !!c._entryStop;
        newArr.push(existing);
      } else {
        // Fresh destination — same shape as the from-scratch path.
        destCtr++;
        var id = "d" + destCtr;
        var fresh = {
          id: id,
          place: c.place,
          intent: c.place + (c.whyItFits ? " — " + String(c.whyItFits).substring(0, 60) : ""),
          dateFrom: dateFrom,
          dateTo: dateTo,
          nights: nights,
          // Round FQ.1: propagate lat/lng from the candidate.
          lat: (typeof c.lat === "number" && isFinite(c.lat)) ? c.lat : null,
          lng: (typeof c.lng === "number" && isFinite(c.lng)) ? c.lng : null,
          days: makeDays(id, c.place, c.place, dateFrom, nights),
          trackerItems: {booked:[], see:[], visited:[]},
          trackerCat: "booked",
          storyState: "idle",
          hotelBookings: [],
          generalBookings: [],
          locations: [],
          execMode: false,
          todayItems: [],
          discoveredItems: [],
          suggestions: [],
          attachedEvents: (typeof findAttachedEvents === "function") ? findAttachedEvents(c, _mdcItems||[]) : [],
          // Round FE.1: propagate _exitStop from the candidate (the
          // buffer-night logic sets it when it appends an exit stop).
          // Without this, fresh-built buffer destinations never get the
          // flag and the trip-view banner doesn't surface.
          _exitStop: !!c._exitStop,
          // Round FY: same propagation on the fresh-create path.
          _entryStop: !!c._entryStop
        };
        newArr.push(fresh);
      }
      cur = nextDate;
    });

    // Round EF: clean up dayTrip chips whose underlying place is no
    // longer kept. Round ES: chip nights live on the hub, so when a
    // chip is dropped, subtract its sourceNights from the hub and regen
    // the days array.
    var orderedKeys = {};
    ordered.forEach(function(c){
      var k = (typeof _normPlaceName === "function") ? _normPlaceName(c.place || "") : (c.place||"").toLowerCase();
      if (k) orderedKeys[k] = true;
    });
    newArr.forEach(function(d){
      if (!d || !Array.isArray(d.dayTrips) || !d.dayTrips.length) return;
      var droppedNights = 0;
      var keptChips = [];
      d.dayTrips.forEach(function(dt){
        if (!dt || !dt.place) return;
        var dtK = (typeof _normPlaceName === "function") ? _normPlaceName(dt.place) : (dt.place||"").toLowerCase();
        if (orderedKeys[dtK]) {
          keptChips.push(dt);
        } else {
          droppedNights += (dt.sourceNights || 0);
        }
      });
      if (droppedNights > 0) {
        d.dayTrips = keptChips;
        if (!d.dayTrips.length) delete d.dayTrips;
        d.nights = Math.max(1, (d.nights || 0) - droppedNights);
        var oldDaysCu = Array.isArray(d.days) ? d.days : [];
        var savedItemsByIdxCu = oldDaysCu.map(function(day){
          return Array.isArray(day && day.items) ? day.items.slice() : [];
        });
        d.days = makeDays(d.id, d.place, d.place, d.dateFrom, d.nights);
        if (d.days.length && savedItemsByIdxCu.length) {
          var lastNewCu = d.days.length - 1;
          savedItemsByIdxCu.forEach(function(items, oldIdx){
            if (!items.length) return;
            var targetIdx = Math.min(oldIdx, lastNewCu);
            var target = d.days[targetIdx];
            if (!target) return;
            if (!Array.isArray(target.items)) target.items = [];
            var existingNamesCu = {};
            target.items.forEach(function(it){ if (it && it.n) existingNamesCu[it.n.toLowerCase()] = true; });
            items.forEach(function(it){
              if (!it) return;
              if (it.type === "transport" || it.type === "transit") return;
              var k2 = (it.n || "").toLowerCase();
              if (k2 && existingNamesCu[k2]) return;
              target.items.push(it);
              if (k2) existingNamesCu[k2] = true;
            });
          });
        }
      }
    });
    // Recompute dateFrom/dateTo across newArr so the calendar stays
    // contiguous after any chip cleanup that shrank a hub.
    var _curRecalc = new Date(startDate + "T12:00:00");
    newArr.forEach(function(d){
      var dfNew = _curRecalc.toISOString().slice(0,10);
      var ndNew = new Date(_curRecalc); ndNew.setDate(ndNew.getDate() + (d.nights||0));
      var dtNew = ndNew.toISOString().slice(0,10);
      d.dateFrom = dfNew;
      d.dateTo = dtNew;
      _curRecalc = ndNew;
    });

    // Removed: any existing destination that wasn't claimed by an
    // ordered iteration. Round DZ: matching is by destination identity
    // (id), not by place key — a round trip with two Zurich entries
    // would otherwise mark both as "kept" by name even if one was
    // dropped from the new ordering.
    var removed = oldDests.filter(function(d){
      return d && d.id && !claimedIds[d.id];
    });
    removed.forEach(function(d){
      // Log PendingActions for any "booked" hotel records.
      (d.hotelBookings || []).forEach(function(bk){
        if (!bk || bk.status !== "booked") return;
        if (typeof addPendingAction !== "function") return;
        addPendingAction({
          eventType: "hotel",
          actionType: "deleted",
          eventName: bk.name || "Hotel",
          destName: d.label || d.place,
          confirmationNumber: bk.confirmationNumber || null,
          detail: (d.place || "Destination") + " was removed from the trip. Contact " + (bk.name || "the hotel") + " to cancel this reservation.",
          requiresProviderAction: true
        });
      });
      // Transport bookings on legs that touched this destination.
      if (trip && trip.legs && d.id) {
        Object.keys(trip.legs).forEach(function(legKey){
          if (legKey.indexOf(d.id) === -1) return;
          var leg = trip.legs[legKey] || {};
          (leg.bookings || []).forEach(function(bk){
            if (!bk || bk.status !== "booked") return;
            if (typeof addPendingAction !== "function") return;
            addPendingAction({
              eventType: "transport",
              actionType: "deleted",
              eventName: bk.operator || "Transport",
              destName: d.label || d.place,
              confirmationNumber: bk.confirmationNumber || null,
              detail: (d.place || "Destination") + " was removed; this transport booking is now orphaned. Contact " + (bk.operator || "the provider") + " to cancel.",
              requiresProviderAction: true
            });
          });
        });
      }
    });

    return newArr;
  }

  function addPendingAction(opts){
    // opts: {eventType, eventName, destName, confirmationNumber, detail, requiresProviderAction}
    if(!trip.pendingActions) trip.pendingActions=[];
    var action={
      id: newActionId(),
      eventType: opts.eventType||'booking',       // 'hotel','transport','restaurant','general'
      actionType: opts.actionType||'changed',     // 'changed','cancelled','deleted','moved'
      eventName: opts.eventName||'',
      destName: opts.destName||'',
      confirmationNumber: opts.confirmationNumber||null,
      detail: opts.detail||'',
      requiresProviderAction: opts.requiresProviderAction!==false, // default true
      createdAt: new Date().toISOString(),
      cleared: false
    };
    trip.pendingActions.push(action);
    autoSave();
    updateTrackerBadge();
    return action;
  }

  function _mergeAdjacentSamePlaceDests(){
    if (!trip || !Array.isArray(trip.destinations) || trip.destinations.length < 2) return false;
    var changed = false;
    var i = 0;
    while (i < trip.destinations.length - 1) {
      var a = trip.destinations[i], b = trip.destinations[i + 1];
      if (!a || !b) { i++; continue; }
      var aN = (typeof _normPlaceName === "function") ? _normPlaceName(a.place || "") : (a.place || "").toLowerCase();
      var bN = (typeof _normPlaceName === "function") ? _normPlaceName(b.place || "") : (b.place || "").toLowerCase();
      // Round FY: never merge across a buffer. _entryStop and _exitStop
      // are anchored 1n stops at the trip's edges; the user's main stay
      // at the same place is a separate movable destination. If they
      // happen to be adjacent (e.g. main stay defaults right after the
      // arrival buffer), they must stay distinct so the user can drag
      // the main stay elsewhere without losing the buffer.
      if (aN && aN === bN && !a._entryStop && !a._exitStop && !b._entryStop && !b._exitStop) {
        // Merge b into a
        a.nights = (a.nights || 0) + (b.nights || 0);
        // Concatenate day blocks; cap at 7 to match makeDays. If we
        // overflow, push extra days' items into the last kept day so
        // nothing is silently dropped.
        a.days = (a.days || []).concat(b.days || []);
        if (a.days.length > 7) {
          var keep = a.days.slice(0, 7);
          var extra = a.days.slice(7);
          var lastKept = keep[keep.length - 1];
          if (lastKept) {
            if (!Array.isArray(lastKept.items)) lastKept.items = [];
            extra.forEach(function(d){
              if (Array.isArray(d.items)) lastKept.items = lastKept.items.concat(d.items);
            });
          }
          a.days = keep;
        }
        // Concatenate parallel lists
        a.hotelBookings   = (a.hotelBookings   || []).concat(b.hotelBookings   || []);
        a.generalBookings = (a.generalBookings || []).concat(b.generalBookings || []);
        a.locations       = (a.locations       || []).concat(b.locations       || []);
        a.todayItems      = (a.todayItems      || []).concat(b.todayItems      || []);
        a.discoveredItems = (a.discoveredItems || []).concat(b.discoveredItems || []);
        // Dedupe-by-name lists
        ["suggestions", "attachedEvents", "dayTrips"].forEach(function(key){
          var aList = Array.isArray(a[key]) ? a[key] : [];
          var bList = Array.isArray(b[key]) ? b[key] : [];
          var seen = {};
          aList.forEach(function(it){
            var k = (it && it.place && it.place.toLowerCase()) || (it && it.name && it.name.toLowerCase()) || null;
            if (k) seen[k] = true;
          });
          bList.forEach(function(it){
            var k = (it && it.place && it.place.toLowerCase()) || (it && it.name && it.name.toLowerCase()) || null;
            if (k && seen[k]) return;
            aList.push(it);
            if (k) seen[k] = true;
          });
          a[key] = aList;
        });
        if (b._exitStop) a._exitStop = true;
        trip.destinations.splice(i + 1, 1);
        changed = true;
        // Don't increment i — re-check this slot in case 3+ same-place
        // destinations were adjacent.
      } else {
        i++;
      }
    }
    if (changed) {
      // Recompute dates trip-wide
      var startDate = trip.destinations[0] && trip.destinations[0].dateFrom;
      if (startDate) {
        var cur = new Date(startDate + "T12:00:00");
        trip.destinations.forEach(function(d){
          d.dateFrom = cur.toISOString().slice(0, 10);
          var nx = new Date(cur);
          nx.setDate(nx.getDate() + (d.nights || 0));
          d.dateTo = nx.toISOString().slice(0, 10);
          cur = nx;
        });
        trip.destinations.forEach(function(d){
          if (!Array.isArray(d.days) || !d.dateFrom) return;
          d.days.forEach(function(day, idx){
            try {
              var dd = new Date(d.dateFrom + "T12:00:00");
              dd.setDate(dd.getDate() + idx);
              day.lbl = dd.toLocaleDateString("en-US", {month:"short", day:"numeric"});
            } catch(_){}
          });
        });
      }
    }
    return changed;
  }


  // ── Round HR: trip-engine helpers moved from inline script ──
  //   makeDays(destId, place, label, startDate, nights)
  //     Pure: builds a days[] array for a destination.
  //   getCityCenter(place)
  //     Reads from _generatedCityData / _coarseGeocode (window globals)
  //     to return [lat, lng] or null. Not pure — references caches —
  //     but those caches are conceptually trip-engine state.

  function getCityCenter(place){
    var p=place.toLowerCase();
    if(_generatedCityData[p]&&_generatedCityData[p].cityCenter&&_generatedCityData[p].cityCenter[0])
      return _generatedCityData[p].cityCenter;
    if(_generatedCityData[p]&&_generatedCityData[p].loading&&!_generatedCityData[p].cityCenter){
      // Still loading with no geocode yet — fall back to coarse Nominatim cache if we have it.
      if (_coarseGeocode[p]) return _coarseGeocode[p];
      return null;
    }
    // For generated cities loaded from storage: derive center from stored suggestion coords
    // Find the destination and average its suggestion coordinates
    var dest=trip.destinations.find(function(d){return d.place.toLowerCase()===p;});
    if(dest&&dest.suggestions){
      var pts=dest.suggestions.filter(function(s){return s.lat&&s.lng&&!s.approx;});
      if(pts.length>=2){
        var avgLat=pts.reduce(function(a,s){return a+s.lat;},0)/pts.length;
        var avgLng=pts.reduce(function(a,s){return a+s.lng;},0)/pts.length;
        return [avgLat,avgLng];
      }
      // Even approx coords are better than nothing
      var anyPts=dest.suggestions.filter(function(s){return s.lat&&s.lng;});
      if(anyPts.length>=2){
        var avgLat2=anyPts.reduce(function(a,s){return a+s.lat;},0)/anyPts.length;
        var avgLng2=anyPts.reduce(function(a,s){return a+s.lng;},0)/anyPts.length;
        return [avgLat2,avgLng2];
      }
    }
    // Last resort: the coarse Nominatim cache if populated.
    if (_coarseGeocode[p]) return _coarseGeocode[p];
    return null;
  }

  function makeDays(destId,place,intent,dateFrom,nights){
    var count=Math.min(nights,7);
    var days=[];
    for(var i=0;i<count;i++){
      var d=new Date(dateFrom+"T12:00:00"); d.setDate(d.getDate()+i);
      var lbl=d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
      days.push({id:"dy"+destId+"_"+i,lbl:lbl,note:i===0?"arrival":"",items:[]});
    }
    return days;
  }


  // ── Public surface ──────────────────────────────────────────
  var MaxEngineTrip = {
    // Geographic affordance pure pieces
    haversineKm:      _fqHaversineKm,
    pairKey:          _fqPairKey,
    fastestPractical: _fqFastestPractical,
    placesSig:        _fqPlacesSig,

    // Hour parsing / formatting
    parseHoursInput:  _ftParseHoursInput,
    formatHours:      _ftFormatHours,

    // Place-name canonicalization
    titleCaseCity:    _titleCaseCity,
    normPlaceName:    _normPlaceName,

    // Event bus
    on:               on,
    off:              off,
    emit:             emit,

    // Service injection
    injectService:    injectService,
    _getService:      getService,

    // FQ async verdict pipeline (Round HF)
    getTransitInfo:   _fqGetTransitInfo,
    computeVerdict:   _fqComputeVerdict,
    verdictForPlaces: _fqVerdictForPlaces,
    transitInfoCache: function () { return _fqPairMemo; },

    // ── Round HO: trip-state mutators previously inline ───────
    reEvaluateOverBudget:        _reEvaluateOverBudget,
    reconcileDestinations:       _reconcileDestinations,
    addPendingAction:            addPendingAction,
    mergeAdjacentSamePlaceDests: _mergeAdjacentSamePlaceDests,

    // ── Round HR: trip-engine helpers previously inline ───────
    makeDays:       makeDays,
    getCityCenter:  getCityCenter,

    // ── Round HJ: trip adoption / loading ─────────────────────
    // Trip.load(tripId) is the receiving end of the picker→trip
    // handoff. Today this delegates to the inline-script localLoad
    // (which reads the trip envelope from MaxDB.trip.read and
    // installs it into the global `trip`).
    //
    // Architectural target: DB.on('tripWritten', ({id}) => {
    //   if (currentTripId !== id) return;
    //   Trip.load(id);
    // }) so the picker engine's publishTrip hands off to the trip
    // engine through the DB without either knowing about the other.
    // Future work — left as namespace bindings + comments today.
    load: function (tripId) {
      if (typeof global.localLoad === 'function') {
        return global.localLoad(tripId);
      }
    },
    // Trip.replaceTrip(builtTrip) — adopt an in-memory trip object
    // wholesale and emit tripChange. Useful when the picker hands a
    // built trip directly without going through localStorage.
    replaceTrip: function (builtTrip) {
      if (!builtTrip) return;
      global.trip = builtTrip;
      // If activeDest isn't pointing at any destination, default to the first.
      // (Falsy check handles undeclared, undefined, null, "" all the same.)
      if (!global.activeDest && global.trip.destinations
          && global.trip.destinations.length) {
        global.activeDest = global.trip.destinations[0].id;
      }
      emit('tripChange');
      emit('mapDataChange');
    },
  };

  // ── Round HQ + HS: trip-engine subscribes to MaxDB.tripWritten ───
  // The trip engine adopts trip state through the DB channel.
  // publishTrip writes the envelope via MaxDB.trip.write; this
  // subscription fires; the trip engine adopts the envelope by
  // re-assigning global.trip, restoring counters + activeDest, then
  // emits tripChange so the UI re-renders.
  //
  // Round HS — payload envelope preferred:
  // The DB now includes the envelope object in the tripWritten
  // payload. We use it directly when present, which preserves dest
  // object identity for in-process writers (the picker engine in
  // particular keeps the same object refs across publish, so external
  // holders of dest refs are consistent with the new state).
  //
  // Fallback path: if the payload doesn't include an envelope (bad
  // JSON in writeRaw, or older callers), we re-read from storage.
  // Cross-tab/sync subscribers and any future writers that don't
  // produce the in-process envelope still work via this fallback.
  //
  // Round EX.4 closed the case where external code held dest refs
  // across publishes (popup map closes on data change). Identity-
  // independent state (pendingActions key by id, _ffHistories by id,
  // _destStories by id) is unaffected by either path.
  if (global.MaxDB && typeof global.MaxDB.on === 'function'
      && global.MaxDB.trip && typeof global.MaxDB.trip.read === 'function') {
    global.MaxDB.on('tripWritten', function (payload) {
      if (!payload || !payload.id) return;
      var env = (payload.envelope && payload.envelope.trip)
        ? payload.envelope
        : global.MaxDB.trip.read(payload.id);
      if (!env || !env.trip) return;
      global.trip = env.trip;
      if (typeof env.destCtr === 'number') global.destCtr = env.destCtr;
      if (typeof env.sidCtr === 'number') global.sidCtr = env.sidCtr;
      if (typeof env.bkCtr === 'number') global.bkCtr = env.bkCtr;
      if (env.activeDmSection) global._activeDmSection = env.activeDmSection;
      if (env.activeDest) global.activeDest = env.activeDest;
      emit('tripChange');
      emit('mapDataChange');
    });
  }

  global.MaxEngineTrip = MaxEngineTrip;

  // ── Back-compat globals (Phase 1) ──────────────────────────
  // The inline script still calls these by their original names.
  // We keep both surfaces alive until Phase 2 narrows callers to
  // the namespaced surface.
  global._fqHaversineKm    = _fqHaversineKm;
  global._fqPairKey        = _fqPairKey;
  global._fqFastestPractical = _fqFastestPractical;
  global._fqPlacesSig      = _fqPlacesSig;
  global._ftParseHoursInput = _ftParseHoursInput;
  global._ftFormatHours    = _ftFormatHours;
  global._titleCaseCity    = _titleCaseCity;
  global._normPlaceName    = _normPlaceName;
  // Round HF: FQ async pipeline + shared memo state.
  global._fqGetTransitInfo = _fqGetTransitInfo;
  global._fqComputeVerdict = _fqComputeVerdict;
  global._fqVerdictForPlaces = _fqVerdictForPlaces;
  global._fqPairMemo       = _fqPairMemo;
  global._fqInflight       = _fqInflight;
  // Round HO: trip-state mutators moved from inline script.
  global._reEvaluateOverBudget        = _reEvaluateOverBudget;
  global._reconcileDestinations       = _reconcileDestinations;
  global.addPendingAction             = addPendingAction;
  global._mergeAdjacentSamePlaceDests = _mergeAdjacentSamePlaceDests;
  // Round HR: trip-engine helpers moved from inline script.
  global.makeDays      = makeDays;
  global.getCityCenter = getCityCenter;

})(typeof window !== 'undefined' ? window : this);
