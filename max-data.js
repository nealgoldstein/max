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
    var pa = getPlaceActivities(trip);
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
    // PD.387: LEGACY ABSORPTION. placeActivities is authoritative, but
    // trips saved before this refactor carry their considered set ONLY
    // in the old dest.suggestions pool (PD.269). Supplement — never
    // override — from that pool for any considered sight not already
    // derived, so legacy trips still render. New trips get nothing
    // extra here (their pool is a projection of placeActivities), so
    // the count stays identical to the discovery preview.
    getDestinations(trip).forEach(function (d) {
      getSuggestions(d).forEach(function (s) {
        if (!s || !s._considered) return;
        var name = s.name || s.label || s.place || s.n || s.st;
        if (!name) return;
        var k = _normKey(name);
        if (!k || excluded[k] || out[k]) return;
        out[k] = { name: name, lat: s.lat, lng: s.lng, section: null, _legacy: true, _src: s };
      });
    });
    return out;
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
    function _internKey(p) {
      var coords = (typeof p.lat === "number" && typeof p.lng === "number") ? { lat: p.lat, lng: p.lng } : null;
      var cand = { place: p.place, coords: coords };
      for (var i = 0; i < _interned.length; i++) {
        var e = _interned[i];
        var same = _sameEntity ? _sameEntity(e, cand) : (_normKey(e.place) === _normKey(p.place));
        if (same) return e.key;
      }
      var key = _normKey(p.place);
      _interned.push({ key: key, place: p.place, coords: coords });
      return key;
    }
    // PD.401M (reverted): reference-interning to ONE Place object per key
    // was backed out — `mergePlace` across same-key occurrences flipped an
    // auto-hub's check-state (a "Max never checks" violation surfaced by
    // the harness). placeActivities is already deduped to ~one entry per
    // key by the passes below; the write door stamps identity, and the
    // place repository is the existence registry. Sharing objects by
    // reference needs a check-state reconciliation it didn't have.
    items.forEach(function (it) {
      if (isExempt(it)) return;
      (it.requiredPlaces || []).forEach(function (p) {
        if (p && p.place) p._key = _internKey(p);
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
    consideredBySection:   consideredBySection,
    getCommittedSights:    getCommittedSights,
    countConsideredSights: countConsideredSights,
    getRejectedSights:     getRejectedSights,
    // User-listed
    getUserListedNames:    getUserListedNames,
    getUserListedDisplay:  getUserListedDisplay,
    // Annotations
    getDestNote:           getDestNote,
    getDestStory:          getDestStory,
    getSightStory:         getSightStory,
    // Diagnostics
    describeTrip:          describeTrip,
    // PD.349: canonical place-set invariant (single dedupe owner)
    canonicalizePlaceActivities: canonicalizePlaceActivities
  };

})(typeof globalThis !== "undefined" ? globalThis : window);
