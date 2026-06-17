// tests/place-registry-tests.mjs — #Place model, Phase D (OBJECT-MODEL.md G1).
//
// The unified Place registry must be a FAITHFUL UNION of the trip's existing
// arrays: every destination and every non-rejected sight present exactly once
// (identity-deduped), destinations keeping the destination role, each Place
// carrying the four orthogonal axes. This is the additive-shadow proof — no
// reader is cut over — that the registry tracks reality before anything depends
// on it. Run: node tests/place-registry-tests.mjs
"use strict";
import assert from "assert";
import MaxPlaces from "../place-registry.mjs";

var pass = 0, fail = 0;
function test(n, f) {
  try { f(); pass++; console.log("  ✓ " + n); }
  catch (e) { fail++; console.error("  ✗ " + n + " — " + (e && e.message)); }
}

var trip = {
  destinations: [
    { place: "Reykjavik", lat: 64.1, lng: -21.9, nights: 2 },
    { place: "Akureyri", lat: 65.7, lng: -18.1, nights: 1 }
  ],
  placeActivities: [
    { type: "activity", section: "Sights near places you listed", requiredPlaces: [
      { place: "Gullfoss", role: "daytrip", _dayTripHub: "Reykjavik", _keep: true, lat: 64.3, lng: -20.1 },
      { place: "Reykjavik", role: "stay", _keep: true },        // same as a destination → merges
      { place: "RejectedSpot", role: "see", _rejected: true }   // excluded
    ] },
    { type: "route", requiredPlaces: [{ place: "ignored-route-leg" }] } // routes ignored
  ]
};

console.log("\n#Place Phase D — unified registry is a faithful union (shadow)");

test("registry dedups dest+sight by identity (Reykjavik once)", function () {
  var reg = MaxPlaces.buildRegistry(trip);
  assert.strictEqual(reg.size, 3, "expected Reykjavik, Akureyri, Gullfoss"); // RejectedSpot + route excluded
});
test("a destination keeps the destination role even when also a stay requiredPlace", function () {
  var reg = MaxPlaces.buildRegistry(trip);
  assert.strictEqual(reg.get("reykjavik").role, "destination");
});
test("a sight carries its explored-from + point geo axes", function () {
  var g = MaxPlaces.buildRegistry(trip).get("gullfoss");
  assert.strictEqual(g.role, "sight");
  assert.strictEqual(g.exploredFrom.kind, "daytrip");
  assert.strictEqual(g.exploredFrom.hub, "Reykjavik");
  assert.deepStrictEqual(g.geo, { type: "point", lat: 64.3, lng: -20.1 });
  assert.strictEqual(g.decision.kept, true);
});
test("rejected places + route legs are excluded", function () {
  var reg = MaxPlaces.buildRegistry(trip);
  assert.ok(!reg.get("rejectedspot"), "rejected place leaked in");
  assert.ok(!reg.get("ignored-route-leg"), "route leg leaked in");
});
test("SHADOW: registry is a faithful union of the legacy arrays", function () {
  var r = MaxPlaces.registryShadowCheck(trip);
  assert.ok(r.ok, "missing=" + r.missing.join(",") + " wrongRole=" + r.wrongRole.join(","));
});
test("empty / missing trip → empty registry, shadow ok", function () {
  assert.strictEqual(MaxPlaces.buildRegistry(null).size, 0);
  assert.ok(MaxPlaces.registryShadowCheck({}).ok);
});

// ── Phase D cutover: the destinations ACCESS LAYER (full records by reference) ──
test("destinationsOf returns the SAME destination records, in order", function () {
  var proj = MaxPlaces.destinationsOf(trip);
  assert.strictEqual(proj.length, 2);
  assert.strictEqual(proj[0], trip.destinations[0]); // reference identity — no-op swap
  assert.strictEqual(proj[1], trip.destinations[1]);
});
test("SHADOW: access layer reproduces trip.destinations exactly (reference identity)", function () {
  var r = MaxPlaces.destinationsProjectionCheck(trip);
  assert.ok(r.ok, "diffs: " + r.diffs.join(" | "));
});
test("access layer preserves order + carries full record (rich fields intact)", function () {
  var d2 = { id: "d-2", place: "Vik", lat: 63.4, lng: -19.0, nights: 2, hotelBookings: [{ x: 1 }] };
  var d1 = { id: "d-1", place: "Hofn", lat: 64.2, lng: -15.2, nights: 1 };
  var t2 = { destinations: [d2, d1] };
  var proj = MaxPlaces.destinationsOf(t2);
  assert.strictEqual(proj[0], d2);   // full record, incl. hotelBookings
  assert.strictEqual(proj[1], d1);
  assert.ok(MaxPlaces.destinationsProjectionCheck(t2).ok);
});

