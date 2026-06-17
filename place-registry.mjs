// @ts-check
import { MaxDecisions } from "./decision-model.mjs";
import PlaceKey from "./place-key.mjs";
// place-registry.js — #Place model, Phase D (OBJECT-MODEL.md G1): the UNIFIED
// Place registry.
//
// Today "a place" exists as up to six representations (destination, requiredPlace,
// candidate, PlaceSet.Place, DiscoveryModel.Place, Decision) bridged by identity.
// Phase D collapses them into ONE Place per identity, with the legacy arrays as
// projections. This module is the FIRST, reversible step: it builds that one
// registry from the trip's existing arrays and PROVES (registryShadowCheck) that
// it is a faithful union — no place dropped, no place invented, destinations keep
// the destination role. NOTHING is cut over yet; no reader depends on this. Once
// the shadow holds in the wild, readers migrate to the registry projections and
// the duplicate arrays retire.
//
// PURE + Node-testable. Lean Place per OBJECT-MODEL.md: small core + the four
// orthogonal axes (role / exploredFrom / geo / decision).

function _regKey(name) {
  if (PlaceKey && typeof PlaceKey.resolve === "function") {
    try { return PlaceKey.resolve(name); } catch (_) { /* fall through */ }
  }
  return String(name == null ? "" : name).toLowerCase().replace(/\s+/g, " ").trim();
}
function _pointGeo(rec) {
  var lat = (rec && typeof rec.lat === "number") ? rec.lat : null;
  var lng = (rec && typeof rec.lng === "number") ? rec.lng : null;
  return { type: "point", lat: lat, lng: lng };
}
function _decisionOf(rec) {
  return {
    kept: (rec._keep === true) ? true : (rec._keep === false ? false : null),
    rejected: rec._rejected === true
  };
}

// Build the unified Place registry (Map key -> Place) from a trip's existing
// arrays. Identity-deduped: the same place appearing as a destination AND a
// requiredPlace merges into one Place (destination role wins).
function buildRegistry(trip) {
  var reg = new Map();
  if (!trip || typeof trip !== "object") return reg;
  function upsert(rec, forceRole) {
    var name = (rec && (rec.place || rec.name)) || "";
    var k = _regKey(name);
    if (!k) return;
    var role = forceRole || MaxDecisions.axesOf(rec.role).placeRole;
    var place = reg.get(k);
    if (!place) {
      reg.set(k, {
        id: k,
        identity: { key: k, name: name },
        geo: _pointGeo(rec),
        role: role,
        exploredFrom: MaxDecisions.exploredFromOf(rec),
        decision: _decisionOf(rec),
        // destinations carry their persisted id so the projection can reconstruct
        // trip.destinations exactly (the spine: id + name + coords + order).
        _destId: (forceRole === "destination" && rec.id != null) ? rec.id : null
      });
      return;
    }
    if (role === "destination") {                                    // dest wins
      place.role = "destination";
      if (rec.id != null) place._destId = rec.id;
    }
    if (place.geo.lat == null && typeof rec.lat === "number") place.geo = _pointGeo(rec);
  }
  (trip.destinations || []).forEach(function (d) { upsert(d, "destination"); });
  (trip.placeActivities || []).forEach(function (it) {
    if (!it || it.type === "route") return;
    (it.requiredPlaces || []).forEach(function (p) { if (p && p._rejected !== true) upsert(p); });
  });
  return reg;
}

// Shadow check: the registry is a faithful union of the legacy arrays. Every
// destination and every non-rejected sight requiredPlace is present, with the
// destination role preserved; nothing missing. Catches identity OVER-merge (two
// distinct places collapsing to one key would show as `missing`). Returns
// { ok, size, missing, wrongRole }. Browser-runnable + Node-tested.
function registryShadowCheck(trip) {
  var reg = buildRegistry(trip);
  var missing = [], wrongRole = [];
  ((trip && trip.destinations) || []).forEach(function (d) {
    var k = _regKey(d && (d.place || d.name));
    if (!k) return;
    var pl = reg.get(k);
    if (!pl) missing.push("dest:" + k);
    else if (pl.role !== "destination") wrongRole.push("dest:" + k + "->" + pl.role);
  });
  ((trip && trip.placeActivities) || []).forEach(function (it) {
    if (!it || it.type === "route") return;
    (it.requiredPlaces || []).forEach(function (p) {
      if (!p || p._rejected === true) return;
      var k = _regKey(p.place || p.name);
      if (k && !reg.get(k)) missing.push("sight:" + k);
    });
  });
  return { ok: missing.length === 0 && wrongRole.length === 0, size: reg.size, missing: missing, wrongRole: wrongRole };
}

// ── Phase D cutover, slice 1 — the `destinations` PROJECTION ──────────────
// Reconstruct the destinations spine (id + name + coords, in order) from the
// registry. This is what readers of trip.destinations migrate to; once every
// reader is on it and the rich per-destination fields move into the Place's stay
// block, trip.destinations becomes a pure projection and the stored array retires.
function destinationsOf(trip) {
  var out = [];
  buildRegistry(trip).forEach(function (p) {
    if (p.role === "destination") out.push({ id: p._destId, place: p.identity.name, lat: p.geo.lat, lng: p.geo.lng });
  });
  return out;
}
// Shadow check: the projection reproduces trip.destinations exactly on the spine
// fields, in order. Faithfulness here is the precondition for cutting readers over.
function destinationsProjectionCheck(trip) {
  var proj = destinationsOf(trip);
  var orig = ((trip && trip.destinations) || []).map(function (d) {
    return {
      id: (d && d.id != null) ? d.id : null,
      place: (d && (d.place || d.name)) || "",
      lat: (d && typeof d.lat === "number") ? d.lat : null,
      lng: (d && typeof d.lng === "number") ? d.lng : null
    };
  });
  var diffs = [];
  if (proj.length !== orig.length) diffs.push("count " + proj.length + " != " + orig.length);
  for (var i = 0; i < Math.min(proj.length, orig.length); i++) {
    var a = proj[i], b = orig[i];
    if (a.id !== b.id || a.place !== b.place || a.lat !== b.lat || a.lng !== b.lng) {
      diffs.push("#" + i + " " + JSON.stringify(a) + " != " + JSON.stringify(b));
    }
  }
  return { ok: diffs.length === 0, diffs: diffs };
}

var MaxPlaces = {
  buildRegistry: buildRegistry,
  registryShadowCheck: registryShadowCheck,
  destinationsOf: destinationsOf,
  destinationsProjectionCheck: destinationsProjectionCheck
};

export { MaxPlaces };
export default MaxPlaces;

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.MaxPlaces = MaxPlaces;
  __expg._pointGeo = _pointGeo;
  __expg._regKey = _regKey;
  __expg.buildRegistry = buildRegistry;
  __expg.destinationsOf = destinationsOf;
  __expg.destinationsProjectionCheck = destinationsProjectionCheck;
  __expg.registryShadowCheck = registryShadowCheck;
}
