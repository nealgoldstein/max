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

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
