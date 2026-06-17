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

// ── Phase D — the `sights` ACCESS LAYER (flat, identity-deduped) ───────────
// The sight analog of destinationsOf, with one structural difference: sights
// live as requiredPlaces NESTED in placeActivities sections, and a place may
// appear in SEVERAL sections — so there is no single canonical record to
// return by reference the way destinations had. This projection returns the
// deduped lean Place objects (role "sight") the registry already builds,
// carrying the axes flat readers need: identity.name, geo {lat,lng}, decision
// {kept, rejected}, exploredFrom. It serves the FLAT consumers (map pins,
// coverage audits, "is this a kept sight" membership); section-grouped
// renderers keep reading trip.placeActivities (their grouping is load-bearing).
function sightsOf(trip) {
  var out = [];
  buildRegistry(trip).forEach(function (p) { if (p.role === "sight") out.push(p); });
  return out;
}
// Shadow check: the sight projection is IDENTITY-faithful — every non-rejected
// requiredPlace identity is represented in the registry (as a sight, or as a
// destination when the same place is also a stay — dest role wins), and no
// sight Place is invented (each traces to a source requiredPlace). Set-identity,
// not reference identity (dedup makes the latter impossible). { ok, missing,
// invented }.
function sightsProjectionCheck(trip) {
  var reg = buildRegistry(trip);
  var sightKeys = new Set();
  reg.forEach(function (p) { if (p.role === "sight") sightKeys.add(p.id); });
  var wantKeys = new Set();
  ((trip && trip.placeActivities) || []).forEach(function (it) {
    if (!it || it.type === "route") return;
    (it.requiredPlaces || []).forEach(function (p) {
      if (!p || p._rejected === true) return;
      var k = _regKey(p.place || p.name);
      if (k) wantKeys.add(k);
    });
  });
  var missing = [], invented = [];
  wantKeys.forEach(function (k) { if (!reg.get(k)) missing.push(k); });
  sightKeys.forEach(function (k) { if (!wantKeys.has(k)) invented.push(k); });
  return { ok: missing.length === 0 && invented.length === 0, missing: missing, invented: invented };
}

