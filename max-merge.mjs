// @ts-check
import { MaxBuild } from "./engine-build.mjs";
// max-merge.js — preserves user state when destinations are regenerated.
//
// PD.319-4. The Rebuild flow (saveActivityPickerEdits → MaxBuild
// rebuild mode) regenerates trip.destinations from kept candidates.
// publishTrip preserves destination identity by id (PD.310 rebuild
// mode), but per-destination user-owned fields aren't automatically
// merged forward:
//
//   - reservations  — hotel bookings, the worst-case loss
//   - bookings      — activity tickets
//   - notes         — per-destination free-text notes
//   - dayItems      — user-edited day plans
//   - dayTrips      — custom day-trip routes
//   - attachedEvents — concerts, conferences
//   - arrival/departure — user-set dates/times
//   - _isDayTrip / _dayTripHub — role decisions
//   - _pinned, _userReassigned — pinning + override flags
//   - suggestions[]._considered / _rejected — taste signals
//
// Plus top-level annotations keyed by destId:
//   - trip.destNotes, trip.destStories, trip.sightStories
//
// mergeUserStateIntoRegenerated walks oldTrip → newTrip and copies
// every user-owned field forward. Destinations match by id first
// (canonical), by normalized place name as a fallback (catches the
// "user-rebuilt the trip from the picker and id was regenerated"
// edge case).
//
// PURE — does not touch storage. Returns the merged trip; caller
// (engine-build's rebuild phase) decides whether to TripStore.replace.
//
// Tests in tests/data-preservation-tests.js verify every user-owned
// field listed in data-inventory.md survives a merge cycle.