// ── high-value arc: candidate ↔ requiredPlace MIRROR drift detector ────────
// The check derives EXPECTED requiredPlace flags from each decided candidate
// and reports where the live flags disagree. Green on a consistent trip; it
// must CATCH every flavor of real drift (the gray-pin bug class).
console.log("\n#Place high-value arc — candidate↔requiredPlace mirror drift");

function mirrorTrip(rpOverrides) {
  // a candidate of each decided kind, each with a matching requiredPlace whose
  // flags are correct — then callers corrupt one to prove the check catches it.
  var rp = {
    keep:   { place: "Gullfoss",  _keep: true,  _rejected: false, _isDayTrip: false },
    daytrip:{ place: "Geysir",    _keep: true,  _rejected: false, _isDayTrip: true  },
    reject: { place: "TouristTrap", _keep: false, _rejected: true,  _isDayTrip: false }
  };
  Object.keys(rpOverrides || {}).forEach(function (k) { Object.assign(rp[k], rpOverrides[k]); });
  return {
    candidates: [
      { place: "Gullfoss", role: "see",     status: "keep" },
      { place: "Geysir",   role: "daytrip", status: "keep", dayTripHub: "Reykjavik" },
      { place: "TouristTrap", role: "reject", status: "reject" },
      { place: "Maybeland", role: "maybe",  status: null }   // undecided → never asserted
    ],
    placeActivities: [
      { type: "activity", requiredPlaces: [rp.keep, rp.daytrip, rp.reject,
        { place: "Maybeland", _keep: false, _rejected: false, _isDayTrip: false } ] },
      { type: "route", requiredPlaces: [{ place: "leg" }] }  // routes ignored
    ]
  };
}

test("mirror check is OK when candidate roles and requiredPlace flags agree", function () {
  var r = MaxPlaces.candidateMirrorCheck(mirrorTrip());
  assert.ok(r.ok, "unexpected mismatches: " + JSON.stringify(r.mismatches));
  assert.strictEqual(r.checked, 3, "should check the 3 decided+matched candidates");
});
test("empty candidates / missing trip → ok (no false positive)", function () {
  assert.ok(MaxPlaces.candidateMirrorCheck({}).ok);
  assert.ok(MaxPlaces.candidateMirrorCheck(null).ok);
  assert.ok(MaxPlaces.candidateMirrorCheck({ candidates: [], placeActivities: [] }).ok);
});
test("CATCHES kept candidate whose requiredPlace _keep never flipped (PD.86)", function () {
  var r = MaxPlaces.candidateMirrorCheck(mirrorTrip({ keep: { _keep: false } }));
  assert.ok(!r.ok);
  assert.ok(r.mismatches.some(function (m) { return m.field === "_keep" && m.key === "gullfoss" && m.expected === true; }));
});
test("CATCHES rejected candidate whose requiredPlace _rejected stayed false", function () {
  var r = MaxPlaces.candidateMirrorCheck(mirrorTrip({ reject: { _rejected: false, _keep: true } }));
  assert.ok(!r.ok);
  assert.ok(r.mismatches.some(function (m) { return m.field === "_rejected" && m.expected === true; }));
});
test("CATCHES daytrip candidate whose requiredPlace _isDayTrip stayed false", function () {
  var r = MaxPlaces.candidateMirrorCheck(mirrorTrip({ daytrip: { _isDayTrip: false } }));
  assert.ok(!r.ok);
  assert.ok(r.mismatches.some(function (m) { return m.field === "_isDayTrip" && m.key === "geysir"; }));
});
test("undecided (maybe) candidate is never asserted, even if flags look off", function () {
  // Maybeland is maybe/null → no expectation, so corrupting its flags is silent
  var t = mirrorTrip();
  t.placeActivities[0].requiredPlaces[3]._keep = true;
  assert.ok(MaxPlaces.candidateMirrorCheck(t).ok);
});
test("a decided candidate with NO matching requiredPlace is skipped (no false positive)", function () {
  var t = { candidates: [{ place: "Orphan", role: "see", status: "keep" }], placeActivities: [] };
  var r = MaxPlaces.candidateMirrorCheck(t);
  assert.ok(r.ok);
  assert.strictEqual(r.checked, 0);
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
