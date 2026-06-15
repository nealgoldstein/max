// @ts-check
// max-data.js — schema accessor layer.
//
// PD.319-3. Before this module, every renderer read raw `trip.X`.
// When the schema migrated (mdcItems → placeActivities, or any
// future rename) every renderer was its own contract — silently
// stale. PD.307b and PD.318 were the worked examples: identical
// one-line fixes scattered across the file.
//
// After this module, no renderer reads `trip.X` directly. Instead:
//
//   var sights = MaxData.getConsideredSights(trip);
//   var sections = MaxData.getPlaceActivities(trip);
//   var dest = MaxData.findDestination(trip, destId);
//
// The accessor handles legacy field fallbacks. When a field gets
// renamed, only this file changes — every renderer keeps working.
//
// Pure functions. No mutation. No I/O. Safe to call from any
// renderer at any frequency (the existing inline reads ran on every
// render too).
//
// Reads tolerate:
//   - missing fields (trip.X is undefined)
//   - legacy fields (trip.mdcItems instead of trip.placeActivities)
//   - partial schema (an old trip loaded after a schema bump)
//
// Writes go through TripStore mutators, not this layer. This is
// READ-ONLY.

(function (global) {
  "use strict";

  // ── Helpers ──────────────────────────────────────────────────────

  function _normKey(name) {
    if (!name) return "";
    // PD.357: alias-aware identity. Once PlaceKey learns that the
    // LLM's "Mývatn Nature Baths" is the user's "Mývatn natursone
    // baths", BOTH normalize to the same key here — so the
    // canonicalizer's dedupe and the catchall claim-filtering treat
    // them as one place, exactly like the badge resolver does.
    if (global.PlaceKey && typeof global.PlaceKey.resolve === "function") {
      return global.PlaceKey.resolve(name);
    }
    if (typeof global._normPlaceName === "function") {
      return global._normPlaceName(name);
    }
    return String(name).toLowerCase().trim();
  }

  function _isFiniteCoord(n) {
    return typeof n === "number" && isFinite(n);
  }

  // ── Trip-level reads ─────────────────────────────────────────────

  // Returns the list of activity sections (the "placeActivities" array
  // in canonical post-ARCH terms). Falls back to legacy `mdcItems`
  // for any pre-migration trip that slipped through. Always returns
  // an array — never null/undefined — so callers can `.forEach`
  // without a null check.
  function getPlaceActivities(trip) {
    if (!trip) return [];
    if (Array.isArray(trip.placeActivities)) return trip.placeActivities;
    if (Array.isArray(trip.mdcItems)) return trip.mdcItems; // legacy fallback
    return [];
  }

  function getCandidates(trip) {
    if (!trip) return [];
    return Array.isArray(trip.candidates) ? trip.candidates : [];
  }

  function getDestinations(trip) {
    if (!trip) return [];
    return Array.isArray(trip.destinations) ? trip.destinations : [];
  }

  function getRoutes(trip) {
    if (!trip) return [];
    return Array.isArray(trip.routes) ? trip.routes : [];
  }

  function getPlaces(trip) {
    if (!trip) return {};
    return (trip.places && typeof trip.places === "object") ? trip.places : {};
  }

  function getBrief(trip) {
    if (!trip) return {};
    return (trip.brief && typeof trip.brief === "object") ? trip.brief : {};
  }

  function getNotes(trip) {
    if (!trip) return { text: "", links: [] };
    if (trip.notes && typeof trip.notes === "object") return trip.notes;
    return { text: "", links: [] };
  }

  // ── Destination reads ────────────────────────────────────────────

  function findDestination(trip, destId) {
    if (!trip || !destId) return null;
    var ds = getDestinations(trip);
    for (var i = 0; i < ds.length; i++) {
      if (ds[i] && ds[i].id === destId) return ds[i];
    }
    return null;
  }

  function findDestinationByPlace(trip, place) {
    if (!trip || !place) return null;
    var key = _normKey(place);
    var ds = getDestinations(trip);
    for (var i = 0; i < ds.length; i++) {
      if (ds[i] && ds[i].place && _normKey(ds[i].place) === key) return ds[i];
    }
    return null;
  }

  function getSuggestions(dest) {
    if (!dest) return [];
    return Array.isArray(dest.suggestions) ? dest.suggestions : [];
  }

  function getDayItems(dest) {
    if (!dest) return [];
    return Array.isArray(dest.dayItems) ? dest.dayItems : [];
  }

  function getDayTrips(dest) {
    if (!dest) return [];
    return Array.isArray(dest.dayTrips) ? dest.dayTrips : [];
  }

  function getReservations(dest) {
    if (!dest) return [];
    return Array.isArray(dest.reservations) ? dest.reservations : [];
  }

  function getBookings(dest) {
    if (!dest) return [];
    return Array.isArray(dest.bookings) ? dest.bookings : [];
  }

  // ── Considered / rejected sights ─────────────────────────────────

  // Canonical "considered sight" source. PD.269 stored these in
  // dest.suggestions[] with a `_considered: true` flag. PD.318
  // (revised) confirmed this is the source of truth — the
  // "(N) considered" count in the trip-map UI reads from here.
  //
  // Returns a deduped array of { place, coords, description, section,
  //   parentDest, suggestion } objects. Skips:
  //   - sights already in the trip (a destination, day-trip stop, or
  //     wayside)
  //   - sights without resolvable coordinates
  //
  // Pure. No DOM access. Safe at any frequency.
  // PD.387 (architectural): THE CONSIDERED SET IS ONE DERIVATION.
  // "Considered" was computed two ways from two representations — the
  // discovery preview from placeActivities, the trip pill from a
  // SEPARATE pool (dest.suggestions) built at publish. Two copies of
  // one truth drift; we'd been asserting them equal in a test (a
  // patch). This function is the SINGLE OWNER: the considered set is a
  // pure function of trip.placeActivities (the canonical source,
  // PD.356/358). Every surface — the discovery preview, the trip
  // pill, the overview map — calls this, so they cannot diverge.
  //
  // A "considered sight" is: a place that is UNCHECKED (kept===false,
  // not rejected), is NOT a Max hub, is NOT in a stay section, and is
  // NOT already a destination. Deduped by canonical key.
  function consideredPlaceKeys(trip) {
    if (!trip) return {};
    // SSOT Phase 2: delegate to the ONE ingestion service when present, so the
    // trip→model pipeline (pool union + identity dedup + the stay/dest/hub opts)
    // lives in exactly one place. The inline derivation below is kept as a
    // fallback for load-order safety and for Node tests that don't load the
    // ingestion module — it is the SAME pipeline, open-coded.
    var ING = global.MaxIngestion;
    if (ING && typeof ING.buildModel === "function") {
      var ingModel = ING.buildModel(trip);
      if (ingModel) return ingModel.consideredKeyedSet();
    }
    // SSOT Stage 3: derive from the UNIFIED place set — placeActivities with the
    // legacy dest.suggestions._considered pool folded in — so there is ONE
    // source. This replaces the old read-time "legacy absorption" (below) that
    // tacked the suggestion pool onto the count with section:null (the live
    // "(none): 55"); now those sights are real, sectioned members of the set.
    var pa = (typeof foldConsideredSuggestionsIntoPlaceActivities === "function")
      ? foldConsideredSuggestionsIntoPlaceActivities(trip).placeActivities
      : getPlaceActivities(trip);
    var SK = global.SectionKind || null;
    var isStaySec = function (s) { return SK ? SK.isStay(s) : false; };
    var excluded = {};
    getDestinations(trip).forEach(function (d) {
      if (d && d.place) excluded[_normKey(d.place)] = true;
    });
    pa.forEach(function (it) {
      if (it && isStaySec(it.section)) {
        (it.requiredPlaces || []).forEach(function (p) {
          if (p && p.place) excluded[_normKey(p.place)] = true;
        });
      }
    });
    var out = {};
    // PD.401c (SINGLE SOURCE OF TRUTH): the considered set is whatever the
    // DiscoveryModel says it is — the SAME ingestion and the SAME
    // coordinate-aware dedup the picker renders and the receipt banner
    // counts. No second placement policy, no second dedup: the trip pill,
    // the audit, the section chips, and the render are one derivation.
    // (Falls back to the inline loop only if the model isn't loaded.)
    var MD = global.MaxDiscovery;
    if (MD && MD.DiscoveryModel && typeof MD.DiscoveryModel.fromPlaceActivities === "function") {
      var model = MD.DiscoveryModel.fromPlaceActivities(pa, {
        isStaySection: isStaySec,
        isDestination: function (p) { return !!(p && p.place && excluded[_normKey(p.place)]); },
        isHub: function (p) { return !!(p && (p._autoCreated || p._origin === "max-hub")); }
      });
      out = model.consideredKeyedSet();
    } else {
      pa.forEach(function (it) {
        if (!it || it.type === "route" || isStaySec(it.section)) return;
        (it.requiredPlaces || []).forEach(function (p) {
          if (!p || !p.place) return;
          if (p._autoCreated) return; // a Max hub is a stay proposal, not a sight
          if (!(p._keep === false && p._rejected !== true)) return; // unchecked only
          var k = _normKey(p.place);
          if (!k || excluded[k] || out[k]) return;
          out[k] = { name: p.place, lat: p.lat, lng: p.lng, section: it.section };
        });
      });
    }
    // PD.387 LEGACY ABSORPTION removed (SSOT Stage 3): the dest.suggestions
    // _considered pool is now folded INTO placeActivities by
    // foldConsideredSuggestionsIntoPlaceActivities() above and derived through
    // the ONE model, with a real section — so there is no second read-time pool
    // to supplement (and no more section:null "(none)" entries). The fold is
    // idempotent and additive, so this is a strict superset of the old behavior:
    // every sight the absorption used to surface is still surfaced, now sectioned.
    return out;
  }

  // SSOT Stage 3: fold the legacy dest.suggestions._considered pool INTO
  // placeActivities, so there is ONE source of considered sights instead of
  // two that drift. Historically considered sights lived in placeActivities
  // (what the picker reads) AND in the old PD.269 dest.suggestions pool (which
  // consideredPlaceKeys "absorbed" at read time with section:null — the live
  // "(none): 55"). The picker banner read the first, the map/pill read both, so
  // they disagreed (131 vs 186). This folds every considered suggestion not
  // already represented in placeActivities into the "Sights near places you
  // listed" catch-all, then canonicalizes (coordinate-aware dedup). Returns a
  // NEW placeActivities array (deep-cloned; the live trip is untouched until the
  // caller persists) plus the count added. IDEMPOTENT: re-running finds
  // everything already present and adds nothing. NEVER drops a place — it only
  // adds and dedups, so it cannot trip the 401V "a listed place must never
  // disappear" guard.
  function foldConsideredSuggestionsIntoPlaceActivities(trip) {
    var orig = getPlaceActivities(trip);
    if (!trip) return { added: 0, placeActivities: orig };
    // Deep-ish clone so canonicalize / push never mutate the live trip.
    var pa = orig.map(function (it) {
      return Object.assign({}, it, {
        requiredPlaces: (it.requiredPlaces || []).map(function (p) { return Object.assign({}, p); })
      });
    });
    var SK = global.SectionKind || null;
    var SIGHTS_NEAR = (SK && SK.NAMES && SK.NAMES.SIGHTS_NEAR) ? SK.NAMES.SIGHTS_NEAR : "Sights near places you listed";
    // What's already represented, and what's excluded (destinations + stays).
    var present = {};
    var excluded = {};
    getDestinations(trip).forEach(function (d) { if (d && d.place) excluded[_normKey(d.place)] = true; });
    pa.forEach(function (it) {
      var isStay = SK ? SK.isStay(it.section) : false;
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place) return;
        var k = _normKey(p.place);
        present[k] = true;
        if (isStay) excluded[k] = true;
      });
    });
    // Collect considered suggestions not already represented.
    var toAdd = [];
    getDestinations(trip).forEach(function (d) {
      getSuggestions(d).forEach(function (s) {
        if (!s || !s._considered) return;
        var name = s.name || s.label || s.place || s.n || s.st;
        if (!name) return;
        var k = _normKey(name);
        if (!k || excluded[k] || present[k]) return;
        present[k] = true; // dedup within the legacy pool too
        toAdd.push({ place: name, lat: s.lat, lng: s.lng, _keep: false, _migratedFromSuggestion: true });
      });
    });
    if (!toAdd.length) return { added: 0, placeActivities: orig };
    // Find or create the catch-all item.
    var item = null;
    for (var i = 0; i < pa.length; i++) { if (pa[i] && pa[i].section === SIGHTS_NEAR) { item = pa[i]; break; } }
    if (!item) {
      item = { id: "synth-near-migrated-" + Date.now().toString(36), type: "synthetic-enhance",
        section: SIGHTS_NEAR, name: "Sights near places you listed", checked: false, requiredPlaces: [] };
      pa.push(item);
    }
    if (!Array.isArray(item.requiredPlaces)) item.requiredPlaces = [];
    Array.prototype.push.apply(item.requiredPlaces, toAdd);
    var canon = (typeof canonicalizePlaceActivities === "function") ? canonicalizePlaceActivities(pa) : pa;
    return { added: toAdd.length, placeActivities: canon };
  }

  // PD.388 / PD.401j: committed sights — the green teardrops. The
  // MEMBERSHIP now comes from the DiscoveryModel (model.committed() =
  // CHECKED sight places that are not stays, hubs, destinations, or
  // route umbrellas), the SAME single derivation the considered count
  // and the render use. This function only resolves coordinates for the
  // map; it no longer re-decides "what is committed" with its own dedup.
  function getCommittedSights(trip) {
    if (!trip) return [];
    var pa = getPlaceActivities(trip);
    var SK = global.SectionKind || null;
    var isStaySec = function (s) { return SK ? SK.isStay(s) : false; };
    var firstDest = (getDestinations(trip) || [])[0] || null;
    var excluded = {};
    getDestinations(trip).forEach(function (d) {
      if (d && d.place) excluded[_normKey(d.place)] = true;
    });
    var MD = global.MaxDiscovery;
    var committed;
    if (MD && MD.DiscoveryModel && typeof MD.DiscoveryModel.fromPlaceActivities === "function") {
      var model = MD.DiscoveryModel.fromPlaceActivities(pa, {
        isStaySection: isStaySec,
        isDestination: function (p) { return !!(p && p.place && excluded[_normKey(p.place)]); },
        isHub: function (p) { return !!(p && (p._autoCreated || p._origin === "max-hub")); }
      });
      committed = model.committed().map(function (mp) {
        var c = mp.coords || {};
        return { place: mp.place,
                 lat: (typeof c.lat === "number") ? c.lat : (mp.src && mp.src.lat),
                 lng: (typeof c.lng === "number") ? c.lng : (mp.src && mp.src.lng),
                 section: MD.PlacementPolicy.sectionFor(mp) };
      });
    } else {
      // Fallback (model unavailable): the previous inline derivation.
      committed = [];
      var seenF = {};
      pa.forEach(function (it) {
        if (!it || it.type === "route" || isStaySec(it.section)) return;
        (it.requiredPlaces || []).forEach(function (p) {
          if (!p || !p.place || p._autoCreated) return;
          if (p._keep === false || p._rejected === true) return;
          var k = _normKey(p.place);
          if (!k || excluded[k] || seenF[k]) return;
          seenF[k] = true;
          committed.push({ place: p.place, lat: p.lat, lng: p.lng, section: it.section });
        });
      });
    }
    // Resolve coordinates for the map (LLM coords → city center → parent
    // offset). Membership is already decided above; this is presentation.
    var out = [];
    committed.forEach(function (s) {
      var coords = null;
      if (_isFiniteCoord(s.lat) && _isFiniteCoord(s.lng)) coords = [s.lat, s.lng];
      else if (typeof global.getCityCenter === "function") {
        var c = global.getCityCenter(s.place);
        if (Array.isArray(c) && _isFiniteCoord(c[0]) && _isFiniteCoord(c[1])) coords = c;
      }
      if (!coords && firstDest && _isFiniteCoord(firstDest.lat) && _isFiniteCoord(firstDest.lng)) {
        var _h = 0, nm = String(s.place);
        for (var _i = 0; _i < nm.length; _i++) _h = (_h * 31 + nm.charCodeAt(_i)) | 0;
        coords = [firstDest.lat + ((_h & 0xff) / 128 - 1) * 0.005,
                  firstDest.lng + (((_h >> 8) & 0xff) / 128 - 1) * 0.008];
      }
      if (!coords) return;
      out.push({ place: s.place, coords: coords, section: s.section });
    });
    return out;
  }

  function getConsideredSights(trip) {
    if (!trip) return [];
    var ds = getDestinations(trip);
    // PD.387: derive from placeActivities (single source), then
    // resolve coords for the map. The dest.suggestions pool is no
    // longer the source of truth for the count or the overview pins.
    var set = consideredPlaceKeys(trip);
    var firstDest = ds.length ? ds[0] : null;
    var out = [];
    Object.keys(set).forEach(function (k) {
      var s = set[k];
      var name = s.name;
      var d = firstDest;
      {
        // Resolve coordinates.
        var coords = null;
        if (_isFiniteCoord(s.lat) && _isFiniteCoord(s.lng)) {
          coords = [s.lat, s.lng];
        } else if (typeof global.getCityCenter === "function") {
          var c = global.getCityCenter(name);
          if (Array.isArray(c) && c.length === 2 && _isFiniteCoord(c[0]) && _isFiniteCoord(c[1])) {
            coords = c;
          }
        }
        // PD.336: coarse-geocode fallback with name normalization.
        // The LLM seeds max-coarse-geocode at Discovery time keyed by
        // lowercased place name; considered-suggestion names often
        // carry a ", Country" suffix or accents that miss the exact
        // key. Try the stripped form before giving up — a considered
        // place with no pin is invisible to the user even though the
        // toggle counts it.
        if (!coords && global._coarseGeocode) {
          var _lower = String(name).toLowerCase().trim();
          var _stripped = _lower.replace(/,[^,]*$/, "").trim(); // drop ", Iceland"
          var _cg = global._coarseGeocode[_lower] || global._coarseGeocode[_stripped];
          if (Array.isArray(_cg) && _isFiniteCoord(_cg[0]) && _isFiniteCoord(_cg[1])) {
            coords = _cg;
          }
        }
        // PD.354: LAST-RESORT — parent destination + a stable
        // name-derived offset (~500m), the same trick the publish
        // router uses. EVERY considered sight pins; an invisible
        // maybe is indistinguishable from a lost one, which is how
        // "48 unchecked but only 39 considered" reads to the user.
        if (!coords && d && _isFiniteCoord(d.lat) && _isFiniteCoord(d.lng)) {
          var _h = 0;
          for (var _hi = 0; _hi < name.length; _hi++) _h = (_h * 31 + name.charCodeAt(_hi)) | 0;
          coords = [d.lat + ((_h & 0xff) / 128 - 1) * 0.005,
                    d.lng + (((_h >> 8) & 0xff) / 128 - 1) * 0.008];
        }
        if (!coords) return;

        out.push({
          place: name,
          coords: coords,
          description: "",
          section: s.section || ("Considered near " + ((d && d.place) || "this destination")),
          parentDest: d,
          suggestion: s
        });
      }
    });
    return out;
  }

  // PD.395: the considered set, grouped by section. The ONE source
  // both the section chip and the receipt read for the Max catchall
  // sections, so their numbers cannot disagree (the "44+10 vs 53"
  // mismatch). Returns { sectionName: count }.
  function consideredBySection(trip) {
    var set = consideredPlaceKeys(trip);
    var out = {};
    Object.keys(set).forEach(function (k) {
      var sec = set[k].section || "(none)";
      out[sec] = (out[sec] || 0) + 1;
    });
    return out;
  }

  // PD.387: the count is the SIZE of the canonical considered set —
  // the SAME derivation the pill and the discovery preview use. No
  // second computation, so nothing to keep in sync.
  function countConsideredSights(trip) {
    if (!trip) return 0;
    return Object.keys(consideredPlaceKeys(trip)).length;
  }

  // Rejected sights (PD.269 anti-signal). Used by Enhance's skip
  // list and by the picker's "Not interested ever" affordance.
  function getRejectedSights(trip) {
    if (!trip) return [];
    var out = [];
    getDestinations(trip).forEach(function (d) {
      getSuggestions(d).forEach(function (s) {
        if (s && s._rejected) {
          out.push({ place: s.name || s.label || s.place, parentDest: d, suggestion: s });
        }
      });
    });
    return out;
  }

  // ── User-listed (paste-list) reads ───────────────────────────────

  // PD.92 / PD.149: the user's literal pasted list, preserved on the
  // brief. Tests use this to verify "no user-listed place dropped."
  function getUserListedNames(trip) {
    var brief = getBrief(trip);
    return (brief._userListedNames && typeof brief._userListedNames === "object")
      ? brief._userListedNames : {};
  }

  function getUserListedDisplay(trip) {
    var brief = getBrief(trip);
    return (brief._userListedDisplay && typeof brief._userListedDisplay === "object")
      ? brief._userListedDisplay : {};
  }

  // PD.429: DERIVE the user's listed set FROM THE RECORDS — the read SSOT that
  // retires the parallel `_userListedNames` map. A place is "yours" iff a record
  // carries `_origin:"user"` (baked by _stampListedOrigin); its role is stay vs
  // see by section; its display is the record's canonical name. Records are
  // already interned by identity, so two names for one place ("Goðafoss" +
  // "Goðafoss Waterfall") are ONE record → counted once, no merge note needed.
  // Returns { names: key->("stay"|"see"), display: key->name }. PURE.
  //   opts.isStaySection(section) — optional; defaults to the two stay sections.
  function deriveListedFromRecords(trip, opts) {
    opts = opts || {};
    var out = { names: {}, display: {} };
    var pa = getPlaceActivities(trip);
    if (!Array.isArray(pa)) return out;
    var isStay = (typeof opts.isStaySection === "function") ? opts.isStaySection
      : (typeof global._isStaySection === "function") ? global._isStaySection
      : function (s) { return /^(overnight stays|recommended overnight stays)$/i.test(String(s || "").trim()); };
    // Key by the SAME normalizer the readers use to look up the cache. Callers
    // that replace _tb._userListedNames pass window._normPlaceName so the
    // projection is a drop-in; the default _normKey is fine for count-only use.
    var keyOf = (typeof opts.normKey === "function") ? opts.normKey : _normKey;
    pa.forEach(function (it) {
      if (!it) return;
      var stay = isStay(it.section);
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place) return;
        // The ONE oracle: origin === "user". This naturally includes a circuit
        // you listed that's modeled as a route umbrella ("Golden Circle",
        // "Diamond Circle") — origin user on a route item — while excluding
        // Max's infrastructure waypoints (origin max strung along a route). A
        // place that's both a route waypoint and a themed sight shares one
        // _key, so it's counted once regardless of how many items hold it.
        if (p._origin !== "user") return;
        // Key by normalized NAME (not the coord-canonical _key) so the result is
        // a drop-in for the retired _userListedNames cache that readers expect.
        // Records are already interned by identity, so one place yields one name.
        var k = keyOf(p.place);
        if (!k) return;
        var role = stay ? "stay" : "see";
        if (!out.names[k]) { out.names[k] = role; out.display[k] = String(p.place).trim(); }
        else if (role === "stay") out.names[k] = "stay"; // a stay outranks a see
      });
    });
    return out;
  }

  // PD.428 (Task #28): physically dedupe the stored listed-name set by ENTITY
  // identity. The paste-list can carry two NAMES for ONE place ("godafoss" +
  // "godafoss waterfall"); both get stored as separate keys, which inflates the
  // listed count and forces a confusing "X = X, counted once" merge note even
  // though there's only one pin. This collapses each identity-group to ONE
  // canonical key — the most descriptive (longest) name, which matches the
  // place record's canonical form ("Goðafoss Waterfall") and the user's stated
  // preference to keep the correct full name. Roles merge (a "stay" beats a
  // "see" — an overnight is the stronger commitment). PURE: returns new maps +
  // the list of dropped→kept pairs; mutates nothing. Idempotent (a deduped set
  // passes through unchanged). Uses MaxDiscovery.sameEntity for identity, with a
  // name-only fallback so it works on the name-keyed map (no coords needed —
  // sameEntity's feature-variant rule is name-only).
  function dedupeListedNames(names, display) {
    var result = { names: {}, display: {}, dropped: [] };
    if (!names || typeof names !== "object") return result;
    var SE = (global.MaxDiscovery && typeof global.MaxDiscovery.sameEntity === "function")
      ? global.MaxDiscovery.sameEntity : null;
    function same(a, b) {
      if (a === b) return true;
      if (SE) { try { return SE({ place: a }, { place: b }); } catch (_) {} }
      return false;
    }
    display = (display && typeof display === "object") ? display : {};
    var keys = Object.keys(names);
    var groups = []; // each: { canon, keys:[...], role }
    keys.forEach(function (k) {
      var g = null;
      for (var i = 0; i < groups.length; i++) {
        // PD.438: never group a base (stay) with a sight (see) — a place you
        // sleep and a place you see are different entities even when their
        // names match ("Skaftafell" the base vs "Skaftafell glacier region").
        // Only merge within the same role.
        if (groups[i].role === names[k] && same(groups[i].canon, k)) { g = groups[i]; break; }
      }
      if (!g) { g = { canon: k, keys: [], role: names[k] }; groups.push(g); }
      g.keys.push(k);
      // role merge: a stay outranks a see.
      if (names[k] === "stay") g.role = "stay";
      // canonical = the LONGEST (most descriptive) key in the group.
      if (k.length > g.canon.length) g.canon = k;
    });
    groups.forEach(function (g) {
      result.names[g.canon] = g.role;
      // carry a display for the canonical key (prefer an explicit one).
      if (display[g.canon] != null) result.display[g.canon] = display[g.canon];
      else {
        for (var i = 0; i < g.keys.length; i++) {
          if (display[g.keys[i]] != null) { result.display[g.canon] = display[g.keys[i]]; break; }
        }
      }
      g.keys.forEach(function (k) {
        if (k !== g.canon) result.dropped.push({ from: k, into: g.canon, fromDisplay: display[k] || k, intoDisplay: result.display[g.canon] || g.canon });
      });
    });
    return result;
  }

  // ── User-owned annotations ───────────────────────────────────────

  function getDestNote(trip, destId) {
    if (!trip || !destId) return "";
    return (trip.destNotes && trip.destNotes[destId]) || "";
  }

  function getDestStory(trip, destId) {
    if (!trip || !destId) return "";
    return (trip.destStories && trip.destStories[destId]) || "";
  }

  function getSightStory(trip, sightId) {
    if (!trip || !sightId) return "";
    return (trip.sightStories && trip.sightStories[sightId]) || "";
  }

  // ── Diagnostics ──────────────────────────────────────────────────

  // Returns a shape summary of the trip — useful for debugging. NOT
  // a performance-critical path.
  function describeTrip(trip) {
    if (!trip) return { present: false };
    return {
      present: true,
      id: trip.id || null,
      schemaVersion: trip._schemaVersion,
      destinations: getDestinations(trip).length,
      placeActivities: getPlaceActivities(trip).length,
      candidates: getCandidates(trip).length,
      routes: getRoutes(trip).length,
      consideredSights: countConsideredSights(trip),
      rejectedSights: getRejectedSights(trip).length,
      userListedNames: Object.keys(getUserListedNames(trip)).length,
      hasMdcItems: Array.isArray(trip.mdcItems) // expect false post-migration
    };
  }

  // ── Export ───────────────────────────────────────────────────────

  // ── PD.349: THE CANONICAL PLACE-SET INVARIANT ─────────────────────
  // The Discovery working set has many writers (primary LLM,
  // construct, backstop, enhance, secondary discovery, consolidation)
  // and each historically appended its own copies with its own ad-hoc
  // dedupe — re-running ANY pass could grow the set (the observed
  // ratchet: 55 unchecked → 149 → 209 across trip↔Discovery
  // round-trips). This function is the SINGLE OWNER of the invariant.
  //
  // Invariant (enforced, idempotent — f(f(x)) === f(x)):
  //   1. Within one item, a place key appears at most once
  //      (duplicate entries merge; coords/desc fill from whichever
  //      copy has them; _rejected=true wins, else _keep=true wins).
  //   2. A key present in any THEMATIC section is removed from every
  //      CATCHALL bucket ("From your list", "Sights near places you
  //      listed", "More places to consider") — a themed place needs
  //      no stub.
  //   3. Among catchalls, a key lives in exactly ONE, by precedence:
  //      From your list > Sights near places you listed > More
  //      places to consider.
  //   4. A key in "Recommended overnight stays" is removed from
  //      "Overnight stays to consider" — a committed/recommended stay
  //      is not "to consider".
  //   5. Items left with zero places are dropped (routes and
  //      synthetic-typed items exempt).
  //
  // PURE: returns a new array; does not mutate input items' identity
  // (entries are reused by reference where untouched, so the PD.303
  // bridge stays intact for surviving objects).
  // PD.381: section identity comes from SectionKind (the one owner)
  // when loaded; the inline fallbacks keep Node tests self-contained.
  var _SK = global.SectionKind || null;
  var _CATCHALL_PRECEDENCE = _SK ? _SK.catchallPrecedence()
    : ["From your list", "Sights near places you listed", "More places to consider"];
  function canonicalizePlaceActivities(items) {
    if (!Array.isArray(items)) return items;
    var CATCH = {};
    _CATCHALL_PRECEDENCE.forEach(function (s, i) { CATCH[s] = i + 1; });
    var STAY_REC = _SK ? _SK.NAMES.STAYS_REC : "Recommended overnight stays";
    var STAY_USER = _SK ? _SK.NAMES.STAYS_USER : "Overnight stays";
    var STAY_CONSIDER = _SK ? _SK.NAMES.STAYS_CONSIDER : "Overnight stays to consider";
    function _isCommittedStaySec(s){
      return _SK ? _SK.isCommittedStay(s) : (s === STAY_REC || s === STAY_USER);
    }

    function isExempt(it) {
      return !it || it.type === "route" || (it.type && /^synthetic-/.test(String(it.type)));
    }
    function mergePlace(into, from) {
      if (!into || !from) return into;
      if ((into.lat == null || into.lat === 0) && typeof from.lat === "number" && from.lat !== 0) {
        into.lat = from.lat; into.lng = from.lng;
      }
      if (!into.country && from.country) into.country = from.country;
      if ((!into.nights || into.nights === 0) && from.nights > 0) into.nights = from.nights;
      if (from.overnight === true) into.overnight = true;
      if (from._rejected === true) { into._rejected = true; into._keep = false; }
      else if (from._keep === true && into._rejected !== true) into._keep = true;
      return into;
    }

    // Pass 0 (rule 1b): duplicate ITEMS — same section + same name —
    // merge into the first occurrence (a racing regeneration emits
    // near-identical items; without this the set grows by whole
    // items, not just entries).
    var byIdentity = {};
    var merged = [];
    items.forEach(function (it) {
      if (isExempt(it) || !it.section || !Array.isArray(it.requiredPlaces)) { merged.push(it); return; }
      var idKey = String(it.section) + "||" + String(it.name || "");
      var first = byIdentity[idKey];
      if (!first) { byIdentity[idKey] = it; merged.push(it); return; }
      Array.prototype.push.apply(first.requiredPlaces, it.requiredPlaces);
      if (it.checked) first.checked = true;
      if (it._userConstructed) first._userConstructed = true;
    });
    items = merged;

    // PD.401k: INTERN FIRST. `_key` is authored HERE, once, by the ONE
    // identity — the model's `sameEntity` (coordinate-aware: exact/token
    // on name, containment gated ~0.6km, same point ~0.3km). Every
    // subsequent pass groups by `_key`; there is no second merge
    // implementation. `sameEntity` subsumes the old `_isAlreadyThemed`
    // (relatedTo + coordinate gate), so that whole apparatus is gone.
    var _MD = global.MaxDiscovery;
    var _sameEntity = (_MD && typeof _MD.sameEntity === "function") ? _MD.sameEntity : null;
    var _interned = []; // { key, place, coords }
    var _PKlearn = (global.PlaceKey && typeof global.PlaceKey.learn === "function") ? global.PlaceKey : null;
    function _internKey(p, kind) {
      var coords = (typeof p.lat === "number" && typeof p.lng === "number") ? { lat: p.lat, lng: p.lng } : null;
      // PD.438: carry the record's KIND and ORIGIN so sameEntity's origin-gated
      // kind-veto can keep a base ("Skaftafell") and a same-named sight you also
      // listed ("Skaftafell glacier region") as DISTINCT identities — instead of
      // interning them to one key (which a later group-by-key pass would collapse,
      // dropping the base). A MAX suggestion still merges into your base.
      var cand = { place: p.place, coords: coords, kind: kind || null, _origin: p._origin || null };
      for (var i = 0; i < _interned.length; i++) {
        var e = _interned[i];
        var same = _sameEntity ? _sameEntity(e, cand) : (_normKey(e.place) === _normKey(p.place));
        if (same) {
          // PD.401N: ONE STABLE IDENTITY. When two DIFFERENT names merge to
          // one entity by a NAME relation (token-overlap or word-prefix
          // containment — e.g. "Þingvellir" ⊂ "Þingvellir National Park"),
          // LEARN the alias once. After this, identity is alias-aware name
          // resolution and never re-derives from coordinates — so the same
          // place can't flicker as async coords load, and EVERY surface
          // (counts AND coverage) agrees: the listed name resolves to the
          // entity, found and counted once. A PURE coordinate merge is NOT
          // learned (coords are mutable/flaky; a sticky wrong alias is
          // worse than a one-time merge).
          if (_PKlearn && _normKey(p.place) !== e.key) {
            var nameRel = (_PKlearn.same && _PKlearn.same(p.place, e.place))
                       || (_PKlearn.contains && _PKlearn.contains(p.place, e.place));
            if (nameRel) { try { _PKlearn.learn(p.place, e.place); } catch (_) {} }
          }
          return e.key;
        }
      }
      var key = _normKey(p.place);
      _interned.push({ key: key, place: p.place, coords: coords, kind: kind || null, _origin: p._origin || null });
      return key;
    }
    // KIND of a section: a stay section interns its places as "stay", everything
    // else as "sight" — so the kind-veto fires between a base and a sight.
    var _isStaySecMD = (typeof global !== "undefined" && global._isStaySection) ? global._isStaySection
      : (typeof window !== "undefined" && window._isStaySection) ? window._isStaySection
      : function (s) { return /^(overnight stays|recommended overnight stays|overnight stays to consider)$/i.test(String(s || "").trim()); };
    // PD.401M (reverted): reference-interning to ONE Place object per key
    // was backed out — `mergePlace` across same-key occurrences flipped an
    // auto-hub's check-state (a "Max never checks" violation surfaced by
    // the harness). placeActivities is already deduped to ~one entry per
    // key by the passes below; the write door stamps identity, and the
    // place repository is the existence registry. Sharing objects by
    // reference needs a check-state reconciliation it didn't have.
    items.forEach(function (it) {
      if (isExempt(it)) return;
      // A route umbrella legitimately passes sights; only a real stay section
      // marks its places as "stay". Everything else interns as "sight".
      var _itKind = (it.type !== "route" && _isStaySecMD(it.section)) ? "stay" : "sight";
      (it.requiredPlaces || []).forEach(function (p) {
        if (p && p.place) {
          // PD.438: stamp KIND intrinsically at the ONE write door, beside _key.
          // A route umbrella never re-stamps (it doesn't own its sights' kind);
          // a real section does. After this, kind travels WITH the record, so
          // every identity check that reads it is kind-aware by construction —
          // no per-call threading. (Route umbrellas leave an existing _kind.)
          if (it.type !== "route" || !p._kind) p._kind = _itKind;
          p._key = _internKey(p, p._kind);
        }
      });
    });

    // Pass 1: per-item entry dedupe + collect where each key lives.
    var themedKeys = {};
    var recStayKeys = {};
    items.forEach(function (it) {
      if (isExempt(it) || !Array.isArray(it.requiredPlaces)) return;
      var seen = {};
      var out = [];
      it.requiredPlaces.forEach(function (p) {
        if (!p || !p.place) return;
        var k = p._key;                                  // PD.401k: the one identity
        if (!k) { out.push(p); return; }
        if (seen[k]) { mergePlace(seen[k], p); return; }
        seen[k] = p;
        out.push(p);
      });
      it.requiredPlaces = out;
      var sec = it.section || "";
      var isCatchall = !!CATCH[sec];
      var isStayBucket = (sec === STAY_REC || sec === STAY_USER || sec === STAY_CONSIDER);
      out.forEach(function (p) {
        var k = p._key;
        if (!k) return;
        if (_isCommittedStaySec(sec)) recStayKeys[k] = true;
        if (!isCatchall && !isStayBucket) { themedKeys[k] = true; }
      });
    });

    // PD.441: ONE PLACE, ONE KIND — enforced at the write door. A key that lives
    // in a stay section is a BASE; drop every copy of it from non-stay (sight)
    // sections, so a base you listed can NEVER be duplicated as a sight, no
    // matter which pass (LLM, enhance, surfacing, origin-baking) manufactured the
    // copy. This is by-construction, not a heal: the data is canonical the moment
    // it's written. A genuinely different sight at the same place has a DIFFERENT
    // key (the kind veto keeps "Skaftafell" and "Skaftafell glacier region"
    // distinct), so this removes ONLY true same-identity duplicates. Route
    // umbrellas legitimately pass a base, so they're exempt.
    items.forEach(function (it) {
      if (isExempt(it) || it.type === "route" || !Array.isArray(it.requiredPlaces)) return;
      if (_isStaySecMD(it.section)) return;            // keep the base in its stay section
      it.requiredPlaces = it.requiredPlaces.filter(function (p) {
        return !(p && p._key && recStayKeys[p._key]);  // a base shows once, as a base
      });
    });

    // PD.442 (#4/#2): the write door reads your CANONICAL listed set and OWNS the
    // kind invariant — a place you listed as a SIGHT is never left in a stay
    // section (it's not a base). With PD.441 (a base is never duplicated as a
    // sight), kind is enforced ONCE, here, by exact match against your
    // authoritative list — subsuming the scattered _collapseKindConflicts pass.
    // Reads _listedGroundTruth from the global, the same way this module already
    // reaches MaxDiscovery / _isStaySection; degrades to a no-op without it
    // (node, or a sentence-mode trip), where PD.441 + section kind still hold.
    var _listed = (typeof global !== "undefined" && typeof global._listedGroundTruth === "function")
      ? (function () { try { return global._listedGroundTruth(); } catch (_) { return null; } })() : null;
    if (_listed && Array.isArray(_listed.sights) && _listed.sights.length) {
      var _sightK = {}, _stayK = {};
      _listed.sights.forEach(function (n) { _sightK[_normKey(n)] = true; });
      (_listed.stays || []).forEach(function (n) { _stayK[_normKey(n)] = true; });
      items.forEach(function (it) {
        if (isExempt(it) || it.type === "route" || !_isStaySecMD(it.section) || !Array.isArray(it.requiredPlaces)) return;
        it.requiredPlaces = it.requiredPlaces.filter(function (p) {
          var k = (p && p.place) ? _normKey(p.place) : null;
          return !(k && _sightK[k] && !_stayK[k]);     // a place you listed as a SIGHT is not a base
        });
      });
    }

    // PD.401k: "already themed" is now EXACT — a catchall place is themed
    // iff its `_key` is in themedKeys. The interning (sameEntity) already
    // merged naming variants and coordinate-dups to one `_key`, so the
    // whole fuzzy `_isAlreadyThemed` apparatus (relatedTo + coordinate
    // gating) is GONE: it was compensating for non-canonical keys.
    function _isThemed(p) { return !!(p && p._key && themedKeys[p._key]); }

    // Pass 2a: compute the BEST (lowest) catchall rank per key — the
    // precedence decision happens before any filtering, so iteration
    // order can't make first-seen beat best-rank.
    var bestRank = {};
    items.forEach(function (it) {
      if (isExempt(it) || !Array.isArray(it.requiredPlaces)) return;
      var rank = CATCH[it.section || ""];
      if (!rank) return;
      it.requiredPlaces.forEach(function (p) {
        var k = p && p._key;
        if (!k || _isThemed(p)) return;
        if (!bestRank[k] || rank < bestRank[k]) bestRank[k] = rank;
      });
    });

    // Pass 2b: filter — themed keys leave all catchalls; a key stays
    // only in its best-rank catchall, and only in the first item of
    // that rank; "to consider" stays lose to Recommended.
    var claimed = {};
    items.forEach(function (it, idx) {
      if (isExempt(it) || !Array.isArray(it.requiredPlaces)) return;
      var sec = it.section || "";
      var rank = CATCH[sec];
      if (rank) {
        it.requiredPlaces = it.requiredPlaces.filter(function (p) {
          var k = p && p._key;
          if (!k) return true;
          if (_isThemed(p)) return false;
          if (bestRank[k] !== rank) return false;
          if (claimed[k] != null && claimed[k] !== idx) return false;
          claimed[k] = idx;
          return true;
        });
      } else if (sec === STAY_CONSIDER) {
        it.requiredPlaces = it.requiredPlaces.filter(function (p) {
          var k = p && p._key;
          return !(k && recStayKeys[k]);
        });
      }
    });

    // PD.443 (#2): the write door also RESTORES a listed place a pass dropped, so
    // the listed-set PRESENCE invariant is owned here too — every listed STAY ends
    // in a stay section, every listed SIGHT somewhere on the page, on every save.
    // This subsumes the pipeline's _assertUserListedPresent. Identity-aware so a
    // present name-variant counts (no double-add). Idempotent: present → no-op.
    if (_listed && (_listed.stays || _listed.sights)) {
      var _SEr = (global.MaxDiscovery && typeof global.MaxDiscovery.sameEntity === "function") ? global.MaxDiscovery.sameEntity : null;
      function _presentByIdentity(name, stayOnly) {
        return items.some(function (it) {
          if (!it || it.type === "route" || !Array.isArray(it.requiredPlaces)) return false;
          if (stayOnly && !_isStaySecMD(it.section)) return false;
          return it.requiredPlaces.some(function (p) {
            if (!p || !p.place || p._rejected === true) return false;
            if (_SEr) { try { return _SEr({ place: p.place }, { place: name }); } catch (_) {} }
            return _normKey(p.place) === _normKey(name);
          });
        });
      }
      function _ensureSection(name, makeFirst) {
        var sec = items.find(function (it) { return it && it.section === name && it.type !== "route"; });
        if (!sec) { sec = { id: "synth-listed-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: "activity", section: name, requiredPlaces: [] }; if (makeFirst) items.unshift(sec); else items.push(sec); }
        if (!Array.isArray(sec.requiredPlaces)) sec.requiredPlaces = [];
        return sec;
      }
      (_listed.stays || []).forEach(function (n) {
        if (_presentByIdentity(n, true)) return;
        var sec = items.find(function (it) { return it && _isStaySecMD(it.section) && it.type !== "route"; }) || _ensureSection(STAY_USER, true);
        if (!Array.isArray(sec.requiredPlaces)) sec.requiredPlaces = [];
        sec.requiredPlaces.push({ place: n, _origin: "user", _kind: "stay", _key: _normKey(n), _keep: true });
      });
      (_listed.sights || []).forEach(function (n) {
        if (_presentByIdentity(n, false)) return;
        var sec = _ensureSection("Sights near places you listed", false);
        sec.requiredPlaces.push({ place: n, _origin: "user", _kind: "sight", _key: _normKey(n), _keep: true });
      });
    }

    // Pass 3 (rule 5): drop emptied non-exempt items.
    return items.filter(function (it) {
      if (isExempt(it)) return true;
      if (!Array.isArray(it.requiredPlaces)) return true;
      return it.requiredPlaces.length > 0;
    });
  }

  global.MaxData = {
    // Trip-level
    getPlaceActivities:    getPlaceActivities,
    getCandidates:         getCandidates,
    getDestinations:       getDestinations,
    getRoutes:             getRoutes,
    getPlaces:             getPlaces,
    getBrief:              getBrief,
    getNotes:              getNotes,
    // Per-destination
    findDestination:       findDestination,
    findDestinationByPlace:findDestinationByPlace,
    getSuggestions:        getSuggestions,
    getDayItems:           getDayItems,
    getDayTrips:           getDayTrips,
    getReservations:       getReservations,
    getBookings:           getBookings,
    // Considered / rejected
    getConsideredSights:   getConsideredSights,
    consideredPlaceKeys:   consideredPlaceKeys,
    foldConsideredSuggestionsIntoPlaceActivities: foldConsideredSuggestionsIntoPlaceActivities,
    consideredBySection:   consideredBySection,
    getCommittedSights:    getCommittedSights,
    countConsideredSights: countConsideredSights,
    getRejectedSights:     getRejectedSights,
    // User-listed
    getUserListedNames:    getUserListedNames,
    getUserListedDisplay:  getUserListedDisplay,
    dedupeListedNames:     dedupeListedNames,
    deriveListedFromRecords: deriveListedFromRecords,
    // Annotations
    getDestNote:           getDestNote,
    getDestStory:          getDestStory,
    getSightStory:         getSightStory,
    // Diagnostics
    describeTrip:          describeTrip,
    // PD.349: canonical place-set invariant (single dedupe owner)
    canonicalizePlaceActivities: canonicalizePlaceActivities
  };

})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : window));
