// @ts-check
// discovery-persistence.js — SSOT Phase 3: the persistence seam.
//
// Two responsibilities, both pure of TripStore/DOM so they're unit-testable and
// reusable; Phase 5/6 wires them to the live session + TripStore, retiring the
// scattered _persistDiscoveryState / _initialTripSave calls.
//
//   1. writeModelToTrip(trip, model) — the CLEAN INVERSE of IngestionService:
//      serialize the model's sight sections back into trip.placeActivities,
//      PRESERVING the non-model passthrough items (stays, routes, conditions)
//      the DiscoveryModel deliberately doesn't own. This is the single
//      "model → trip" writer (replacing _applyDiscoveryModelToSights' write-back).
//
//   2. bind(model, save, ms) — the event→debounced-save pump: subscribe to the
//      model's "change" (Phase 1) and call save(model) at most once per quiet
//      window. This is how persistence (and, later, the renderer) react to
//      mutations without every call site remembering to save.
const global = /** @type {any} */ (globalThis);
  "use strict";

  function _SK() { return global.SectionKind || null; }
  function _isStaySec(s) { var SK = _SK(); return SK ? SK.isStay(s) : false; }

  // Items the DiscoveryModel does NOT own — carried through untouched.
  function _isPassthrough(it) {
    return !!it && (
      _isStaySec(it.section) ||
      it.type === "route" ||
      it.type === "condition" ||
      (it.type && /^synthetic-stays$/.test(it.type)) ||
      /^routes\s*[&]\s*regions/i.test(String(it.section || ""))
    );
  }

  function writeModelToTrip(trip, model) {
    if (!trip || !model || typeof model.sections !== "function") return trip;
    var existing = Array.isArray(trip.placeActivities) ? trip.placeActivities : [];
    var passthrough = existing.filter(_isPassthrough);
    var prevBySection = Object.create(null);
    existing.forEach(function (it) { if (it && it.section) prevBySection[it.section] = it; });

    // Rebuild the model-owned (sight) items from the model's sections. Matches
    // the historical _applyDiscoveryModelToSights: clone the prior item's
    // editorial fields, override only placement.
    var sightItems = model.sections().map(function (grp) {
      var template = prevBySection[grp.section] || {};
      var item = {};
      for (var k in template) { if (Object.prototype.hasOwnProperty.call(template, k)) item[k] = template[k]; }
      item.id = template.id || ("model-" + String(grp.section).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      item.section = grp.section;
      item.name = template.name || grp.section;
      item.type = template.type || "activity";
      item.checked = grp.places.some(function (p) { return p.decision === "checked"; });
      item.requiredPlaces = grp.places.map(function (p) {
        var sp = (p.src && typeof p.src === "object") ? p.src : { place: p.place };
        sp._keep = (p.decision !== "unchecked");
        sp._rejected = (p.decision === "rejected");
        return sp;
      });
      return item;
    });

    // Preserve REJECTED places. model.sections() omits them (the view never
    // shows a rejected sight), but persistence MUST keep them so the user can
    // re-add later — the Round DX contract, and a guard against reject() making
    // a place silently disappear. Re-home each into its placement section,
    // flagged rejected; on the next ingest it round-trips back as decision:rejected.
    var Policy = global.MaxDiscovery && global.MaxDiscovery.PlacementPolicy;
    if (Policy && typeof model.all === "function") {
      var bySec = Object.create(null);
      sightItems.forEach(function (it) { bySec[it.section] = it; });
      model.all().forEach(function (p) {
        if (!p || p.decision !== "rejected") return;
        var sec = Policy.sectionFor(p);
        var item = bySec[sec];
        if (!item) {
          item = { id: "model-" + String(sec).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            section: sec, name: sec, type: "activity", checked: false, requiredPlaces: [] };
          bySec[sec] = item; sightItems.push(item);
        }
        if (!Array.isArray(item.requiredPlaces)) item.requiredPlaces = [];
        var already = item.requiredPlaces.some(function (q) { return q && q.place === p.place; });
        if (!already) {
          var sp = (p.src && typeof p.src === "object") ? p.src : { place: p.place };
          sp._keep = false; sp._rejected = true;
          item.requiredPlaces.push(sp);
        }
      });
    }

    trip.placeActivities = passthrough.concat(sightItems).filter(function (it) {
      return it && Array.isArray(it.requiredPlaces) &&
        (it.requiredPlaces.length || _isStaySec(it.section) || it.type === "route");
    });
    return trip;
  }

  // Subscribe save(model) to the model's "change", debounced. Returns unbind().
  function bind(model, save, debounceMs) {
    if (!model || typeof model.on !== "function" || typeof save !== "function") return function () {};
    debounceMs = (typeof debounceMs === "number") ? debounceMs : 600;
    var timer = null;
    var off = model.on("change", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        try { save(model); }
        catch (e) { if (typeof console !== "undefined") console.warn("[MaxPersistence] save failed:", e && e.message); }
      }, debounceMs);
    });
    return function unbind() { if (timer) { clearTimeout(timer); timer = null; } off(); };
  }

  var api = { writeModelToTrip: writeModelToTrip, bind: bind };
  global.MaxPersistence = api;
export default api;

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._isPassthrough = _isPassthrough;
  __expg._isStaySec = _isStaySec;
  __expg.bind = bind;
  __expg.writeModelToTrip = writeModelToTrip;
}
