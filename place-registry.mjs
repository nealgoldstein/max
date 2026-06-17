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
        // a destination Place keeps a reference to its source record, so the
        // access layer (destinationsOf) returns the SAME objects in registry
        // order — making a reader's switch from trip.destinations a no-op.
        _destRecord: (forceRole === "destination") ? rec : null
      });
      return;
    }
    if (role === "destination") {                                    // dest wins
      place.role = "destination";
      if (forceRole === "destination") place._destRecord = rec;
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

// ── Phase D cutover — the `destinations` ACCESS LAYER ─────────────────────
// Return the destination records, sourced from the registry in order. This is
// the single accessor readers of trip.destinations migrate to: it yields the
// SAME record objects, so each migration is a behavioral no-op. Once every
// reader goes through here, the rich fields move into the Place and the stored
// array becomes derived — but readers never change again.
function destinationsOf(trip) {
  var out = [];
  buildRegistry(trip).forEach(function (p) {
    if (p.role === "destination" && p._destRecord) out.push(p._destRecord);
  });
  return out;
}
// Shadow check: the access layer returns trip.destinations EXACTLY — same record
// objects (reference identity), same order, same count. Reference identity is the
// strongest possible faithfulness proof: a reader cannot tell the difference.
function destinationsProjectionCheck(trip) {
  var proj = destinationsOf(trip);
  var orig = (trip && trip.destinations) || [];
  var diffs = [];
  if (proj.length !== orig.length) diffs.push("count " + proj.length + " != " + orig.length);
  for (var i = 0; i < Math.min(proj.length, orig.length); i++) {
    if (proj[i] !== orig[i]) {
      diffs.push("#" + i + " record-identity mismatch (" + ((orig[i] && (orig[i].place || orig[i].name)) || "?") + ")");
    }
  }
  return { ok: diffs.length === 0, diffs: diffs };
}

// ── #Place high-value arc — candidate ↔ requiredPlace MIRROR drift ────────
// trip.candidates (the discovery working set's persisted snapshot) and the
// placeActivities[*].requiredPlaces flags are TWO representations of the SAME
// decision. MaxRoleWriter keeps them in step by mutating a requiredPlace's
// flags whenever a candidate's role changes — matching the two by a NAME
// NORMALIZER. When the normalizers disagree (PD.86: "Akureyri" vs
// "Akureyri, Iceland") the candidate's role is set but the requiredPlace flag
// never flips — silent drift, the gray-pin bug class. This pure check derives
// the EXPECTED requiredPlace flags from each DECIDED candidate and reports
// where the live flags disagree, matching by the canonical key (PlaceKey).
//
// UNLIKE registryShadowCheck (a faithful union that must be green), this can
// legitimately go red on REAL drift — so it ships first as a non-fatal
// OBSERVER to measure trips in the wild, and is promoted to a hard gate only
// once the wild proves clean (or the drift sites are funneled out).
function _cmKept(c) {                       // mirror MaxRoleWriter keep-derivation
  var role = c && c.role;
  if (role === "reject" || role === "maybe") return false;
  if (role) return true;                    // a real role assignment (stay/see/daytrip/onway)
  return !!(c && c.status === "keep");      // no role: fall back to persisted status
}
function _cmRejected(c) {
  return !!(c && (c.role === "reject" || c.status === "reject"));
}
function _cmDecided(c) {                     // only assert on candidates that made a call
  if (!c) return false;
  if (_cmRejected(c)) return true;
  if (c.role && c.role !== "maybe") return true;
  return c.status === "keep";
}
function candidateMirrorCheck(trip) {
  var mismatches = [];
  var cands = (trip && trip.candidates) || [];
  var byKey = new Map();                     // requiredPlaces indexed by canonical key
  ((trip && trip.placeActivities) || []).forEach(function (it) {
    if (!it || it.type === "route") return;
    (it.requiredPlaces || []).forEach(function (p) {
      if (!p) return;
      var k = _regKey(p.place || p.name);
      if (!k) return;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(p);
    });
  });
  var checked = 0;
  cands.forEach(function (c) {
    if (!_cmDecided(c)) return;
    var k = _regKey(c && c.place);
    if (!k) return;
    var rps = byKey.get(k);
    if (!rps || !rps.length) return;         // no matched requiredPlace -> nothing to mirror
    var expKeep = _cmKept(c), expRej = _cmRejected(c), expDay = (c.role === "daytrip");
    rps.forEach(function (p) {
      checked++;
      if (!!p._keep !== expKeep)     mismatches.push({ place: c.place, key: k, field: "_keep",     expected: expKeep, actual: !!p._keep });
      if (!!p._rejected !== expRej)  mismatches.push({ place: c.place, key: k, field: "_rejected",  expected: expRej,  actual: !!p._rejected });
      if (!!p._isDayTrip !== expDay) mismatches.push({ place: c.place, key: k, field: "_isDayTrip", expected: expDay,  actual: !!p._isDayTrip });
    });
  });
  return { ok: mismatches.length === 0, checked: checked, mismatches: mismatches };
}

var MaxPlaces = {
  buildRegistry: buildRegistry,
  registryShadowCheck: registryShadowCheck,
  destinationsOf: destinationsOf,
  destinationsProjectionCheck: destinationsProjectionCheck,
  candidateMirrorCheck: candidateMirrorCheck
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
  __expg._cmDecided = _cmDecided;
  __expg._cmKept = _cmKept;
  __expg._cmRejected = _cmRejected;
  __expg._pointGeo = _pointGeo;
  __expg._regKey = _regKey;
  __expg.buildRegistry = buildRegistry;
  __expg.candidateMirrorCheck = candidateMirrorCheck;
  __expg.destinationsOf = destinationsOf;
  __expg.destinationsProjectionCheck = destinationsProjectionCheck;
  __expg.registryShadowCheck = registryShadowCheck;
}
