// @ts-check
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
//   v3 — Segment polymorphic base. Trip, Stay, Route, Day all extend
//        Segment with shared fields (kind, startsAt, endsAt). Routes
//        gain subKind (transit/dayTrip/arrival/departure); v2's
//        route.kind moves to route.subKind, route.kind becomes "route".
//        Day gets refs[] mirroring v2's day.planItems[type:"route"]
//        — Reference is now its own type, distinct from PlanItem.
//        trip.brief.entry / trip.brief.tbExit are lifted into arrival/
//        departure Routes referenced via trip.arrival / trip.departure.
//        Phase 1 of v3 was the migration itself (additive — legacy
//        fields preserved); Phase 2/3 switched readers + writers to
//        the new shape.
//
//   v4 — Drop the legacy day.planItems[type:"route"] mirror. After v4,
//        day.refs[] is the only place route references live; day.planItems[]
//        is leaf content only (sights, meals, stops). The Segment +
//        subKind discriminator survive unchanged; readers that used
//        MaxMigration.routesForDay keep working because that helper
//        already prefers day.refs[].
//
// Trip envelopes that don't carry _schemaVersion are treated as
// version 0 (pre-migration). After migration, _schemaVersion is
// bumped so subsequent reads short-circuit.

const global = /** @type {any} */ (globalThis);
  'use strict';

  var CURRENT_SCHEMA_VERSION = 4;

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

  // PD.476 (data integrity): real coordinates only — reject the [0,0]
  // "null island" sentinel the LLM copies from the prompt's example JSON.
  // This get-or-create is where trip.places entries are born, so it's the
  // upstream source of the [0,0] Skógafoss that disappeared into the
  // Atlantic. Store null instead, so no place enters the registry with a
  // fake location for distance / directions / booking code to trust.
  function _realLL(lat, lng) {
    return typeof lat === 'number' && isFinite(lat)
        && typeof lng === 'number' && isFinite(lng)
        && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
  }

  // Get-or-create an entry in trip.places{} for the given place
  // descriptor. Returns the placeId. Mutates trip.places in place.
  function _getOrCreatePlace(trip, p) {
    if (!p || !p.place) return null;
    var placeId = _makePlaceId(p.place);
    var _real = _realLL(p.lat, p.lng);
    if (!trip.places[placeId]) {
      trip.places[placeId] = {
        id: placeId,
        name: p.place,
        country: p.country || null,
        lat: _real ? p.lat : null,
        lng: _real ? p.lng : null,
        type: p.type || 'place'
      };
    } else {
      // Backfill lat/lng/country if they weren't set the first time
      // but are present (and real) this time.
      var existing = trip.places[placeId];
      if (existing.lat == null && _real) existing.lat = p.lat;
      if (existing.lng == null && _real) existing.lng = p.lng;
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

  // ── Migration: schema v2 → v3 ───────────────────────────────
  //
  // Adds the Segment polymorphic base on Trip, Stays (destinations),
  // Routes, and Days. Adds Reference entries in day.refs[] mirroring
  // v2's day.planItems[type:"route"] (the new shape). Lifts route.kind
  // → route.subKind (route.kind becomes "route" — the Segment kind
  // discriminator). Synthesizes arrival + departure Routes from
  // trip.brief.entry / trip.brief.tbExit.
  //
  // v3 is additive in this phase — old fields (trip.destinations,
  // route.kind === "transit"|"dayTrip", day.planItems[type:"route"])
  // stay in place so v2 readers continue to work. Phase 2 of v3
  // switches readers to the new shape; Phase 3 drops the legacy
  // fields. Same staging the v1→v2 migration used.
  function _migrateV2toV3(envelope) {
    if (!envelope || !envelope.trip) return envelope;
    var trip = envelope.trip;

    // 1. Trip envelope as a Segment.
    trip.kind = "trip";
    if (!trip.routes || !Array.isArray(trip.routes)) trip.routes = [];
    var destinations = Array.isArray(trip.destinations) ? trip.destinations : [];
    var firstDest = destinations[0];
    var lastDest = destinations[destinations.length - 1];
    if (firstDest && firstDest.dateFrom) {
      trip.startsAt = { date: firstDest.dateFrom, placeId: firstDest.placeId || null };
    } else {
      trip.startsAt = trip.startsAt || null;
    }
    if (lastDest && lastDest.dateTo) {
      trip.endsAt = { date: lastDest.dateTo, placeId: lastDest.placeId || null };
    } else {
      trip.endsAt = trip.endsAt || null;
    }

    // 2. Each destination (Stay) gets Segment fields.
    destinations.forEach(function (dest) {
      if (!dest) return;
      dest.kind = "stay";
      if (dest.dateFrom) {
        dest.startsAt = { date: dest.dateFrom, placeId: dest.placeId || null };
      }
      if (dest.dateTo) {
        dest.endsAt = { date: dest.dateTo, placeId: dest.placeId || null };
      }
      // 2a. Each Day gets Segment fields + refs[] mirroring route-typed
      //     PlanItems.
      (dest.days || []).forEach(function (day) {
        if (!day) return;
        day.kind = "day";
        if (day.date) {
          day.startsAt = { date: day.date };
          var d = new Date(day.date + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1);
          day.endsAt = { date: d.toISOString().slice(0, 10) };
        }
        if (!Array.isArray(day.refs)) day.refs = [];
        (day.planItems || []).forEach(function (pi) {
          if (!pi || pi.type !== "route" || !pi.routeId) return;
          var hasRef = day.refs.some(function (r) {
            return r && r.targetKind === "route" && r.targetId === pi.routeId;
          });
          if (hasRef) return;
          day.refs.push({
            id: "ref-" + (day.id || "anon") + "-" + pi.routeId,
            kind: "reference",
            targetKind: "route",
            targetId: pi.routeId,
            startTime: pi.startTime || null,
            endTime: pi.endTime || null,
            source: "migration-v2-v3"
          });
        });
      });
    });

    // 3. Each Route: v2 kind ("transit"/"dayTrip") moves to subKind,
    //    kind becomes "route" (the Segment discriminator).
    (trip.routes || []).forEach(function (route) {
      if (!route) return;
      if (!route.subKind) {
        if (route.kind === "transit" || route.kind === "dayTrip"
            || route.kind === "arrival" || route.kind === "departure") {
          route.subKind = route.kind;
        } else {
          // Default: assume transit if we can't tell.
          route.subKind = "transit";
        }
      }
      route.kind = "route";
      // startsAt/endsAt for routes derive from their endpoints (the
      // fromDestId stay's endsAt and the toDestId stay's startsAt).
      // Leave them undefined; they're computable on read.
    });

    // 4. Synthesize arrival / departure Routes from the brief's
    //    entry / exit strings, if not already present.
    if (trip.brief && firstDest) {
      var entry = (trip.brief.entry || "").trim();
      if (entry && !trip.arrival) {
        var entryPlaceId = _getOrCreatePlace(trip, {
          place: entry, country: null, lat: null, lng: null, type: 'city'
        });
        var arrivalRouteId = "r-arrival-" + (entryPlaceId || "unknown") + "-" + (firstDest.id || firstDest.placeId || "first");
        var existingArrival = trip.routes.find(function (r) {
          return r && r.id === arrivalRouteId;
        });
        if (!existingArrival) {
          trip.routes.push({
            id: arrivalRouteId,
            kind: "route",
            subKind: "arrival",
            fromDestId: null,     // from outside the trip
            toDestId: firstDest.id || null,
            entryPlaceId: entryPlaceId || null,
            modeOptions: [],
            modeChosen: null,
            transitDays: [],
            durationHours: null,
            distKm: null,
            character: null,
            fuelStops: [],
            planItems: [],
            bookings: [],
            notes: ""
          });
        }
        trip.arrival = arrivalRouteId;
      }
    }
    if (trip.brief && lastDest) {
      var exit = (trip.brief.tbExit || "").trim();
      if (exit && !trip.departure) {
        var exitPlaceId = _getOrCreatePlace(trip, {
          place: exit, country: null, lat: null, lng: null, type: 'city'
        });
        var departureRouteId = "r-departure-" + (lastDest.id || lastDest.placeId || "last") + "-" + (exitPlaceId || "unknown");
        var existingDeparture = trip.routes.find(function (r) {
          return r && r.id === departureRouteId;
        });
        if (!existingDeparture) {
          trip.routes.push({
            id: departureRouteId,
            kind: "route",
            subKind: "departure",
            fromDestId: lastDest.id || null,
            toDestId: null,        // to outside the trip
            exitPlaceId: exitPlaceId || null,
            modeOptions: [],
            modeChosen: null,
            transitDays: [],
            durationHours: null,
            distKm: null,
            character: null,
            fuelStops: [],
            planItems: [],
            bookings: [],
            notes: ""
          });
        }
        trip.departure = departureRouteId;
      }
    }

    trip._schemaVersion = 3;
    return envelope;
  }

  // ── Migration: schema v3 → v4 ───────────────────────────────
  //
  // Drops the legacy day.planItems[type:"route"] mirror that v3 kept
  // alongside day.refs[]. After v4:
  //   • day.refs[] is the canonical "what routes does this day
  //     participate in" surface (already true for all live readers,
  //     which use MaxMigration.routesForDay → prefers refs[]).
  //   • day.planItems[] holds ONLY leaf content — sights, meals,
  //     stops. No more route-reference PlanItems.
  //
  // route.kind === "route" is preserved (Segment discriminator) and
  // route.subKind keeps the dayTrip/transit/arrival/departure value.
  // No code path reads route.kind for the dayTrip discriminator after
  // Phase 2/3 — the few remaining writer fallback branches still
  // accept it but no longer write it.
  function _migrateV3toV4(envelope) {
    if (!envelope || !envelope.trip) return envelope;
    var trip = envelope.trip;
    (trip.destinations || []).forEach(function (dest) {
      if (!dest || !Array.isArray(dest.days)) return;
      dest.days.forEach(function (day) {
        if (!day || !Array.isArray(day.planItems)) return;
        // Keep only non-route PlanItems. Route refs live on day.refs[].
        day.planItems = day.planItems.filter(function (pi) {
          return !(pi && pi.type === 'route');
        });
      });
    });
    trip._schemaVersion = 4;
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
    if (version < 3) envelope = _migrateV2toV3(envelope);
    if (version < 4) envelope = _migrateV3toV4(envelope);

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

  // ── v3 Segment helpers ──────────────────────────────────────
  //
  // Used by readers + writers to walk and mutate the post-v3 envelope
  // without sprinkling shape-checks across the codebase. Each helper
  // reads v3 first, then falls back to v2 (so a freshly-loaded but
  // not-yet-migrated envelope still works during the milliseconds
  // between db.get and migrateTripShape).
  //
  // Writers SHOULD emit both v3 and v2 fields during Phase 2/3 so
  // any straggler v2 reader keeps working; Phase 4 will drop the
  // legacy mirrors.

  // route.subKind on v3; for v2 envelopes, route.kind held the
  // discriminator. After migration route.kind === "route" — never
  // read route.kind for the discriminator on v3+ data.
  function routeSubKind(route) {
    if (!route) return null;
    if (route.subKind) return route.subKind;
    if (route.kind && route.kind !== 'route') return route.kind;
    return null;
  }

  function isDayTripRoute(route) {
    return routeSubKind(route) === 'dayTrip';
  }

  function isTransitRoute(route) {
    return routeSubKind(route) === 'transit';
  }

  // All routes scheduled on a given day. Prefers v3 day.refs[] over
  // v2 day.planItems[type:"route"]. Returns Route objects (resolved
  // through trip.routes[]) — callers don't have to do the lookup.
  function routesForDay(trip, day) {
    if (!trip || !day) return [];
    var routesById = {};
    (trip.routes || []).forEach(function (r) {
      if (r && r.id) routesById[r.id] = r;
    });
    var ids = {};
    if (Array.isArray(day.refs) && day.refs.length) {
      day.refs.forEach(function (ref) {
        if (ref && ref.targetKind === 'route' && ref.targetId) {
          ids[ref.targetId] = true;
        }
      });
    } else if (Array.isArray(day.planItems)) {
      day.planItems.forEach(function (pi) {
        if (pi && pi.type === 'route' && pi.routeId) {
          ids[pi.routeId] = true;
        }
      });
    }
    return Object.keys(ids)
      .map(function (id) { return routesById[id]; })
      .filter(Boolean);
  }

  // ISO date string (YYYY-MM-DD) + integer offset → ISO date string.
  // Day startsAt = day.date, endsAt = day.date + 1 day (per v3 spec).
  function _shiftIsoDate(iso, days) {
    if (!iso) return null;
    var d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // Build a v3 Day-segment from minimal inputs. Used by writers
  // creating a fresh Day (e.g. when rebuilding day-shells inside
  // convertDestToDayTrip).
  function newDaySegment(id, dateISO, label) {
    return {
      id:        id,
      kind:      'day',
      date:      dateISO,
      lbl:       label || null,
      startsAt:  dateISO,
      endsAt:    _shiftIsoDate(dateISO, 1),
      planItems: [],
      refs:      [],
    };
  }

  // Build a v3 Route-segment. `subKind` is the discriminator
  // ("transit"/"dayTrip"/"arrival"/"departure"). `extras` is merged
  // on top so callers can pass mode/duration/etc.
  function newRouteSegment(id, subKind, fromDestId, toDestId, extras) {
    var base = {
      id:            id,
      kind:          'route',
      subKind:       subKind,
      fromDestId:    fromDestId || null,
      toDestId:      toDestId || null,
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
      startsAt:      null,
      endsAt:        null,
    };
    if (extras && typeof extras === 'object') {
      Object.keys(extras).forEach(function (k) { base[k] = extras[k]; });
    }
    return base;
  }

  // Reference object for a Day's refs[]. v3 separates Reference
  // from PlanItem; this is the canonical factory.
  function newReference(targetKind, targetId, source) {
    return {
      id:         (targetKind || 'ref') + '-' + (targetId || '?') + '-' + Date.now(),
      targetKind: targetKind,
      targetId:   targetId,
      startTime:  null,
      endTime:    null,
      source:     source || 'user-scheduled',
    };
  }

  // Add a route reference to a day. v4: writes ONLY day.refs[].
  // (Earlier versions also pushed a legacy {type:"route"} PlanItem
  // onto day.planItems[]; that mirror was dropped in v3→v4.)
  // Idempotent — re-adding the same route is a no-op.
  function addRouteRefToDay(day, routeId, source) {
    if (!day || !routeId) return;
    if (!Array.isArray(day.refs)) day.refs = [];
    var hasRef = day.refs.some(function (ref) {
      return ref && ref.targetKind === 'route' && ref.targetId === routeId;
    });
    if (!hasRef) {
      day.refs.push(newReference('route', routeId, source));
    }
  }

  // Remove a route reference from a day. Cleans both day.refs[] AND
  // any legacy day.planItems[type:"route"] entry — defensive against
  // trips that haven't yet been migrated to v4 (the on-load migration
  // strips them, but we may mutate before that hook runs).
  function removeRouteRefFromDay(day, routeId) {
    if (!day || !routeId) return;
    if (Array.isArray(day.refs)) {
      day.refs = day.refs.filter(function (ref) {
        return !(ref && ref.targetKind === 'route' && ref.targetId === routeId);
      });
    }
    if (Array.isArray(day.planItems)) {
      day.planItems = day.planItems.filter(function (pi) {
        return !(pi && pi.type === 'route' && pi.routeId === routeId);
      });
    }
  }

  // ── Public surface ──────────────────────────────────────────

  global.MaxMigration = {
    CURRENT_SCHEMA_VERSION: CURRENT_SCHEMA_VERSION,
    migrateTripShape: migrateTripShape,
    needsMigration: needsMigration,
    // v3 Segment helpers — readers + writers throughout the app.
    routeSubKind: routeSubKind,
    isDayTripRoute: isDayTripRoute,
    isTransitRoute: isTransitRoute,
    routesForDay: routesForDay,
    newDaySegment: newDaySegment,
    newRouteSegment: newRouteSegment,
    newReference: newReference,
    addRouteRefToDay: addRouteRefToDay,
    removeRouteRefFromDay: removeRouteRefFromDay,
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
      migrateV2toV3: _migrateV2toV3,
      migrateV3toV4: _migrateV3toV4,
      shiftIsoDate: _shiftIsoDate,
    },
  };
export default globalThis.MaxMigration;

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
  __expg._buildDaysForDest = _buildDaysForDest;
  __expg._getOrCreatePlace = _getOrCreatePlace;
  __expg._makeDayId = _makeDayId;
  __expg._makeDayTripPlanItemId = _makeDayTripPlanItemId;
  __expg._makeDayTripRouteId = _makeDayTripRouteId;
  __expg._makePlaceId = _makePlaceId;
  __expg._migrateV0toV1 = _migrateV0toV1;
  __expg._migrateV1toV2 = _migrateV1toV2;
  __expg._migrateV2toV3 = _migrateV2toV3;
  __expg._migrateV3toV4 = _migrateV3toV4;
  __expg._shiftIsoDate = _shiftIsoDate;
  __expg.addRouteRefToDay = addRouteRefToDay;
  __expg.isDayTripRoute = isDayTripRoute;
  __expg.isTransitRoute = isTransitRoute;
  __expg.migrateTripShape = migrateTripShape;
  __expg.needsMigration = needsMigration;
  __expg.newDaySegment = newDaySegment;
  __expg.newReference = newReference;
  __expg.newRouteSegment = newRouteSegment;
  __expg.removeRouteRefFromDay = removeRouteRefFromDay;
  __expg.routeSubKind = routeSubKind;
  __expg.routesForDay = routesForDay;
}
