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
      var dateISO=d.toISOString().slice(0,10);
      var nextISO=new Date(d.getTime()+86400000).toISOString().slice(0,10);
      // v3 Phase 3: Day is a Segment — emit kind/startsAt/endsAt/date/refs
      // alongside the legacy id/lbl/note/items shape used by older readers.
      days.push({
        id:"dy"+destId+"_"+i,
        lbl:lbl,
        note:i===0?"arrival":"",
        items:[],
        // v3 Segment fields
        kind:"day",
        date:dateISO,
        startsAt:dateISO,
        endsAt:nextISO,
        planItems:[],
        refs:[]
      });
    }
    return days;
  }


  // ── v359.54: transit route synthesis ──────────────────────
  // Idempotent rebuild of the subKind:"transit" entries in
  // trip.routes[]. For every adjacent (A → B) pair in
  // trip.destinations[], ensures a Route segment exists with
  // subKind:"transit", fromDestId:A.id, toDestId:B.id. Removes
  // transit routes whose endpoints are no longer adjacent (e.g.
  // after a reverse or a destination removal).
  //
  // Why this lives here: publishTrip (engine-picker) and any
  // post-build mutator (reverseTripOrder, addDestination, etc.)
  // can call this to keep trip.routes consistent with the
  // destinations array. Bidirectional with route.transitDays[]
  // is owned by downstream writers — this helper only manages
  // route existence + from/to identity.
  //
  // Does NOT touch dayTrip / arrival / departure routes. Those
  // have their own lifecycle (convertDestToDayTrip, brief.entry/
  // tbExit migration).
  //
  // Preserves route metadata across rebuilds: if a transit
  // route with the same (fromId, toId) already exists, its
  // planItems[] (waysides), modeChosen, durationHours, distKm,
  // bookings, notes survive. Only the segment-identity fields
  // are touched.
  function syncTransitRoutes(trip) {
    if (!trip || !Array.isArray(trip.destinations)) return;
    if (!Array.isArray(trip.routes)) trip.routes = [];

    var dests = trip.destinations;
    // Compute the expected (fromId, toId) pairs from adjacency.
    var expected = [];
    for (var i = 0; i < dests.length - 1; i++) {
      var from = dests[i];
      var to   = dests[i + 1];
      if (!from || !to || !from.id || !to.id) continue;
      expected.push({ fromId: from.id, toId: to.id, fromDate: from.dateTo, toDate: to.dateFrom });
    }

    // Index existing transit routes by (fromId, toId).
    var existingByKey = {};
    trip.routes.forEach(function (r) {
      if (!r) return;
      var sub = (typeof MaxMigration !== 'undefined' && MaxMigration.routeSubKind)
        ? MaxMigration.routeSubKind(r)
        : (r.subKind || (r.kind && r.kind !== 'route' ? r.kind : null));
      if (sub !== 'transit') return;
      var key = (r.fromDestId || '') + '|' + (r.toDestId || '');
      existingByKey[key] = r;
    });

    // Mark existing transit routes that are still expected; create
    // missing ones. Each expected pair gets a stable route id derived
    // from the endpoints so rebuilds don't churn.
    var keepIds = {};
    expected.forEach(function (pair) {
      var key = pair.fromId + '|' + pair.toId;
      var route = existingByKey[key];
      var routeId = 'r-tr-' + pair.fromId + '-' + pair.toId;
      if (!route) {
        if (typeof MaxMigration !== 'undefined' && MaxMigration.newRouteSegment) {
          route = MaxMigration.newRouteSegment(routeId, 'transit', pair.fromId, pair.toId, {
            startsAt: pair.fromDate || null,
            endsAt:   pair.toDate   || null
          });
        } else {
          route = {
            id:            routeId,
            kind:          'route',
            subKind:       'transit',
            fromDestId:    pair.fromId,
            toDestId:      pair.toId,
            modeOptions:   [],
            modeChosen:    null,
            transitDays:   [],
            durationHours: null,
            distKm:        null,
            character:     null,
            fuelStops:     [],
            planItems:     [],
            bookings:      [],
            notes:         '',
            startsAt:      pair.fromDate || null,
            endsAt:        pair.toDate   || null,
          };
        }
        trip.routes.push(route);
      } else {
        // Existing route — update segment date bounds in case the
        // destinations' dates shifted. Don't touch route.id (callers
        // may have references to it) and don't touch planItems[].
        if (pair.fromDate) route.startsAt = pair.fromDate;
        if (pair.toDate)   route.endsAt   = pair.toDate;
        // Force the canonical id so existence-by-key checks work in
        // future passes. (No-op on already-canonical ids.)
        // NOTE: not changing route.id mid-cycle — only on creation —
        // so this branch leaves it alone.
      }
      keepIds[route.id] = true;
    });

    // Drop transit routes whose (fromId, toId) is no longer adjacent.
    // (dayTrip / arrival / departure routes are immune — different subKind.)
    trip.routes = trip.routes.filter(function (r) {
      if (!r) return false;
      var sub = (typeof MaxMigration !== 'undefined' && MaxMigration.routeSubKind)
        ? MaxMigration.routeSubKind(r)
        : (r.subKind || (r.kind && r.kind !== 'route' ? r.kind : null));
      if (sub !== 'transit') return true;
      return !!keepIds[r.id];
    });
  }

  // ── SCAFFOLD-2: commitment state derivation ────────────────
  // Itinerary items pass through up to four states as the trip
  // firms up. The visual layer depends on this derivation; the
  // engine owns it so the rules are consistent across renderers.
  //
  //   tentative — Max put this here and the user hasn't engaged
  //               with it. Items get this on first auto-seed.
  //   confirmed — User has acknowledged the item (clicked Keep,
  //               edited it, dragged it, set a time, etc.). The
  //               default for legacy items + user-added items.
  //   booked    — A booking record is attached (sight reservation,
  //               restaurant reservation). Implies confirmed.
  //   done      — Already happened. Implies confirmed.
  //
  // Precedence (most-final → least-final):
  //   done > booked > tentative > confirmed
  // "done" wins over "booked" because a booking that's been
  // attended is finished, not still-pending.
  function commitmentState(s) {
    if (!s) return 'confirmed';
    if (s.done) return 'done';
    if (s.booking) return 'booked';
    if (s.tentative) return 'tentative';
    return 'confirmed';
  }

  // ── SCAFFOLD-3: decisions-deferred summary ─────────────────
  // Walks the trip and returns a structured list of unresolved
  // decisions the user hasn't made yet. Today's two categories:
  //   - tentative: per-destination count of items still in
  //     SCAFFOLD-2's tentative state (Max put it there, user
  //     hasn't engaged)
  //   - emptyDay: a destination + day pair where no items have
  //     been planned (and the destination has at least one item
  //     elsewhere — completely-empty destinations are a different
  //     scaffold problem)
  // Shape:
  //   {
  //     totalCount: number,
  //     items: [
  //       { kind: 'tentative', destId, destPlace, count },
  //       { kind: 'emptyDay',  destId, destPlace, dayId, dayLbl, dayIdx },
  //     ]
  //   }
  // Pure: doesn't read window globals, only the trip arg.
  function summarizeDecisionsDeferred(trip) {
    var out = { totalCount: 0, items: [] };
    if (!trip || !Array.isArray(trip.destinations)) return out;
    trip.destinations.forEach(function (dest) {
      if (!dest) return;
      var days = Array.isArray(dest.days) ? dest.days : [];
      // Tentative item count — sum across all days.
      var tentativeCount = 0;
      days.forEach(function (day) {
        var items = (day && Array.isArray(day.items)) ? day.items : [];
        items.forEach(function (it) {
          if (it && it.tentative && !it.done) tentativeCount++;
        });
      });
      if (tentativeCount > 0) {
        out.items.push({
          kind: 'tentative',
          destId: dest.id || null,
          destPlace: dest.place || dest.label || '',
          count: tentativeCount,
        });
        out.totalCount += tentativeCount;
      }
      // v353.2: previously skipped empty days for destinations with
      // ZERO items anywhere (comment said "entirely-empty
      // destination is its own thing"). That dropped legitimate
      // empty-day signals — e.g., a 1-day destination whose
      // suggestions failed to load is now invisible to the panel,
      // even though the user can see the empty day right in the
      // itinerary. Now we always count empty days, so dests with
      // failed loads or genuinely-blank itineraries surface for
      // attention. Cap per-dest at 5 so a never-loaded destination
      // with 10 nights doesn't bury the panel; a count of 5+ is
      // already enough to signal "this whole dest needs attention."
      var emptyForThisDest = 0;
      days.forEach(function (day, i) {
        var hasItems = day && Array.isArray(day.items) && day.items.length > 0;
        if (hasItems) return;
        if (emptyForThisDest >= 5) return;
        emptyForThisDest++;
        out.items.push({
          kind: 'emptyDay',
          destId: dest.id || null,
          destPlace: dest.place || dest.label || '',
          dayId: (day && day.id) || null,
          dayLbl: (day && day.lbl) || ('Day ' + (i + 1)),
          dayIdx: i,
        });
        out.totalCount += 1;
      });
    });
    return out;
  }

  // ── SCAFFOLD-6: surface the rationale ──────────────────────
  // Why N nights here? Reads what Max put on / nearby this dest
  // and writes a one-sentence explanation the user can read on
  // hover / click. Doesn't try to retro-derive the picker's
  // exact logic — it summarizes what's on the ground today, so
  // the user can see whether the night count fits the content.
  // Plain text, no HTML. Returns null when there's nothing
  // useful to say (very small dest, unset nights).
  function nightCountRationale(dest) {
    if (!dest) return null;
    var nights = dest.nights || 0;
    if (!nights) return null;
    // Count iconic sights already on days + still in suggestions.
    var iconicCount = 0;
    var iconicHours = 0;
    var totalSightHours = 0;
    var totalSightCount = 0;
    function tallySight(s) {
      if (!s || s.type !== 'sight') return;
      var hours = (typeof s.durationHours === 'number' && s.durationHours > 0) ? s.durationHours : 2;
      totalSightCount++;
      totalSightHours += hours;
      if (s.iconic) {
        iconicCount++;
        iconicHours += hours;
      }
    }
    (dest.suggestions || []).forEach(tallySight);
    (dest.days || []).forEach(function (day) {
      (day && day.items || []).forEach(tallySight);
    });
    var dayTripCount = Array.isArray(dest.dayTrips) ? dest.dayTrips.length : 0;
    var days = nights + 1; // standard: N nights = N+1 days
    var bits = [];
    if (iconicCount > 0) {
      bits.push(iconicCount + ' iconic sight' + (iconicCount === 1 ? '' : 's')
        + (iconicHours >= 4 ? ' (~' + Math.round(iconicHours) + ' hrs)' : ''));
    }
    if (dayTripCount > 0) {
      bits.push(dayTripCount + ' day trip' + (dayTripCount === 1 ? '' : 's'));
    }
    if (!bits.length) {
      // Nothing iconic and no day trips — keep it honest.
      return nights + ' night' + (nights === 1 ? '' : 's') + ' in ' + (dest.place || 'this destination')
        + '. Max didn’t flag anything iconic here yet — stretch the stay if you find more, or tighten it in Parameters.';
    }
    var primary = nights + ' night' + (nights === 1 ? '' : 's') + ' (' + days + ' day' + (days === 1 ? '' : 's')
      + ') gives you room for ' + bits.join(' plus ') + '.';
    // Add a calibration line if iconic hours imply tight or loose pacing.
    var iconicDays = iconicHours / 5; // ~5h of sights per full day
    var tail = '';
    if (iconicCount > 0) {
      if (iconicDays > days + 0.5) {
        tail = ' Tight at this length — consider stretching, or move sights to optional.';
      } else if (iconicDays < days - 1.5 && days >= 3) {
        tail = ' Loose pacing — plenty of room for unstructured time.';
      }
    }
    return primary + tail;
  }

  // ── SCAFFOLD-6 slice 2: per-day rationale ──────────────────
  // Why is THIS day shaped this way? Returns a one-liner about
  // day type (arrival/departure/full), the budget the auto-seed
  // works against, what's filling that budget, and whether the
  // day reads as light or full. Pure: only reads day, dayIdx,
  // and dest's day count.
  //
  // Day budget convention (matches _autoSeedIconicSightsToDays):
  //   - dayCount <= 1: 4 hours
  //   - first or last day:  4 hours (lighter for travel)
  //   - middle days:        6 hours
  function dayRationale(day, dayIdx, dest, tripArg) {
    if (!day || !dest) return null;
    var dayCount = Array.isArray(dest.days) ? dest.days.length : 0;
    if (!dayCount) return null;
    var isFirst = dayIdx === 0;
    var isLast  = dayIdx === dayCount - 1 && dayCount > 1;
    // v302: budget is the user's brief.hoursPerDay (default 6) — 4 on
    // travel days because landing at noon and racing to a 6-hour
    // cogwheel rarely works in practice. tripArg lets the caller pass
    // trip explicitly; falls back to global.trip if available so most
    // callers don't have to change.
    var trip = tripArg || global.trip || null;
    var hpd = (trip && trip.brief && typeof trip.brief.hoursPerDay === "number")
      ? trip.brief.hoursPerDay : 6;
    var travelBudget = Math.min(hpd, 4);
    var budget = (dayCount <= 1) ? travelBudget : (isFirst || isLast ? travelBudget : hpd);
    var dayType = (dayCount === 1) ? 'single day'
                : (isFirst ? 'arrival day'
                : (isLast ? 'departure day'
                : 'full day'));
    var items = (Array.isArray(day.items) ? day.items : []);
    var sights    = items.filter(function (i) { return i && i.type === 'sight'; });
    var dayTrips  = items.filter(function (i) { return i && i.type === 'daytrip'; });
    var rests     = items.filter(function (i) { return i && i.type === 'restaurant'; });
    // v302: rationale now credits the user's brief.hoursPerDay setting
    // (or notes the default if the brief doesn't have one yet) and
    // names the big-sight cap. Both come from Parameters / brief.
    var maxBig = (trip && trip.brief && typeof trip.brief.maxBigSightsPerDay === "number")
      ? trip.brief.maxBigSightsPerDay : 2;
    var hpdLabel = (trip && trip.brief && typeof trip.brief.hoursPerDay === "number") ? '' : ' (default — set yours in Parameters)';
    var assumption = 'You set Max to ~' + budget + 'h of sightseeing on a ' + dayType
      + hpdLabel
      + ', with at most ' + maxBig + ' big sight' + (maxBig === 1 ? '' : 's') + ' (2+ hrs) per day. You can always set a time on a sight, or add or remove sights on a given day. To shift the daily budget, edit Parameters.';
    if (!items.length) {
      return 'Open ' + dayType + ' — nothing planned yet. Drag a sight from Explore, or leave it loose for unstructured time.';
    }
    if (dayTrips.length) {
      var dt = dayTrips[0];
      return 'Day-trip day to ' + (dt.dayTripPlace || dt.n || 'another town') + ' — leaves the hub, returns by evening. '
        + (sights.length ? 'Plus ' + sights.length + ' sight' + (sights.length === 1 ? '' : 's') + ' for the rest of the day. ' : '')
        + assumption;
    }
    var totalHours = sights.reduce(function (sum, it) {
      return sum + ((typeof it.durationHours === 'number' && it.durationHours > 0) ? it.durationHours : 2);
    }, 0);
    var longSight = sights.find(function (it) { return (it.durationHours || 0) >= 4; });
    if (longSight) {
      var others = sights.filter(function (it) { return it !== longSight; });
      var tail = others.length
        ? ' Pairs with ' + others.map(function (i) { return i.n; }).join(', ') + '.'
        : '';
      return 'Long-sight day — ' + (longSight.n || 'this sight') + ' is ~' + (longSight.durationHours || '4+')
        + 'h, which mostly fills the ' + dayType + '.' + tail + ' ' + assumption;
    }
    var pct = totalHours / budget;
    var headline;
    var sightList = sights.map(function (i) { return i.n; }).join(', ');
    if (pct >= 0.85) {
      headline = dayType.charAt(0).toUpperCase() + dayType.slice(1) + ' — full at ~' + Math.round(totalHours)
        + 'h: ' + sightList + '.';
    } else if (pct >= 0.45) {
      headline = dayType.charAt(0).toUpperCase() + dayType.slice(1) + ' — ~' + Math.round(totalHours)
        + 'h of ' + (sights.length === 1 ? 'a sight' : sights.length + ' sights')
        + ': ' + sightList + '. Room to add or extend.';
    } else {
      headline = 'Light ' + dayType + ' — only ~' + Math.round(totalHours) + 'h scheduled. '
        + (sightList ? sightList + '. ' : '')
        + 'Plenty of room to add more or keep it loose.';
    }
    if (rests.length) {
      headline += ' ' + rests.length + ' restaurant note' + (rests.length === 1 ? '' : 's') + ' attached.';
    }
    return headline + ' ' + assumption;
  }

  // ── SCAFFOLD-6 slice 3: neighborhood / hotel district ──────
  // The LLM already returned `good` and `bad` for each district
  // when it generated city data. neighborhoodRationale composes
  // them into a single popover line. No new LLM call.
  function neighborhoodRationale(district) {
    if (!district) return null;
    var bits = [];
    if (district.good) bits.push('Good: ' + String(district.good).trim());
    if (district.bad)  bits.push('Tradeoff: ' + String(district.bad).trim());
    if (!bits.length) return null;
    return bits.join(' · ');
  }

  // ── SCAFFOLD-6 slice 4: transit choice ─────────────────────
  // Composes a one-liner from the routing-options structure that
  // buildTransportChip already consumes. The chip itself only
  // shows the top option's headline; the popover spells out
  // "Bus picked over flight: 2.5h direct vs 1h flight + 2h
  // airport transit" for users who want to know why.
  function transitRationale(routing, fromPlace, toPlace) {
    if (!routing || !Array.isArray(routing.options) || !routing.options.length) {
      return null;
    }
    var picked = routing.options[0];
    var alts = routing.options.slice(1, 3);
    var label = (fromPlace && toPlace) ? (fromPlace + ' → ' + toPlace + ': ') : '';
    var head = label + (picked.name || 'Top option') + (picked.meta ? ' (' + picked.meta + ')' : '') + '.';
    if (!alts.length) return head + ' Only one practical option.';
    var altLines = alts.map(function (a) {
      return (a.name || 'Other') + (a.meta ? ' (' + a.meta + ')' : '');
    });
    return head + ' Picked over: ' + altLines.join('; ') + '.';
  }

  // ── SCAFFOLD-6 slice 5: sight-on-day placement ─────────────
  // Why is THIS sight on THIS day? Reads from auto-seed signals
  // (autoSeeded, durationHours, day's slot, day index) plus the
  // sight's iconic flag. Plain text or null.
  function sightPlacementRationale(item, day, dayIdx, dest) {
    if (!item || !day || !dest) return null;
    if (item.type !== 'sight') return null;
    var dayCount = Array.isArray(dest.days) ? dest.days.length : 0;
    var isFirst = dayIdx === 0;
    var isLast  = dayIdx === dayCount - 1 && dayCount > 1;
    var dayType = (dayCount === 1) ? 'the only day'
                : (isFirst ? 'arrival day'
                : (isLast ? 'departure day'
                : 'a full day'));
    var dur = (typeof item.durationHours === 'number' && item.durationHours > 0)
      ? item.durationHours : 2;
    var bits = [];
    if (item.iconic) bits.push('Max flagged this iconic — first-time visitors miss it at their peril');
    if (dur >= 4) {
      bits.push('it’s ~' + dur + 'h, which mostly fills a day');
    } else if (dur >= 2) {
      bits.push('it’s ~' + dur + 'h, pairs with one other thing');
    } else {
      bits.push('it’s short (~' + dur + 'h), fits alongside a longer sight');
    }
    if (item.autoSeeded) {
      bits.push('placed on ' + dayType + ' to match the day’s budget');
    } else {
      bits.push('you placed this');
    }
    return bits.join('. ').replace(/\.\s*$/, '') + '.';
  }

  // ── SCAFFOLD-5: real-time daily mode — trip status ─────────
  // Where is the user in the trip's calendar right now? Returns
  // a structured object the UI uses to:
  //   - Show a "Today" banner during the trip
  //   - Pre-arrival nudges (SCAFFOLD-4 reuses this same helper)
  //   - Auto-jump to the current day's itinerary
  //
  // today defaults to a YYYY-MM-DD string for the local date if
  // omitted; pass a string for testing.
  //
  // Output shape:
  //   {
  //     phase: 'before' | 'during' | 'after' | 'unscheduled',
  //     daysUntilStart?: number,  // before
  //     daysUntilEnd?:   number,  // during (incl. today as 1)
  //     dayNumber?:      number,  // during, 1-indexed
  //     totalDays?:      number,
  //     currentDestId?:  string,
  //     currentDestPlace?: string,
  //     currentDayId?:   string,
  //   }
  function currentTripStatus(trip, today) {
    var unscheduled = { phase: 'unscheduled' };
    if (!trip || !Array.isArray(trip.destinations) || !trip.destinations.length) {
      return unscheduled;
    }
    if (!today) {
      var d = new Date();
      var mm = String(d.getMonth() + 1).padStart ? String(d.getMonth() + 1).padStart(2, '0') : (('0' + (d.getMonth() + 1)).slice(-2));
      var dd = String(d.getDate()).padStart ? String(d.getDate()).padStart(2, '0') : (('0' + d.getDate()).slice(-2));
      today = d.getFullYear() + '-' + mm + '-' + dd;
    }
    // Find first dest with a real dateFrom + last dest with a real dateTo.
    var first = null, last = null;
    for (var i = 0; i < trip.destinations.length; i++) {
      if (trip.destinations[i] && trip.destinations[i].dateFrom) { first = trip.destinations[i]; break; }
    }
    for (var j = trip.destinations.length - 1; j >= 0; j--) {
      if (trip.destinations[j] && trip.destinations[j].dateTo) { last = trip.destinations[j]; break; }
    }
    if (!first || !last) return unscheduled;
    var startStr = first.dateFrom;
    var endStr   = last.dateTo;
    function diffDays(aStr, bStr) {
      // Both 'YYYY-MM-DD' — compute b - a in days.
      var a = new Date(aStr + 'T12:00:00');
      var b = new Date(bStr + 'T12:00:00');
      return Math.round((b - a) / 86400000);
    }
    if (today < startStr) {
      return { phase: 'before', daysUntilStart: diffDays(today, startStr) };
    }
    if (today > endStr) {
      return { phase: 'after' };
    }
    // We're during the trip. Find current destination + day.
    var current = null;
    for (var k = 0; k < trip.destinations.length; k++) {
      var dst = trip.destinations[k];
      if (!dst || !dst.dateFrom || !dst.dateTo) continue;
      if (today >= dst.dateFrom && today <= dst.dateTo) { current = dst; break; }
    }
    var totalDays = diffDays(startStr, endStr) + 1;
    var dayNumber = diffDays(startStr, today) + 1;
    var daysUntilEnd = diffDays(today, endStr) + 1;
    var out = {
      phase: 'during',
      daysUntilEnd: daysUntilEnd,
      dayNumber: dayNumber,
      totalDays: totalDays,
    };
    if (current) {
      out.currentDestId = current.id || null;
      out.currentDestPlace = current.place || current.label || '';
      // Match the day inside the destination — by date when available,
      // else by relative index from dateFrom.
      var dayIdx = diffDays(current.dateFrom, today);
      var days = Array.isArray(current.days) ? current.days : [];
      if (days[dayIdx]) {
        out.currentDayId = days[dayIdx].id || null;
        out.currentDayLbl = days[dayIdx].lbl || null;
      }
    }
    return out;
  }

  // ── SCAFFOLD-5 slice 2: now/next ───────────────────────────
  // Splits a day's items into past / current / next / later /
  // untimed buckets based on item timeStart/timeEnd vs a clock.
  // Pure: doesn't read window globals; pass `now` (HH:MM) for
  // testability or omit to use current local time.
  //
  // Output:
  //   {
  //     past:    item[],   // timeEnd < now
  //     current: item[],   // timeStart <= now <= timeEnd
  //     next:    item|null,// soonest upcoming
  //     later:   item[],   // upcoming after `next`
  //     untimed: item[],   // no timeStart and no timeEnd
  //   }
  function currentDayItems(day, now) {
    var out = { past: [], current: [], next: null, later: [], untimed: [] };
    if (!day) return out;
    var items = Array.isArray(day.items) ? day.items : [];
    if (!now) {
      var d = new Date();
      var hh = ('0' + d.getHours()).slice(-2);
      var mm = ('0' + d.getMinutes()).slice(-2);
      now = hh + ':' + mm;
    }
    var upcoming = [];
    items.forEach(function (it) {
      if (!it) return;
      var s = it.timeStart || '';
      var e = it.timeEnd   || '';
      if (!s && !e) { out.untimed.push(it); return; }
      // Treat one-sided times as a point in time.
      var startCmp = s || e;
      var endCmp   = e || s;
      if (endCmp < now) out.past.push(it);
      else if (startCmp <= now && now <= endCmp) out.current.push(it);
      else upcoming.push(it);
    });
    upcoming.sort(function (a, b) {
      var sa = a.timeStart || a.timeEnd || '';
      var sb = b.timeStart || b.timeEnd || '';
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    out.next  = upcoming.length ? upcoming[0] : null;
    out.later = upcoming.length > 1 ? upcoming.slice(1) : [];
    return out;
  }

  // Minutes between two 'HH:MM' clock strings (b - a). Returns
  // null if either is malformed.
  function clockMinutesBetween(a, b) {
    function toMin(t) {
      if (!t || typeof t !== 'string') return null;
      var p = t.split(':');
      if (p.length !== 2) return null;
      var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
      if (!isFinite(h) || !isFinite(m)) return null;
      return h * 60 + m;
    }
    var ma = toMin(a), mb = toMin(b);
    if (ma === null || mb === null) return null;
    return mb - ma;
  }

  // ── SCAFFOLD-4: pre-arrival action items ───────────────────
  // When the user is in the 'before' phase of a trip, surface a
  // structured list of LOGISTICAL decisions worth firming up
  // before departure: unbooked hotels per destination, unbooked
  // transit legs between destinations.
  //
  // v313: empty days REMOVED from this list. Empty days are
  // CONTENT decisions (what to do that day) and live in
  // summarizeDecisionsDeferred (SCAFFOLD-3). Keeping them in
  // both surfaces double-counted them and blurred the
  // pre-arrival = mechanics / decisions-deferred = content
  // distinction.
  //
  // Returns null when currentTripStatus says we're not in the
  // 'before' phase; lets the caller suppress the banner uniformly.
  //
  // Output:
  //   {
  //     daysUntilStart: number,
  //     items: [
  //       { kind: 'hotelMissing',   destId, destPlace },
  //       { kind: 'transitMissing', fromId, toId, fromPlace, toPlace },
  //     ]
  //   }
  function preArrivalActions(trip, today) {
    var status = currentTripStatus(trip, today);
    if (!status || status.phase !== 'before') return null;
    var out = { daysUntilStart: status.daysUntilStart, items: [] };
    var dests = (trip && trip.destinations) || [];
    // Unbooked hotels — destination has no hotel booking with status === 'booked'.
    dests.forEach(function (dest) {
      if (!dest) return;
      var bks = Array.isArray(dest.hotelBookings) ? dest.hotelBookings : [];
      var hasBooked = bks.some(function (b) { return b && b.status === 'booked'; });
      if (!hasBooked) {
        out.items.push({
          kind: 'hotelMissing',
          destId: dest.id || null,
          destPlace: dest.place || dest.label || '',
        });
      }
    });
    // Unbooked transit legs between adjacent destinations. We walk
    // pairs in sequence rather than the trip.legs map because a
    // missing key in trip.legs is the same as "unbooked" for our
    // purposes — the leg exists conceptually whether or not a
    // record has been created yet.
    var legs = (trip && trip.legs) || {};
    for (var i = 0; i < dests.length - 1; i++) {
      var from = dests[i], to = dests[i + 1];
      if (!from || !to) continue;
      var key1 = (from.id || '') + '__' + (to.id || '');
      var key2 = (from.id || '') + '→' + (to.id || '');
      var leg = legs[key1] || legs[key2];
      var legBks = (leg && Array.isArray(leg.bookings)) ? leg.bookings : [];
      var legBooked = legBks.some(function (b) { return b && b.status === 'booked'; });
      if (!legBooked) {
        out.items.push({
          kind: 'transitMissing',
          fromId: from.id || null,
          toId:   to.id || null,
          fromPlace: from.place || from.label || '',
          toPlace:   to.place || to.label || '',
        });
      }
    }
    return out;
  }

  // ── v356.1: pending-actions scanner for reminders ──────────
  // Returns { daysUntilDeparture, items } for a trip:
  //   daysUntilDeparture: integer days from `now` to first
  //     destination's dateFrom. Negative if past, null if no dates.
  //   items: array of { kind, summary, severity }, sorted high→
  //     low severity then by kind so identical inputs produce
  //     identical output (de-dupe-friendly at email-send time).
  //
  // This powers (a) the home-screen "X days, Y to do" banner and
  // (b) the daily server cron's reminder emails. Pure — `now` is
  // a Date argument so tests are deterministic. The helper does
  // not mutate the trip and does not call the LLM.
  function computePendingActions(trip, now) {
    now = now || new Date();
    var dests = (trip && trip.destinations) || [];

    // ── days-until-departure ─────────────────────────────────
    var daysUntilDeparture = null;
    var first = dests[0];
    var firstFrom = first && first.dateFrom;
    if (firstFrom) {
      var depDate = new Date(firstFrom);
      if (!isNaN(depDate.getTime())) {
        daysUntilDeparture = Math.floor((depDate - now) / 86400000);
      }
    }

    var items = [];

    // ── hotel gaps ───────────────────────────────────────────
    dests.forEach(function (dest) {
      if (!dest) return;
      var nights = (typeof dest.nights === 'number') ? dest.nights : 0;
      if (nights < 1) return; // skip transit / day-trip-only stops
      var bks = Array.isArray(dest.hotelBookings) ? dest.hotelBookings : [];
      var hasBooked = bks.some(function (b) { return b && b.status === 'booked'; });
      if (!hasBooked) {
        var place = dest.place || dest.label || 'unknown';
        items.push({
          kind: 'hotel',
          summary: 'Book hotel for ' + place + ' (' + nights + ' night' + (nights === 1 ? '' : 's') + ')',
          severity: 'high',
        });
      }
    });

    // ── transport gaps between adjacent destinations ─────────
    var legs = (trip && trip.legs) || {};
    for (var i = 0; i < dests.length - 1; i++) {
      var from = dests[i], to = dests[i + 1];
      if (!from || !to) continue;
      var key = (from.id || '') + '>' + (to.id || '');
      var leg = legs[key];
      if (!leg || !leg.mode) {
        items.push({
          kind: 'transport',
          summary: 'Plan how to get from ' + (from.place || from.label || 'previous') +
                   ' to ' + (to.place || to.label || 'next'),
          severity: 'high',
        });
      }
    }

    // ── day-trip arrangements ────────────────────────────────
    dests.forEach(function (dest) {
      if (!dest) return;
      var dts = Array.isArray(dest.dayTrips) ? dest.dayTrips : [];
      dts.forEach(function (dt) {
        if (!dt) return;
        var hasNote = !!(dt.note && String(dt.note).trim().length);
        var hasBooking = !!(dt.booking || (Array.isArray(dt.bookings) && dt.bookings.length));
        if (!hasNote && !hasBooking) {
          var dtName = dt.place || dt.name || dt.n || 'destination';
          var hub = dest.place || dest.label || 'hub';
          items.push({
            kind: 'daytrip',
            summary: 'Arrange day trip to ' + dtName + ' from ' + hub,
            severity: 'medium',
          });
        }
      });
    });

    // ── open pending actions ─────────────────────────────────
    var pending = (trip && Array.isArray(trip.pendingActions)) ? trip.pendingActions : [];
    pending.forEach(function (pa) {
      if (!pa || pa.cleared) return;
      var actionType = pa.actionType || 'review';
      var eventName = pa.eventName || pa.name || 'item';
      items.push({
        kind: 'pending',
        summary: actionType.charAt(0).toUpperCase() + actionType.slice(1) + ' — ' + eventName,
        severity: 'high',
      });
    });

    // ── iconic + approx-address sights — bundled ─────────────
    var approxIconic = 0;
    dests.forEach(function (dest) {
      if (!dest) return;
      var sugs = Array.isArray(dest.suggestions) ? dest.suggestions : [];
      sugs.forEach(function (s) {
        if (s && s.iconic && s.approx) approxIconic++;
      });
    });
    if (approxIconic > 0) {
      items.push({
        kind: 'sights',
        summary: approxIconic + ' must-see sight' + (approxIconic === 1 ? '' : 's') +
                 ' still missing an address',
        severity: 'low',
      });
    }

    // ── stable sort: severity (high→medium→low) then kind ────
    var sevRank = { high: 0, medium: 1, low: 2 };
    items.sort(function (a, b) {
      var da = sevRank[a.severity] != null ? sevRank[a.severity] : 99;
      var db = sevRank[b.severity] != null ? sevRank[b.severity] : 99;
      if (da !== db) return da - db;
      if (a.kind < b.kind) return -1;
      if (a.kind > b.kind) return 1;
      return 0;
    });

    return { daysUntilDeparture: daysUntilDeparture, items: items };
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
    syncTransitRoutes:           syncTransitRoutes,

    // ── Round HR: trip-engine helpers previously inline ───────
    makeDays:       makeDays,
    getCityCenter:  getCityCenter,

    // ── SCAFFOLD-2: commitment-state derivation ───────────────
    commitmentState: commitmentState,

    // ── SCAFFOLD-3: decisions-deferred summary ────────────────
    summarizeDecisionsDeferred: summarizeDecisionsDeferred,

    // ── SCAFFOLD-6: surface the rationale ─────────────────────
    nightCountRationale:      nightCountRationale,
    dayRationale:             dayRationale,
    neighborhoodRationale:    neighborhoodRationale,
    transitRationale:         transitRationale,
    sightPlacementRationale:  sightPlacementRationale,

    // ── SCAFFOLD-5: real-time daily mode ──────────────────────
    currentTripStatus:        currentTripStatus,
    currentDayItems:          currentDayItems,
    clockMinutesBetween:      clockMinutesBetween,

    // ── SCAFFOLD-4: pre-arrival action items ─────────────────
    preArrivalActions:        preArrivalActions,

    // ── v356.1: pending-actions scanner (banner + email) ─────
    computePendingActions:    computePendingActions,

    // ── HY (path-to-10:A): mutator surface ───────────────────
    // Eleven mutators that already emit tripChange + mapDataChange
    // through the inline _emitTripMutation helper. Exposed here
    // as delegators so engine consumers (mobile, future tooling)
    // have a stable surface to drive changes from. The bodies
    // stay inline for now — they reference inline-script globals
    // (destCtr, _ftRecomputeTripDates, autoSave, _coarseGeocode,
    // ensureCoarseGeocode, etc.) that aren't trivially liftable.
    // Path-to-10's "engine-trip.js DOM-free" criterion is met
    // (zero document/drawXxx/g() refs in this file); this round
    // closes Item A by giving the namespace surface the doc
    // promised.
    addBufferNight:           function (side, city)             { return global.addBufferNight && global.addBufferNight(side, city); },
    reverseTripOrder:         function ()                       { return global.reverseTripOrder && global.reverseTripOrder(); },
    delDest:                  function (e, id)                  { return global.delDest && global.delDest(e, id); },
    applyDateChange:          function (dest, from, to, aff)    { return global.applyDateChange && global.applyDateChange(dest, from, to, aff); },
    executeMoveDest:          function (dest, fromIdx, toIdx)   { return global.executeMoveDest && global.executeMoveDest(dest, fromIdx, toIdx); },
    addDayTripToDay:          function (hub, dtIdx, dayIdx)     { return global.addDayTripToDay && global.addDayTripToDay(hub, dtIdx, dayIdx); },
    removeDayTripFromDay:     function (hub, place)             { return global.removeDayTripFromDay && global.removeDayTripFromDay(hub, place); },
    removeDayTripFromDayItem: function (hub, place, dayIdx)     { return global.removeDayTripFromDayItem && global.removeDayTripFromDayItem(hub, place, dayIdx); },
    makeDayTrip:              function (hub, src, opts)         { return global.makeDayTrip && global.makeDayTrip(hub, src, opts); },
    ungroupDayTrip:           function (hub, dtIdx, opts)       { return global.ungroupDayTrip && global.ungroupDayTrip(hub, dtIdx, opts); },
    schedulePeerDayTrip:      function (hub, target, dayIdx, d) { return global._ftSchedulePeerDayTrip && global._ftSchedulePeerDayTrip(hub, target, dayIdx, d); },

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
      // v352.1: ONLY adopt this write if the user is currently viewing
      // the trip that was just written. This is the architectural
      // intent stated in the comment block above (and at line 1576-
      // 1580: "if (currentTripId !== id) return;") — the check just
      // never got implemented. Without it, when sync.js pulls a
      // batch of trips from the server, each pulled trip's
      // tripWritten event would clobber global.trip with whatever
      // landed last. The user would be looking at trip A, the
      // desktop's open view would silently swap to trip C's data
      // (visible as scrambled destinations + dates), and any
      // subsequent local edit would push trip C's contents up
      // under trip A's ID — server-side corruption. The guard
      // limits the in-memory adoption to the active trip only;
      // localStorage already has the bytes for the others (writeRaw
      // ran before this listener) so the trip list stays correct
      // and re-opening any of them reads fresh data.
      //
      // No-active-trip case (home screen, freshly loaded app):
      // also skip. The home screen renders from the trips index,
      // not from global.trip; setting global.trip here would
      // pollute the picker→trip handoff that happens later. The
      // picker's publishTrip flow sets _currentTripId first
      // (engine-picker.js line 1321) and THEN writes — so by the
      // time tripWritten fires for that path, _currentTripId is
      // already set and matches.
      var activeId = global._currentTripId;
      if (!activeId || payload.id !== activeId) return;
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
  // SCAFFOLD-2: also expose as bare global so trip-ui.js + inline
  // renderers can call it without going through the namespace.
  global.commitmentState = commitmentState;
  // SCAFFOLD-3: same — bare global for inline drawTripMode.
  global.summarizeDecisionsDeferred = summarizeDecisionsDeferred;
  // SCAFFOLD-6: bare global for the dest-card popover.
  global.nightCountRationale = nightCountRationale;
  global.dayRationale = dayRationale;
  global.neighborhoodRationale = neighborhoodRationale;
  global.transitRationale = transitRationale;
  global.sightPlacementRationale = sightPlacementRationale;
  // SCAFFOLD-5: bare global for drawTripMode banner.
  global.currentTripStatus = currentTripStatus;
  global.currentDayItems = currentDayItems;
  global.clockMinutesBetween = clockMinutesBetween;
  // SCAFFOLD-4: bare global for drawTripMode banner.
  global.preArrivalActions = preArrivalActions;
  global.computePendingActions = computePendingActions;

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
