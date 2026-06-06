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
  function getConsideredSights(trip) {
    if (!trip) return [];
    var ds = getDestinations(trip);
    if (!ds.length) return [];

    var routes = getRoutes(trip);
    var places = getPlaces(trip);

    // Build set of place names already in the trip.
    var includedKeys = {};
    ds.forEach(function (d) {
      if (d && d.place) includedKeys[_normKey(d.place)] = true;
    });
    routes.forEach(function (r) {
      if (!r || !Array.isArray(r.planItems)) return;
      r.planItems.forEach(function (pi) {
        if (!pi || pi.type !== "stop" || !pi.placeId) return;
        var p = places[pi.placeId];
        if (p && p.name) includedKeys[_normKey(p.name)] = true;
        includedKeys[_normKey(pi.placeId)] = true;
      });
    });

    var out = [];
    var seen = {};
    ds.forEach(function (d) {
      var suggs = getSuggestions(d);
      suggs.forEach(function (s) {
        if (!s || !s._considered) return;
        var name = s.name || s.label || s.place;
        if (!name) return;
        var k = _normKey(name);
        if (!k || includedKeys[k] || seen[k]) return;

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
        if (!coords) return;

        seen[k] = true;
        out.push({
          place: name,
          coords: coords,
          description: String(s.notes || s.description || s.why || "").trim(),
          section: "Considered near " + (d.place || "this destination"),
          parentDest: d,
          suggestion: s
        });
      });
    });
    return out;
  }

  // Count of considered sights — matches the renderer above.
  function countConsideredSights(trip) {
    if (!trip) return 0;
    var n = 0;
    getDestinations(trip).forEach(function (d) {
      getSuggestions(d).forEach(function (s) {
        if (s && s._considered) n++;
      });
    });
    return n;
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
    describeTrip:          describeTrip
  };

})(typeof globalThis !== "undefined" ? globalThis : window);
