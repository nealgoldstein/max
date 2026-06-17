// tests/geo-extent-tests.mjs — #Place model, Phase C (OBJECT-MODEL.md Axis 1 + 3b).
//
// Geography becomes first-class: a place is a point | polygon | region; a
// trip/destination's extent is DERIVED from the places it contains (the fuzzy
// boundary); and the OBJECTIVE nesting relation `geo-within` is derivable. The
// key invariant — a derived extent CONTAINS every place it was derived from —
// is what makes fuzzy trip boundaries sound, and point-in-polygon is what makes
// "is this sight inside Yellowstone?" / sight-contains-destination real.
//
// Pure math, no app state. Run: node tests/geo-extent-tests.mjs
"use strict";
import "../geography-model.mjs"; // exposes globalThis.geoOf / extentOf / geoWithin
const G = /** @type {any} */ (globalThis);

var pass = 0, fail = 0;
function test(n, f) {
  try { f(); pass++; console.log("  ✓ " + n); }
  catch (e) { fail++; console.error("  ✗ " + n + " — " + (e && e.message)); }
}
var assert = await import("assert").then(function (m) { return m.default; });

console.log("\n#Place Phase C — geography: point|polygon|region, extent, geo-within");

// ── geoOf: normalize the three geometry kinds ──
test("geoOf: lat/lng → point", function () {
  assert.deepStrictEqual(G.geoOf({ lat: 64.1, lng: -21.9 }), { type: "point", lat: 64.1, lng: -21.9 });
});
test("geoOf: polygon → type polygon + derived bbox", function () {
  var poly = [[44, -111], [45, -111], [45, -110], [44, -110]];
  var g = G.geoOf({ polygon: poly });
  assert.strictEqual(g.type, "polygon");
  assert.deepStrictEqual(g.bbox, [44, -111, 45, -110]);
});
test("geoOf: explicit bbox → region", function () {
  assert.deepStrictEqual(G.geoOf({ bbox: [44, -111, 45, -110] }), { type: "region", bbox: [44, -111, 45, -110] });
});
test("geoOf: no coords → point with null", function () {
  assert.deepStrictEqual(G.geoOf({ place: "X" }), { type: "point", lat: null, lng: null });
});

// ── extentOf: derive a boundary from contained points ──
test("extentOf: bbox spans all contained points", function () {
  var places = [{ lat: 44.2, lng: -110.8 }, { lat: 44.8, lng: -110.2 }, { lat: 44.5, lng: -110.5 }];
  assert.deepStrictEqual(G.extentOf(places).bbox, [44.2, -110.8, 44.8, -110.2]);
});
test("extentOf: empty / coordless set → null", function () {
  assert.strictEqual(G.extentOf([]), null);
  assert.strictEqual(G.extentOf([{ place: "X" }]), null);
});

// ── geo-within: objective nesting ──
test("geoWithin: point inside / outside a region bbox", function () {
  var box = { bbox: [44, -111, 45, -110] };
  assert.strictEqual(G.geoWithin({ lat: 44.5, lng: -110.5 }, box), true);
  assert.strictEqual(G.geoWithin({ lat: 50, lng: -100 }, box), false);
});
test("geoWithin: point-in-polygon", function () {
  var park = { polygon: [[44, -111], [45, -111], [45, -110], [44, -110]] };
  assert.strictEqual(G.geoWithin({ lat: 44.5, lng: -110.5 }, park), true);
  assert.strictEqual(G.geoWithin({ lat: 44.5, lng: -109.5 }, park), false);
});
test("geoWithin: a bare point contains nothing", function () {
  assert.strictEqual(G.geoWithin({ lat: 44.5, lng: -110.5 }, { lat: 44.5, lng: -110.5 }), false);
});

// ── THE invariant: a derived extent contains every place it came from ──
test("INVARIANT: every place is geo-within its own derived extent (fuzzy boundary is sound)", function () {
  var places = [{ lat: 64.1, lng: -21.9 }, { lat: 65.7, lng: -18.1 }, { lat: 63.4, lng: -19.0 }, { lat: 64.9, lng: -23.7 }];
  var extent = G.extentOf(places); // the "trip boundary derived from its places"
  places.forEach(function (p, i) {
    assert.ok(G.geoWithin(p, extent), "place #" + i + " fell outside the derived extent");
  });
});

// ── THE product case: sight (region) contains destination (point) ──
test("sight-contains-destination: a lodge point inside a national-park polygon", function () {
  var yellowstone = { polygon: [[44.1, -111.1], [45.1, -111.1], [45.1, -109.9], [44.1, -109.9]] }; // a *sight*/region
  var lodge = { lat: 44.46, lng: -110.83 };                                                        // a *destination*
  assert.strictEqual(G.geoWithin(lodge, yellowstone), true);
});

// ── monotonicity: nested extents agree ──
test("monotonic: a point in a small region is in the enclosing region", function () {
  var small = { bbox: [44.4, -110.6, 44.6, -110.4] };
  var big = { bbox: [44, -111, 45, -110] };
  var pt = { lat: 44.5, lng: -110.5 };
  assert.ok(G.geoWithin(pt, small) && G.geoWithin(pt, big), "nesting not monotonic");
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