const global = /** @type {any} */ (globalThis);
  "use strict";

  function _normKey(name) {
    if (!name) return "";
    if (typeof global._normPlaceName === "function") {
      return global._normPlaceName(name);
    }
    return String(name).toLowerCase().trim();
  }

  // Fields that get copied verbatim from oldDest → newDest if newDest
  // doesn't already have them set. Order matters only for readability;
  // each entry is independent. Keep this list in sync with the
  // per-destination row in data-inventory.md.
  var DEST_USER_FIELDS = [
    // Direct value fields
    "arrival",
    "departure",
    "notes",
    "_isDayTrip",
    "_dayTripHub",
    "_pinned",
    "_userReassigned",
    // Note: `nights` is mixed — LLM suggests, user can override.
    // We copy it forward ONLY IF the old had a user override flag.
    // For now we copy it always; the user's pace tweak is rarer to
    // re-derive than to overwrite.
    "nights"
  ];

  // Array fields where each item carries user content. Merge strategy:
  // if oldDest has items, REPLACE the newDest array with old (newDest
  // can't have anything but defaults for these — it's a regenerated
  // stub).
  var DEST_USER_ARRAYS = [
    "reservations",
    "bookings",
    "attachedEvents"
  ];

  // Per-suggestion user state. For each suggestion in newDest that
  // matches a suggestion in oldDest (by name), carry forward the user
  // flags. Don't overwrite the new LLM-generated description /
  // suggestion shape — just the per-user flags.
  var SUGGESTION_USER_FLAGS = [
    "_considered",
    "_rejected",
    "_pinned",
    "_userNote"
  ];

  // Top-level trip fields keyed by destId — preserve the whole map
  // for destinations that still exist in newTrip.
  var TRIP_ID_KEYED_MAPS = [
    "destNotes",
    "destStories"
  ];

  // Top-level user-owned trip fields that always carry forward.
  var TRIP_USER_FIELDS = [
    "name",
    "trackSpending",
    "_gapNudgeDismissed",
    "_enhanceHintDismissed"
  ];

  // Top-level user-owned objects (each carries through as-is).
  var TRIP_USER_OBJECTS = [
    "notes",
    "destNotes",
    "destStories",
    "sightStories",
    "ffHistories",
    "picker",
    "pendingActions"
  ];

  /**
   * Merge user-owned state from oldTrip into newTrip. Mutates
   * newTrip in place and returns it.
   *
   * @param {Object} oldTrip — pre-rebuild trip (with user state)
   * @param {Object} newTrip — post-rebuild trip (regenerated destinations)
   * @returns {Object} newTrip (mutated)
   */
  function mergeUserStateIntoRegenerated(oldTrip, newTrip) {
    if (!oldTrip || !newTrip) return newTrip;
    if (typeof oldTrip !== "object" || typeof newTrip !== "object") return newTrip;

    // ── Top-level fields ──
    TRIP_USER_FIELDS.forEach(function (field) {
      // Copy forward IF the old had it set (truthy or boolean false
      // explicitly set). Preserves "user turned off spending track."
      if (Object.prototype.hasOwnProperty.call(oldTrip, field)) {
        newTrip[field] = oldTrip[field];
      }
    });

    TRIP_USER_OBJECTS.forEach(function (field) {
      // For object/array fields, merge by replacing newTrip's empty
      // default with oldTrip's content. Only copy if oldTrip has a
      // non-empty value to avoid clobbering a deliberate empty.
      var v = oldTrip[field];
      if (v == null) return;
      if (typeof v === "object" && (
          (Array.isArray(v) && v.length === 0) ||
          (!Array.isArray(v) && Object.keys(v).length === 0)
        )) {
        // Old was empty — don't clobber whatever the new build set.
        return;
      }
      newTrip[field] = v;
    });

    // ── Brief: oldTrip.brief carries user input; always preserve ──
    // The new build's brief is reconstructed from _tb at mint time;
    // user-edited fields in oldTrip.brief should win.
    if (oldTrip.brief && typeof oldTrip.brief === "object") {
      // Merge field-by-field so the new brief's LLM-derived fields
      // (e.g. _classificationByPlace if newly computed) are kept.
      newTrip.brief = newTrip.brief || {};
      Object.keys(oldTrip.brief).forEach(function (k) {
        // User-input fields ALWAYS override. The new build can re-
        // compute derived fields if needed.
        newTrip.brief[k] = oldTrip.brief[k];
      });
    }

    // ── Per-destination merge ──
    if (!Array.isArray(oldTrip.destinations) || !Array.isArray(newTrip.destinations)) {
      return newTrip;
    }

    // Build lookup of old destinations: by id and by normalized place.
    var oldById = {};
    var oldByPlace = {};
    oldTrip.destinations.forEach(function (d) {
      if (!d) return;
      if (d.id) oldById[d.id] = d;
      if (d.place) oldByPlace[_normKey(d.place)] = d;
    });

    newTrip.destinations.forEach(function (nd) {
      if (!nd) return;
      // Match: by id first (canonical), by place as fallback.
      var od = (nd.id && oldById[nd.id])
            || (nd.place && oldByPlace[_normKey(nd.place)])
            || null;
      if (!od) return; // brand-new destination in newTrip — nothing to merge

      // Copy direct user fields (only if old had them set).
      DEST_USER_FIELDS.forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(od, field)) return;
        nd[field] = od[field];
      });

      // Copy user arrays (replace if old has content).
      DEST_USER_ARRAYS.forEach(function (field) {
        if (Array.isArray(od[field]) && od[field].length > 0) {
          nd[field] = od[field];
        }
      });

      // Merge suggestions[] user flags by suggestion name.
      if (Array.isArray(od.suggestions) && Array.isArray(nd.suggestions)) {
        var oldSuggByName = {};
        od.suggestions.forEach(function (s) {
          if (!s) return;
          var n = s.name || s.label || s.place;
          if (n) oldSuggByName[_normKey(n)] = s;
        });
        nd.suggestions.forEach(function (ns) {
          if (!ns) return;
          var nn = ns.name || ns.label || ns.place;
          if (!nn) return;
          var os = oldSuggByName[_normKey(nn)];
          if (!os) return;
          SUGGESTION_USER_FLAGS.forEach(function (flag) {
            if (Object.prototype.hasOwnProperty.call(os, flag)) {
              ns[flag] = os[flag];
            }
          });
          // Also carry forward per-sight notes if any.
          if (typeof os.notes === "string" && os.notes.trim()) {
            ns.notes = os.notes;
          }
        });
      }

      // dayItems and dayTrips: if old has items the user edited, keep
      // them. Otherwise the new build's defaults stand.
      if (Array.isArray(od.dayItems) && od.dayItems.length > 0) {
        // Preserve user-edited day items. Future enhancement: merge
        // by id rather than wholesale replace, so new LLM suggestions
        // can append.
        var userEdited = od.dayItems.filter(function (di) {
          return di && (di.userEdited || di.custom || di.manuallyAdded);
        });
        if (userEdited.length > 0 || !Array.isArray(nd.dayItems) || nd.dayItems.length === 0) {
          nd.dayItems = od.dayItems;
        }
      }
      if (Array.isArray(od.dayTrips) && od.dayTrips.length > 0) {
        var customTrips = od.dayTrips.filter(function (dt) {
          return dt && (dt.custom || dt.userAdded);
        });
        if (customTrips.length > 0 || !Array.isArray(nd.dayTrips) || nd.dayTrips.length === 0) {
          nd.dayTrips = od.dayTrips;
        }
      }
    });

    return newTrip;
  }

  // ── Diagnostics ──────────────────────────────────────────────────

  // Returns a summary of what was preserved during a merge. Useful
  // for support / debugging when a user reports "I lost X" after a
  // rebuild — diff the old vs new audit trail.
  function describePreservation(oldTrip, newTrip) {
    function _count(t, getter) {
      try { return getter(t); } catch (_) { return 0; }
    }
    return {
      reservationsBefore: _count(oldTrip, function (t) {
        return (t.destinations || []).reduce(function (sum, d) {
          return sum + ((d && d.reservations) || []).length;
        }, 0);
      }),
      reservationsAfter: _count(newTrip, function (t) {
        return (t.destinations || []).reduce(function (sum, d) {
          return sum + ((d && d.reservations) || []).length;
        }, 0);
      }),
      bookingsBefore: _count(oldTrip, function (t) {
        return (t.destinations || []).reduce(function (sum, d) {
          return sum + ((d && d.bookings) || []).length;
        }, 0);
      }),
      bookingsAfter: _count(newTrip, function (t) {
        return (t.destinations || []).reduce(function (sum, d) {
          return sum + ((d && d.bookings) || []).length;
        }, 0);
      }),
      consideredBefore: _count(oldTrip, function (t) {
        return (t.destinations || []).reduce(function (sum, d) {
          return sum + ((d && d.suggestions) || []).filter(function (s) {
            return s && s._considered;
          }).length;
        }, 0);
      }),
      consideredAfter: _count(newTrip, function (t) {
        return (t.destinations || []).reduce(function (sum, d) {
          return sum + ((d && d.suggestions) || []).filter(function (s) {
            return s && s._considered;
          }).length;
        }, 0);
      })
    };
  }

  // ── Export ───────────────────────────────────────────────────────

  global.MaxMerge = {
    mergeUserStateIntoRegenerated: mergeUserStateIntoRegenerated,
    describePreservation: describePreservation
  };

export default globalThis.MaxMerge;

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.DEST_USER_ARRAYS = DEST_USER_ARRAYS;
  __expg.DEST_USER_FIELDS = DEST_USER_FIELDS;
  __expg.SUGGESTION_USER_FLAGS = SUGGESTION_USER_FLAGS;
  __expg.TRIP_ID_KEYED_MAPS = TRIP_ID_KEYED_MAPS;
  __expg.TRIP_USER_FIELDS = TRIP_USER_FIELDS;
  __expg.TRIP_USER_OBJECTS = TRIP_USER_OBJECTS;
  __expg.describePreservation = describePreservation;
  __expg.mergeUserStateIntoRegenerated = mergeUserStateIntoRegenerated;
}
