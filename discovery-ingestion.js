// @ts-check
// discovery-ingestion.js — SSOT Phase 2: the ONE ingestion service.
//
// Turns trip data into a DiscoveryModel through a SINGLE pipeline:
//   trip → unified place set (placeActivities + the legacy dest.suggestions
//          considered pool, folded in) → DiscoveryModel (one writer / SSOT).
//
// Before this, "build the model from the trip" was open-coded in several
// places (MaxData.consideredPlaceKeys, getCommittedSights, the picker adapter),
// each re-declaring the same isStaySection / isDestination / isHub opts — three
// chances to drift. IngestionService owns that pipeline once; every count and
// section surface delegates here, so there is exactly one notion of "what is in
// Discovery and where."
//
// Vanilla namespaced service (no bundler): one global API, dependencies resolved
// at CALL time from the runtime globals (MaxDiscovery, MaxData, SectionKind,
// PlaceKey), so script load order among the helpers is immaterial.
(function (global) {
  "use strict";

  function _MD()   { return global.MaxDiscovery; }
  function _Data() { return global.MaxData; }
  function _SK()   { return global.SectionKind || null; }

  function _normKey(name) {
    var PK = global.PlaceKey;
    if (PK && typeof PK.resolve === "function") { try { return PK.resolve(name); } catch (_) {} }
    return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function _placeActivities(trip) {
    var D = _Data();
    if (D && typeof D.getPlaceActivities === "function") return D.getPlaceActivities(trip);
    return (trip && Array.isArray(trip.placeActivities)) ? trip.placeActivities : [];
  }
  function _destinations(trip) {
    var D = _Data();
    if (D && typeof D.getDestinations === "function") return D.getDestinations(trip);
    return (trip && Array.isArray(trip.destinations)) ? trip.destinations : [];
  }

  // The canonical, UNIFIED placeActivities for a trip: the persisted array with
  // the legacy dest.suggestions._considered pool folded in (non-destructive,
  // idempotent, coordinate-aware dedup). One source for considered sights.
  function unifiedPlaceActivities(trip) {
    var D = _Data();
    if (D && typeof D.foldConsideredSuggestionsIntoPlaceActivities === "function") {
      try { return D.foldConsideredSuggestionsIntoPlaceActivities(trip).placeActivities; } catch (_) {}
    }
    return _placeActivities(trip);
  }

  // The ONE set of ingestion opts (a single definition of stay / destination /
  // hub). Matches MaxData.consideredPlaceKeys exactly: a place in ANY stay
  // section, or that is itself a destination, is not a considered sight.
  function ingestionOpts(trip) {
    var SK = _SK();
    var isStaySec = function (s) { return SK ? SK.isStay(s) : false; };
    var excluded = Object.create(null);
    _destinations(trip).forEach(function (d) { if (d && d.place) excluded[_normKey(d.place)] = true; });
    unifiedPlaceActivities(trip).forEach(function (it) {
      if (it && isStaySec(it.section)) {
        (it.requiredPlaces || []).forEach(function (p) { if (p && p.place) excluded[_normKey(p.place)] = true; });
      }
    });
    return {
      isStaySection: isStaySec,
      isDestination: function (p) { return !!(p && p.place && excluded[_normKey(p.place)]); },
      isHub: function (p) { return !!(p && (p._autoCreated || p._origin === "max-hub")); }
    };
  }

  // THE ingestion: trip → DiscoveryModel. Every surface that needs "the model
  // for this trip" calls this. Returns null only if the domain isn't loaded.
  function buildModel(trip) {
    var MD = _MD();
    if (!MD || !MD.DiscoveryModel || typeof MD.DiscoveryModel.fromPlaceActivities !== "function") return null;
    if (!trip) return new MD.DiscoveryModel();
    return MD.DiscoveryModel.fromPlaceActivities(unifiedPlaceActivities(trip), ingestionOpts(trip));
  }

  var api = {
    buildModel: buildModel,
    unifiedPlaceActivities: unifiedPlaceActivities,
    ingestionOpts: ingestionOpts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.MaxIngestion = api;
})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : this));
