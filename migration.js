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
// Trip envelopes that don't carry _schemaVersion are treated as
// version 0 (pre-migration). After migration, _schemaVersion is
// bumped so subsequent reads short-circuit.

(function (global) {
  'use strict';

  var CURRENT_SCHEMA_VERSION = 1;

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
      buildDaysForDest: _buildDaysForDest,
      getOrCreatePlace: _getOrCreatePlace,
    },
  };
})(typeof window !== 'undefined' ? window : this);
