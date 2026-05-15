// migration.js — Trip envelope shape migrations
//
// Pure, side-effect-free functions that transform a legacy trip
// envelope into the current data-model.md shape. Loaded as a
// browser global (`window.MaxMigration`) and also runnable from
// Node via the test suite.
//
// Why this lives at top-level (not in db.js):
//   * db.js is the persistence seam — it should KNOW about
//     migrations (call them on read) but the migration logic
//     itself is a separate concern. Keeping them apart lets us
//     test the migration without db.js's IDB/localStorage
//     scaffolding.
//
// Schema versions:
//   v1 — Places dictionary + DayTrip → PlanItem
//        Adds: trip.places{}, dest.placeId, dest.days[].planItems[]
//        Migrates: dest.dayTrips[] → PlanItems with type:dayTrip
//                  on the hub destination's day[0]
//
//   v2 — DayTrip PlanItem → Route. Day-trips become first-class
//        Routes with kind:"dayTrip" (from === to === hub destId),
//        the source place attached as a {type:"stop", priority:"iconic"}
//        PlanItem on the route's planItems[], and the hub day's
//        {type:"dayTrip"} PlanItem replaced with {type:"route", routeId}.
//        Also backfills stable day ids when missing (the route↔day
//        bidirectional reference needs them).
//
// Trip envelopes that don't carry _schemaVersion are treated as
// version 0 (pre-migration). After migration, _schemaVersion is
// bumped so subsequent reads short-circuit.

