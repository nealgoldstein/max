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

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
