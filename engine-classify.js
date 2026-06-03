// engine-classify.js — Place classification (PD.205, Phase 1 of the
// classifier rollout described in place-classification-spec.md).
//
// This file ships the *pure function* `classifyListEntries(entries, opts)`
// that takes parsed wish-list entries from `parsePlacesList()` and decides,
// for each one, exactly which of five shapes it has:
//
//   region | city | poi | activity | role-tag
//
// For POIs it also decides parentage: which in-list city is the parent
// (or whether one needs to be auto-created), and whether the relationship
// to that parent is `within` (in-city sight) or `from` (day-trip sight).
//
// PD.205 lands ONLY the function + unit tests. Wire-up to the picker
// happens in PD.206 (parser fallback removed; classifier output feeds
// publishTrip); the dedup invariant lands in PD.207.
//
// Design choices:
//
//   * The LLM call is injectable (opts.llm). In production the function
//     defaults to `global.callMax`; in tests we pass a stub that returns
//     canned JSON. This keeps the function unit-testable without a
//     network or an API key.
//
//   * If no LLM is available AND no opts.llm is passed, the function
//     falls back to a small heuristic classifier so the trip-build path
//     never blocks on a missing key. The heuristic is intentionally
//     conservative — it catches the obvious activity/role-tag cases
//     and defaults to `city` for everything else, matching the existing
//     parser's behavior.
//
//   * Parentage rules implement Part 1 of the spec:
//
//       1. POI + viable in-list parent  → sight under that parent
//       2. POI + no in-list parent but a real city it sits in
//                                       → auto-create the parent
//       3. POI + no parent at all       → standalone destination
//
//     "Viable in-list parent" is name-matched (case-insensitive,
//     accent-folded via _normPlaceName when available). PD.205 does
//     not yet enforce the drive-time and minimum-stay constraints
//     from the spec — those need the geocoder integration that will
//     land separately. Today the LLM's `parentCity` is taken at face
//     value when it points at an in-list entry.
//
//   * `parentRelation` defaults to `within` if the LLM didn't say.
//     The bias matches the everyday case (Harpa, Hallgrímskirkja,
//     Sun Voyager are all `within` Reykjavík); `from` requires the
//     LLM to assert it explicitly.