(function (global) {
  'use strict';

  var CURRENT_SCHEMA_VERSION = 2;

  // ── Helpers ─────────────────────────────────────────────────

  // Deterministic place ID from a place name. Same name → same ID.
  // This makes the migration idempotent and tests predictable.
  // Steps: transliterate special European letters that don't decompose
  // via NFD (þ, ð, æ, ø, ß), then NFD + strip combining marks for
  // accent-insensitive slug.
  function _makePlaceId(name) {
    var slug = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/þ/g, 'th')
      .replace(/ð/g, 'd')
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe')
      .replace(/ø/g, 'o')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')  // combining diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return 'pl-' + (slug || 'unknown');
  }

  // Deterministic PlanItem ID for legacy-converted dayTrips. Built
  // from the place ID + a discriminator so re-running migration
  // produces the same IDs (idempotency).
  function _makeDayTripPlanItemId(destId, placeId) {
    return 'pi-dt-' + destId + '-' + placeId;
  }

  // Deterministic Route ID for v2-migrated day-trip routes. Derived
  // from the hub destination id + the day-trip's target placeId so
  // re-running v2 migration produces the same id (idempotency).
  function _makeDayTripRouteId(hubDestId, stopPlaceId) {
    return 'r-dt-' + hubDestId + '-' + stopPlaceId;
  }

  // Deterministic Day ID — built from the destination id + the index
  // of the day within that destination. Stable as long as the
  // destination's date range doesn't change. (When dates DO change,
  // existing references would point to a now-different calendar day;
  // _applyConstraintChanges-style flows must rebuild day ids too.)
  function _makeDayId(destId, dayIdx) {
    return 'd-' + destId + '-' + dayIdx;
  }

  // Get-or-create an entry in trip.places{} for the given place
  // descriptor. Returns the placeId. Mutates trip.places in place.
  function _getOrCreatePlace(trip, p) {
    if (!p || !p.place) return null;
    var placeId = _makePlaceId(p.place);
    if (!trip.places[placeId]) {
      trip.places[placeId] = {
        id: placeId,
        name: p.place,
        country: p.country || null,
        lat: (typeof p.lat === 'number') ? p.lat : null,
        lng: (typeof p.lng === 'number') ? p.lng : null,
        type: p.type || 'place'
      };
    } else {
      // Backfill lat/lng/country if they weren't set the first time
      // but are present this time.
      var existing = trip.places[placeId];
      if (existing.lat == null && typeof p.lat === 'number') existing.lat = p.lat;
      if (existing.lng == null && typeof p.lng === 'number') existing.lng = p.lng;
      if (!existing.country && p.country) existing.country = p.country;
    }
    return placeId;
  }

  // Build dest.days[] from dateFrom..dateTo. Each entry has a date
  // string and an empty planItems[]. If dates are missing, falls
  // back to dest.nights with date:null placeholders (rare; legacy
  // data should always have dates by now but we defend).
  function _buildDaysForDest(dest) {
    var days = [];
    if (dest.dateFrom && dest.dateTo) {
      var start = new Date(dest.dateFrom + 'T00:00:00Z');
      var end = new Date(dest.dateTo + 'T00:00:00Z');
      // Convention: dest.dateFrom is check-in, dest.dateTo is
      // check-out. Number of days at this dest = nights between
      // them (so days run dateFrom .. dateTo-1).
      var d = new Date(start);
      while (d < end) {
        days.push({
          date: d.toISOString().slice(0, 10),
          planItems: []
        });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    } else {
      var nights = (typeof dest.nights === 'number') ? dest.nights : 0;
      for (var i = 0; i < nights; i++) {
        days.push({ date: null, planItems: [] });
      }
    }
    return days;
  }

  // ── Migration: schema v0 → v1 ───────────────────────────────

  function _migrateV0toV1(envelope) {
    if (!envelope || !envelope.trip) return envelope;
    var trip = envelope.trip;

    // Ensure top-level places dictionary exists.
    if (!trip.places || typeof trip.places !== 'object') {
      trip.places = {};
    }

    var destinations = Array.isArray(trip.destinations) ? trip.destinations : [];

    // First pass: ensure each destination has a placeId and days[].
    destinations.forEach(function (dest) {
      if (!dest) return;

      // dest.placeId — link to trip.places. dest.place (string) stays
      // for back-compat readers during the transition.
      if (!dest.placeId) {
        dest.placeId = _getOrCreatePlace(trip, {
          place: dest.place,
          country: dest.country,
          lat: dest.lat,
          lng: dest.lng,
          type: 'city'
        });
      }

      // dest.days[] — one entry per calendar day at this destination.
      // If days already exist (from earlier code paths that built
      // them — legacy shape is {id, lbl, note, items}), normalize
      // each entry so it ALSO has the new shape's `date` and
      // `planItems` fields. Legacy fields (items, lbl, note, id) are
      // preserved — Phase 2 will migrate `items` into PlanItems.
      if (!Array.isArray(dest.days) || dest.days.length === 0) {
        dest.days = _buildDaysForDest(dest);
      } else {
        var startDate = dest.dateFrom ? new Date(dest.dateFrom + 'T00:00:00Z') : null;
        dest.days.forEach(function (day, idx) {
          if (!day) return;
          if (!Array.isArray(day.planItems)) day.planItems = [];
          if (!day.date && startDate) {
            var d = new Date(startDate);
            d.setUTCDate(d.getUTCDate() + idx);
            day.date = d.toISOString().slice(0, 10);
          }
        });
      }
    });

    // Second pass: migrate dest.dayTrips[] → PlanItems on day[0].
    // Note: Place entries are created even when day[0] doesn't exist —
    // the place is interesting regardless of whether we can attach it
    // to a calendar day. Without days, the PlanItem can't land, but
    // the Place still belongs in trip.places{}.
    destinations.forEach(function (dest) {
      if (!dest || !Array.isArray(dest.dayTrips) || !dest.dayTrips.length) return;
      var day0 = dest.days && dest.days[0];

      dest.dayTrips.forEach(function (dt) {
        if (!dt || !dt.place) return;
        var placeId = _getOrCreatePlace(trip, {
          place: dt.place,
          country: dt.country,
          lat: dt.lat,
          lng: dt.lng,
          type: 'sight'
        });
        if (!placeId) return;
        // No day to attach a PlanItem to; place was created above.
        if (!day0) return;

        // Idempotency: if a PlanItem for this dayTrip already exists
        // (perhaps from a partial earlier migration), skip.
        var existing = day0.planItems.find(function (pi) {
          return pi && pi.type === 'dayTrip' && pi.placeId === placeId;
        });
        if (existing) return;

        day0.planItems.push({
          id: _makeDayTripPlanItemId(dest.id || dest.placeId, placeId),
          type: 'dayTrip',
          state: 'suggestion',
          placeId: placeId,
          notes: dt.whyItFits || '',
          source: 'legacy-daytrip',
          // Carry the legacy bookkeeping along so the engine can
          // still do sourceNights math during the transition.
          legacy: {
            sourceNights: (typeof dt.sourceNights === 'number') ? dt.sourceNights : null,
            absorbedFromHub: dt.absorbedFromHub || null,
            distKm: (typeof dt.distKm === 'number') ? dt.distKm : null,
            clusteredAt: dt.clusteredAt || null
          }
        });
      });
    });

    trip._schemaVersion = 1;
    return envelope;
  }

  // ── Migration: schema v1 → v2 ───────────────────────────────
  //
  // Day-trips were v1 PlanItems on a hub's day[0]. In v2 they
  // become first-class Routes with kind:"dayTrip" (from === to ===
  // hubDestId), and the target place is carried as a {type:"stop",
  // priority:"iconic"} PlanItem inside the route's planItems[].
  // The hub day's planItems[] gets a {type:"route", routeId}
  // reference in place of the original dayTrip PlanItem.
  //
  // Also backfills stable day ids when missing — the bidirectional
  // route.transitDays[] ↔ day.id reference needs every day to have
  // a stable identifier.
  function _migrateV1toV2(envelope) {
    if (!envelope || !envelope.trip) return envelope;
    var trip = envelope.trip;

    if (!Array.isArray(trip.routes)) trip.routes = [];

    var destinations = Array.isArray(trip.destinations) ? trip.destinations : [];

    // Pass 1: backfill day ids. Existing legacy data uses {id,lbl,
    // note,items}; newer _buildDaysForDest output uses {date,
    // planItems} with no id. Normalize so every day has an id.
    destinations.forEach(function (dest) {
      if (!dest || !Array.isArray(dest.days)) return;
      var destKey = dest.id || dest.placeId || 'unknown';
      dest.days.forEach(function (day, idx) {
        if (day && !day.id) day.id = _makeDayId(destKey, idx);
      });
    });

    // Pass 2: lift every {type:"dayTrip"} PlanItem out of its day,
    // mint a Route for it, replace with a {type:"route"} reference.
    // Idempotent: if a route for (hubDestId, stopPlaceId) already
    // exists, add this day to its transitDays instead of duplicating.
    destinations.forEach(function (dest) {
      if (!dest || !Array.isArray(dest.days)) return;
      var hubDestId = dest.id || dest.placeId;
      if (!hubDestId) return;

      dest.days.forEach(function (day) {
        if (!day || !Array.isArray(day.planItems)) return;

        var nextPlanItems = [];
        day.planItems.forEach(function (pi) {
          if (!pi || pi.type !== 'dayTrip') {
            nextPlanItems.push(pi);
            return;
          }
          var stopPlaceId = pi.placeId;
          if (!stopPlaceId) {
            // Malformed — no place to point at. Drop the PlanItem
            // silently; the place dictionary entry (if any) is
            // unaffected.
            return;
          }
          var routeId = _makeDayTripRouteId(hubDestId, stopPlaceId);

          // Find or create the route for this (hub, target) pair.
          var route = trip.routes.find(function (r) { return r && r.id === routeId; });
          if (!route) {
            var stopPlanItem = {
              id: 'pi-stop-' + routeId,
              type: 'stop',
              state: pi.state || 'suggestion',
              placeId: stopPlaceId,
              priority: 'iconic',  // day-trip target — the point of the loop
              recommendedMin: null,
              notes: pi.notes || '',
              source: pi.source === 'legacy-daytrip' ? 'legacy-daytrip' : (pi.source || 'llm-suggestion'),
              // Carry the legacy bookkeeping along so the engine can
              // still do sourceNights math during the transition.
              legacy: pi.legacy || null
            };
            route = {
              id: routeId,
              kind: 'dayTrip',
              fromDestId: hubDestId,
              toDestId: hubDestId,
              modeOptions: [],
              modeChosen: null,
              transitDays: day.id ? [day.id] : [],
              durationHours: null,
              distKm: (pi.legacy && typeof pi.legacy.distKm === 'number') ? pi.legacy.distKm : null,
              character: 'dayTrip',
              fuelStops: [],
              planItems: [stopPlanItem],
              bookings: [],
              notes: ''
            };
            trip.routes.push(route);
          } else if (day.id && route.transitDays.indexOf(day.id) < 0) {
            // Route exists already (rare: same hub+target attached
            // to multiple days). Add this day to its transitDays.
            route.transitDays.push(day.id);
          }

          // Replace the dayTrip PlanItem with a route reference on
          // this day. Multiple day-references to the same route are
          // fine (a multi-day day-trip — also rare).
          nextPlanItems.push({
            id: 'pi-rt-' + routeId + '-' + (day.id || 'na'),
            type: 'route',
            state: 'scheduled',
            routeId: routeId,
            source: 'migration-v1-v2'
          });
        });

        day.planItems = nextPlanItems;
      });
    });

    trip._schemaVersion = 2;
    return envelope;
  }

  // ── Public entry point ──────────────────────────────────────

  // Migrate an envelope to the current schema version. Idempotent —
  // safe to call on already-migrated envelopes.
  //
  // NOTE: mutates the input envelope in place AND returns it. Tests
  // that care about non-mutation should JSON.parse(JSON.stringify())
  // first.
  function migrateTripShape(envelope) {
    if (!envelope || !envelope.trip) return envelope;
    var version = (typeof envelope.trip._schemaVersion === 'number')
      ? envelope.trip._schemaVersion
      : 0;

    if (version >= CURRENT_SCHEMA_VERSION) return envelope;

    if (version < 1) envelope = _migrateV0toV1(envelope);
    if (version < 2) envelope = _migrateV1toV2(envelope);

    return envelope;
  }

  // Returns true if the envelope needs migration (faster check than
  // running the full migration). Used by db.js to decide whether to
  // re-persist after read.
  function needsMigration(envelope) {
    if (!envelope || !envelope.trip) return false;
    var version = (typeof envelope.trip._schemaVersion === 'number')
      ? envelope.trip._schemaVersion
      : 0;
    return version < CURRENT_SCHEMA_VERSION;
  }

  // ── Public surface ──────────────────────────────────────────

  global.MaxMigration = {
    CURRENT_SCHEMA_VERSION: CURRENT_SCHEMA_VERSION,
    migrateTripShape: migrateTripShape,
    needsMigration: needsMigration,
    // Internal — exposed for tests; not for engine consumers.
    _internal: {
      makePlaceId: _makePlaceId,
      makeDayTripPlanItemId: _makeDayTripPlanItemId,
      makeDayTripRouteId: _makeDayTripRouteId,
      makeDayId: _makeDayId,
      buildDaysForDest: _buildDaysForDest,
      getOrCreatePlace: _getOrCreatePlace,
      migrateV0toV1: _migrateV0toV1,
      migrateV1toV2: _migrateV1toV2,
    },
  };
})(typeof window !== 'undefined' ? window : this);