// ── Phase D ROOT-CAUSE arc — keep/role as a PROJECTION, not a cached flag ──
// The disease behind every mirror bug: each requiredPlace STORES its own _keep
// (read in ~49 places) and MaxRoleWriter keeps it in sync with the flat
// decision. Stored-and-mirrored state can drift. The cure is structural: derive
// keep/role from the ONE decision (the candidate snapshot) through the canonical
// keepOf/roleOf rules, make the stored flags a pure projection, then DELETE the
// mirror — after which divergence is impossible by construction, not merely
// detected.
//
// keepFor/roleFor are the place-keyed projection over keepOf/roleOf.
// keepShadowCheck proves the stored flag already EQUALS the projection (so it is
// redundant and safe to retire). PURE core; the shadow resolves section-kind and
// origin via the live app predicates (window._isStaySection / _placeOrigin),
// with Node fallbacks + test overrides.
function _decisionFromCandidate(trip, key) {
  var cands = (trip && trip.candidates) || [];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (!c || _regKey(c.place) !== key) continue;
    var rejected = (c.role === "reject" || c.status === "reject");
    var kept = rejected ? false
             : (c.role && c.role !== "maybe") ? true
             : (c.status === "keep") ? true
             : null;                                   // undecided -> origin default
    var role = (c.role && c.role !== "maybe" && c.role !== "reject") ? c.role : null;
    return { kept: kept, rejected: rejected, role: role, hub: c.dayTripHub || c.waysideFromHub || null };
  }
  return null;
}
function keepFor(trip, rp, ctx) {
  ctx = ctx || {};
  var facts = MaxDecisions.factsOf({ isStay: !!ctx.isStay, origin: ctx.origin || (rp && rp._origin) });
  return MaxDecisions.keepOf(facts, _decisionFromCandidate(trip, _regKey(rp && (rp.place || rp.name))));
}
function roleFor(trip, rp, ctx) {
  ctx = ctx || {};
  var facts = MaxDecisions.factsOf({ isStay: !!ctx.isStay, origin: ctx.origin || (rp && rp._origin) });
  if (rp && rp.role && !facts.role) facts.role = rp.role;   // a stored suggested role rides along
  return MaxDecisions.roleOf(facts, _decisionFromCandidate(trip, _regKey(rp && (rp.place || rp.name))));
}
function keepShadowCheck(trip, opts) {
  opts = opts || {};
  var isStayFn = opts.isStay || ((typeof globalThis !== "undefined" && typeof globalThis._isStaySection === "function") ? globalThis._isStaySection : function () { return false; });
  var originFn = opts.origin || ((typeof globalThis !== "undefined" && typeof globalThis._placeOrigin === "function") ? globalThis._placeOrigin : function (p) { return (p && p._origin) || undefined; });
  var diffs = [], checked = 0;
  ((trip && trip.placeActivities) || []).forEach(function (it) {
    if (!it || it.type === "route") return;
    var isStay = false; try { isStay = !!isStayFn(it.section); } catch (_) {}  // _isStaySection takes the section NAME
    (it.requiredPlaces || []).forEach(function (p) {
      if (!p) return;
      checked++;
      var stored = (p._keep === true);
      var derived = keepFor(trip, p, { isStay: isStay, origin: originFn(p) });
      if (stored !== derived) diffs.push({ place: p.place || p.name, stored: stored, derived: derived });
    });
  });
  return { ok: diffs.length === 0, checked: checked, diffs: diffs };
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

// DIAGNOSTIC scan (looser) — SURFACES SUSPECTS, does not prove bugs.
// candidateMirrorCheck matches by canonical key — the same _normPlaceName the
// writer uses, which already strips country suffixes (PD.96), so it is sound
// and false-positive-free. This scan additionally matches with
// PlaceKey.relatedTo (token-overlap + word-prefix containment) to surface pairs
// the writer's EXACT matcher skipped — e.g. candidate "Þingvellir" vs
// requiredPlace "Þingvellir National Park", which the writer never bridges.
//
// IMPORTANT: a hit is NOT necessarily a bug. The `contains` relation is
// ambiguous: "Þingvellir" ⊂ "Þingvellir National Park" is the SAME place (real
// drift), but "Reykjavik" ⊂ "Reykjavik Old Harbour" is a DIFFERENT sub-place
// that legitimately holds its own flags. So a suspect needs a semantic call:
// if same place, the safe fix is an ALIAS (PlaceKey.learn) so both names
// resolve equal thereafter — NOT loosening the writer's matcher, which would
// smear a container's decision onto its sub-places. Only considers pairs the
// strict KEY missed (no double-count). Review tool; never a gate.
function candidateMirrorScan(trip) {
  var suspects = [];
  var cands = (trip && trip.candidates) || [];
  var rps = [];
  ((trip && trip.placeActivities) || []).forEach(function (it) {
    if (!it || it.type === "route") return;
    (it.requiredPlaces || []).forEach(function (p) { if (p && (p.place || p.name)) rps.push(p); });
  });
  if (!rps.length) return { ok: true, suspects: [] };
  var hasRel = !!(PlaceKey && typeof PlaceKey.relatedTo === "function");
  cands.forEach(function (c) {
    if (!_cmDecided(c)) return;
    var cn = c && c.place; if (!cn) return;
    var exactKey = _regKey(cn);
    var expKeep = _cmKept(c), expRej = _cmRejected(c), expDay = (c.role === "daytrip");
    rps.forEach(function (p) {
      var pn = p.place || p.name;
      if (_regKey(pn) === exactKey) return;           // strict check already owns this pair
      var related = false;
      if (hasRel) { try { related = PlaceKey.relatedTo(cn, pn); } catch (_) {} }
      if (!related) return;
      var bad = [];
      if (!!p._keep !== expKeep) bad.push("_keep");
      if (!!p._rejected !== expRej) bad.push("_rejected");
      if (!!p._isDayTrip !== expDay) bad.push("_isDayTrip");
      if (bad.length) suspects.push({ candidate: cn, requiredPlace: pn, fields: bad, candKey: exactKey, rpKey: _regKey(pn) });
    });
  });
  return { ok: suspects.length === 0, suspects: suspects };
}

var MaxPlaces = {
  buildRegistry: buildRegistry,
  registryShadowCheck: registryShadowCheck,
  destinationsOf: destinationsOf,
  destinationsProjectionCheck: destinationsProjectionCheck,
  sightsOf: sightsOf,
  sightsProjectionCheck: sightsProjectionCheck,
  keepFor: keepFor,
  roleFor: roleFor,
  keepShadowCheck: keepShadowCheck,
  candidateMirrorCheck: candidateMirrorCheck,
  candidateMirrorScan: candidateMirrorScan
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
  __expg._decisionFromCandidate = _decisionFromCandidate;
  __expg._pointGeo = _pointGeo;
  __expg._regKey = _regKey;
  __expg.buildRegistry = buildRegistry;
  __expg.candidateMirrorCheck = candidateMirrorCheck;
  __expg.candidateMirrorScan = candidateMirrorScan;
  __expg.destinationsOf = destinationsOf;
  __expg.destinationsProjectionCheck = destinationsProjectionCheck;
  __expg.keepFor = keepFor;
  __expg.keepShadowCheck = keepShadowCheck;
  __expg.registryShadowCheck = registryShadowCheck;
  __expg.roleFor = roleFor;
  __expg.sightsOf = sightsOf;
  __expg.sightsProjectionCheck = sightsProjectionCheck;
}