(function (global) {
  'use strict';

  // Normalizer for name-matching. Prefer the engine-trip version when
  // it's been loaded (strips diacritics, normalizes Saint→St, etc.);
  // fall back to a simple lowercase+trim so this file works standalone
  // in tests that don't preload engine-trip.
  function _norm(s) {
    if (s == null) return '';
    var str = String(s);
    if (typeof global._normPlaceName === 'function') {
      try { return global._normPlaceName(str); } catch (_) {}
    }
    return str.toLowerCase().trim();
  }

  // The five classification shapes the spec defines.
  var VALID_CLASSIFICATIONS = {
    region: true,
    city: true,
    poi: true,
    activity: true,
    'role-tag': true
  };

  // ── Heuristic fallback ─────────────────────────────────────────
  // Used only when no LLM is available. Conservative on purpose —
  // we'd rather over-classify as `city` (current behavior) than
  // hallucinate the wrong bucket.

  var ACTIVITY_VERB_PREFIX =
    /^(drive|drives|driving|walk|walks|walking|hike|hikes|hiking|explore|explores|exploring|see|sees|seeing|visit|visits|visiting|swim|swims|swimming|eat|eats|eating|try|tries|trying|tour|tours|touring|stroll|wander|relax|shop|shopping|ski|kayak|cycle|bike|sail|fish|climb)\b/i;

  var ROLE_TAG_HINT =
    /\b(place to (stay|sleep|eat|drink)|anywhere with|somewhere (with|to)|need (a |to )|looking for|want (a |to ))/i;

  function heuristicClassify(entry) {
    var raw = (entry && entry.place ? String(entry.place) : '').trim();
    if (!raw) return { classification: 'city' };
    if (ACTIVITY_VERB_PREFIX.test(raw)) return { classification: 'activity' };
    if (ROLE_TAG_HINT.test(raw))        return { classification: 'role-tag' };
    return { classification: 'city' };
  }

  // ── Prompt builder ─────────────────────────────────────────────

  function buildClassifierPrompt(entries, region) {
    var lines = entries.map(function (e, i) {
      var place = (e && e.place) ? String(e.place) : '';
      return (i + 1) + '. ' + place;
    }).join('\n');

    var regionHint = region
      ? '\n\nTrip focus: ' + String(region) + '. Use this when guessing a POI\'s parent city.'
      : '';

    return [
      'Classify each entry on this travel wish-list as exactly ONE of:',
      '  - region: a multi-city geographic area (e.g., "Tuscany", "Westfjords")',
      '  - city: a multi-night base where a traveler would sleep (e.g., "Reykjavík", "Florence")',
      '  - poi: a single place to visit (e.g., "Harpa Concert Hall", "Uffizi", "Geysir")',
      '  - activity: a thing to do that has no single fixed place (e.g., "Drive the Ring Road", "Walk on black sand beaches")',
      '  - role-tag: a need or wish with no specific place attached (e.g., "Place to stay overnight", "Anywhere with northern lights")',
      '',
      'For each POI, ALSO return:',
      '  - parentCity: the name of the city the POI sits in or is reached from. Leave null if you genuinely don\'t know.',
      '  - parentRelation: "within" if the POI is inside that city\'s walkable footprint; "from" if it is a day-trip distance away (roughly >20 minutes drive one-way). Default to "within" only when you are confident.',
      '',
      'ACCURACY RULE: WRONG INFORMATION IS WORSE THAN NO INFORMATION. If you are unsure about parentCity, return null and leave parentRelation null.',
      '',
      'Entries:',
      lines + regionHint,
      '',
      'Return a JSON array ONLY (no prose, no markdown fences). One object per entry, in the same order, indexed from 1. Schema:',
      '[',
      '  {"i": 1, "classification": "city", "parentCity": null, "parentRelation": null},',
      '  {"i": 2, "classification": "poi", "parentCity": "Reykjavík", "parentRelation": "within"}',
      ']'
    ].join('\n');
  }

  // ── Response parser ────────────────────────────────────────────
  // Strips markdown fences, parses, and tolerates truncation by
  // closing a dangling array. Returns [] if nothing recoverable.

  function parseClassifierResponse(raw) {
    var cleaned = String(raw || '').replace(/```json|```/g, '').trim();
    if (!cleaned) return [];

    function tryParse(s) {
      try { return JSON.parse(s); } catch (_) { return null; }
    }

    var parsed = tryParse(cleaned);
    if (Array.isArray(parsed)) return parsed;

    // Recovery: chop to last complete object and close the array.
    var lastClose = cleaned.lastIndexOf('}');
    if (lastClose > 0) {
      var recovered = tryParse(cleaned.slice(0, lastClose + 1) + ']');
      if (Array.isArray(recovered)) return recovered;
    }
    return [];
  }

  // ── Parentage rules (Part 1 of the spec) ──────────────────────
  //
  // Given the parsed entries and a per-entry classification, decide
  // for each POI whether it parents to an in-list city, requires an
  // auto-created parent, or gets promoted to a standalone destination.

  function applyParentageRules(entries, classifications) {
    // Index in-list cities + regions by normalized name.
    var cityIndex = {};
    classifications.forEach(function (c, i) {
      if (!c) return;
      var kind = c.classification;
      if (kind === 'city' || kind === 'region') {
        var key = _norm(entries[i] && entries[i].place);
        if (key) cityIndex[key] = i;
      }
    });

    return entries.map(function (entry, i) {
      var raw = classifications[i] || {};
      var classification = VALID_CLASSIFICATIONS[raw.classification]
        ? raw.classification
        : 'city';

      // PD.215: respect explicit user intent from the parser. If the
      // user listed this entry under an explicit stay-header (or
      // tagged it stay), don't let the LLM downgrade it to a poi —
      // they said it's a stay. Same in reverse for see-header entries
      // that the LLM might want to call a city.
      //
      // The LLM still gets to refine WITHIN the user's choice:
      //   _userIntent:"stay" → keep region|city (LLM picks which)
      //   _userIntent:"see"  → force poi (LLM picks parent + relation)
      //   _userIntent:null   → trust the LLM fully
      var ui = entry && entry._userIntent;
      if (ui === 'stay') {
        if (classification !== 'region' && classification !== 'city') {
          classification = 'city';
        }
      } else if (ui === 'see') {
        classification = 'poi';
      }

      var out = {
        // Pass through everything the parser already produced so this
        // function is non-destructive — downstream code keeps reading
        // the same fields it always has.
        place: entry && entry.place,
        nights: entry && entry.nights,
        isStay: entry && entry.isStay,
        intent: entry && entry.intent,

        classification: classification,
        parentEntry: null,        // normalized parent name (lookup key)
        parentRelation: null,     // 'within' | 'from'
        promotedToDestination: false,
        autoCreatedParent: null   // original-cased parent name (display)
      };

      if (classification !== 'poi') return out;

      var parentName = (raw.parentCity == null) ? '' : String(raw.parentCity).trim();
      var parentKey = _norm(parentName);
      var relation = (raw.parentRelation === 'from') ? 'from' : 'within';

      if (parentKey && Object.prototype.hasOwnProperty.call(cityIndex, parentKey)) {
        // Step 1: viable in-list parent.
        out.parentEntry = parentKey;
        out.parentRelation = relation;
      } else if (parentName) {
        // Step 2: LLM knows the parent city, but it's not in the list.
        // Flag for auto-creation in the wire-up pass (PD.206).
        out.parentEntry = parentKey;
        out.parentRelation = relation;
        out.autoCreatedParent = parentName;
      } else {
        // Step 3: no parent at all — promote to standalone destination.
        out.promotedToDestination = true;
      }

      return out;
    });
  }

  // ── Public entry point ────────────────────────────────────────

  async function classifyListEntries(entries, opts) {
    opts = opts || {};
    if (!Array.isArray(entries) || entries.length === 0) return [];

    var llm = (typeof opts.llm === 'function') ? opts.llm
            : (typeof global.callMax === 'function') ? global.callMax
            : null;
    var region = opts.region || null;

    var classifications;
    if (llm) {
      var prompt = buildClassifierPrompt(entries, region);
      var raw = '';
      try {
        raw = await llm([{ role: 'user', content: prompt }], 2000);
      } catch (e) {
        // LLM error — fall through to heuristic so the trip build
        // never gets stuck. The wire-up layer (PD.206) can decide
        // whether to retry or surface the failure to the user.
        classifications = entries.map(heuristicClassify);
      }
      if (!classifications) {
        var arr = parseClassifierResponse(raw);
        // Align by index 1..N. If the model returned a short array,
        // missing slots fall back to heuristic so we don't lose
        // entries silently.
        classifications = entries.map(function (entry, i) {
          var match = arr.find(function (x) { return x && Number(x.i) === i + 1; });
          if (match && VALID_CLASSIFICATIONS[match.classification]) return match;
          return heuristicClassify(entry);
        });
      }
    } else {
      classifications = entries.map(heuristicClassify);
    }

    return applyParentageRules(entries, classifications);
  }

  // ── PD.206 wire-up helper ─────────────────────────────────────
  //
  // Apply classifier output to a parser-style entries list. Mutates
  // each entry's isStay/nights based on classification and inserts
  // auto-created parent entries for POIs whose LLM-suggested parent
  // is not already in the list.
  //
  // The returned array is rewritten (originals are mutated in-place,
  // but the array itself is rebuilt to accommodate inserts). Caller
  // should replace its entries array with the return value.
  //
  // Mutations applied per entry:
  //
  //   region | city  → isStay = true, nights >= 1
  //   poi (Step 1)   → isStay = false, nights = 0  (sight under in-list parent)
  //   poi (Step 2)   → isStay = false, nights = 0  + new parent entry
  //                    inserted just before this one with isStay:true,
  //                    nights:1, _autoCreated:true, _autoCreatedFor:[poi]
  //   poi (Step 3)   → isStay = true,  nights = 0  (standalone destination)
  //   activity       → unchanged (handled by existing role-tag flow;
  //                    future PD will route these through a separate lane)
  //   role-tag       → unchanged (same as activity)
  //
  // Each entry also gains diagnostic fields used by downstream consumers
  // (PD.207, PD.208, dev logging):
  //
  //   _classification, _parentEntry, _parentRelation,
  //   _promotedToDestination, _autoCreatedParent

  function applyClassificationsToEntries(entries, classifications) {
    if (!Array.isArray(entries) || !Array.isArray(classifications)) return entries || [];

    var rewritten = [];
    var insertedParents = {}; // norm(name) → true, prevents double-insert

    function _matchesByNorm(arr, key) {
      for (var i = 0; i < arr.length; i++) {
        if (_norm(arr[i] && arr[i].place) === key) return true;
      }
      return false;
    }

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i] || {};
      var cls = classifications[i] || { classification: 'city' };
      var kind = VALID_CLASSIFICATIONS[cls.classification] ? cls.classification : 'city';

      // Stash diagnostic fields on the entry (always, even for non-POIs).
      entry._classification        = kind;
      entry._parentEntry           = cls.parentEntry || null;
      entry._parentRelation        = cls.parentRelation || null;
      entry._promotedToDestination = !!cls.promotedToDestination;
      entry._autoCreatedParent     = cls.autoCreatedParent || null;

      if (kind === 'city' || kind === 'region') {
        entry.isStay = true;
        if (typeof entry.nights !== 'number' || entry.nights < 1) entry.nights = 1;
      } else if (kind === 'poi') {
        // Step 2: auto-create parent if LLM named one not in the list.
        if (cls.autoCreatedParent) {
          var parentKey = cls.parentEntry || _norm(cls.autoCreatedParent);
          if (parentKey && !insertedParents[parentKey] && !_matchesByNorm(rewritten, parentKey)) {
            rewritten.push({
              place: cls.autoCreatedParent,
              country: entry.country || '',
              nights: 1,
              isStay: true,
              intent: '',
              _classification: 'city',
              _autoCreated: true,
              _autoCreatedFor: [entry.place]
            });
            insertedParents[parentKey] = true;
          } else if (insertedParents[parentKey]) {
            // Track that another POI is also relying on this parent,
            // so the dev-tooling can show "Reykjavík was added for
            // Harpa + Hallgrímskirkja" rather than just one.
            for (var j = 0; j < rewritten.length; j++) {
              var r = rewritten[j];
              if (r && r._autoCreated && _norm(r.place) === parentKey) {
                if (!r._autoCreatedFor) r._autoCreatedFor = [];
                if (r._autoCreatedFor.indexOf(entry.place) < 0) r._autoCreatedFor.push(entry.place);
                break;
              }
            }
          }
        }

        if (cls.promotedToDestination) {
          // Step 3: standalone destination (Geysir-alone).
          entry.isStay = true;
          entry.nights = 0;
        } else {
          // Step 1 or 2: sight under a parent.
          entry.isStay = false;
          entry.nights = 0;
        }
      }
      // activity / role-tag: unchanged. The parser's existing handling
      // for these is fine until we build the separate roleTags lane.

      rewritten.push(entry);
    }

    return rewritten;
  }

  // ── Exports ───────────────────────────────────────────────────
  // Public surface on the namespace; back-compat globals for the
  // inline-script layer to pick up.

  var MaxEngineClassify = {
    classifyListEntries: classifyListEntries,
    applyClassificationsToEntries: applyClassificationsToEntries,
    // Internals exposed for unit tests + dev tooling.
    _internals: {
      buildClassifierPrompt: buildClassifierPrompt,
      parseClassifierResponse: parseClassifierResponse,
      heuristicClassify: heuristicClassify,
      applyParentageRules: applyParentageRules
    }
  };

  global.MaxEngineClassify = MaxEngineClassify;
  global.classifyListEntries = classifyListEntries;

})(typeof window !== 'undefined' ? window : this);
