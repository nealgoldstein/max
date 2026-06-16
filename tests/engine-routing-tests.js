// tests/engine-routing-tests.js — MaxRoute (PD.330).
//
// Pure unit tests for parse() and build(). The navigate/on path
// uses browser APIs (history.pushState, popstate, hashchange) so it's
// covered by Playwright tests, not these.

"use strict";

var assert = require("assert");
var path = require("path");
var fs = require("fs");

// Minimal browser-ish globals so engine-routing.js loads under Node.
global.window = global;
global.history = {};               // pushState/replaceState absent → falls through
global.location = { hash: "" };    // mutate per-test
global.addEventListener = function () {}; // skip listener wiring

require(path.join(__dirname, "..", "engine-routing.mjs"));

var MaxRoute = global.MaxRoute;
if (!MaxRoute) {
  console.error("MaxRoute not exported");
  process.exit(1);
}

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ✓ " + name);
    passed++;
  } catch (e) {
    console.log("  ✗ " + name);
    console.log("    " + (e && e.message));
    failed++;
  }
}

console.log("\nengine-routing — parse\n");

test("empty hash → home", function () {
  assert.deepStrictEqual(MaxRoute.parse(""), { screen: "home" });
  assert.deepStrictEqual(MaxRoute.parse("#"), { screen: "home" });
  assert.deepStrictEqual(MaxRoute.parse("#/"), { screen: "home" });
});

test("#/trip/<id> → trip overview", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/trip-abc"),
    { screen: "trip", tripId: "trip-abc" }
  );
});

test("#/trip/<id>/discovery → discovery", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/trip-abc/discovery"),
    { screen: "discovery", tripId: "trip-abc" }
  );
});

test("#/trip/<id>/brief → brief", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/trip-abc/brief"),
    { screen: "brief", tripId: "trip-abc" }
  );
});

test("#/trip/<id>/dest/<destId> → dest", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/trip-abc/dest/d3"),
    { screen: "dest", tripId: "trip-abc", destId: "d3" }
  );
});

test("unknown sub-screen → trip overview", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/trip-abc/bogus"),
    { screen: "trip", tripId: "trip-abc" }
  );
});

test("dest with no destId → trip overview", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/trip-abc/dest"),
    { screen: "trip", tripId: "trip-abc" }
  );
});

test("malformed first segment → home", function () {
  assert.deepStrictEqual(MaxRoute.parse("#/foo"), { screen: "home" });
  assert.deepStrictEqual(MaxRoute.parse("#/trip"), { screen: "home" });
  assert.deepStrictEqual(MaxRoute.parse("#/trip/"), { screen: "home" });
});

test("URI-encoded tripId is decoded", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/trip-1780%20test"),
    { screen: "trip", tripId: "trip-1780 test" }
  );
});

test("URI-encoded destId is decoded", function () {
  assert.deepStrictEqual(
    MaxRoute.parse("#/trip/abc/dest/d%2F1"),
    { screen: "dest", tripId: "abc", destId: "d/1" }
  );
});

test("reads window.location.hash when no arg", function () {
  global.location.hash = "#/trip/from-window";
  assert.deepStrictEqual(
    MaxRoute.parse(),
    { screen: "trip", tripId: "from-window" }
  );
  global.location.hash = "";
});

console.log("\nengine-routing — build\n");

test("home → '#/'", function () {
  assert.strictEqual(MaxRoute.build({ screen: "home" }), "#/");
  assert.strictEqual(MaxRoute.build(null), "#/");
  assert.strictEqual(MaxRoute.build(undefined), "#/");
});

test("trip → '#/trip/<id>'", function () {
  assert.strictEqual(
    MaxRoute.build({ screen: "trip", tripId: "trip-abc" }),
    "#/trip/trip-abc"
  );
});

test("discovery → '#/trip/<id>/discovery'", function () {
  assert.strictEqual(
    MaxRoute.build({ screen: "discovery", tripId: "trip-abc" }),
    "#/trip/trip-abc/discovery"
  );
});

test("brief → '#/trip/<id>/brief'", function () {
  assert.strictEqual(
    MaxRoute.build({ screen: "brief", tripId: "trip-abc" }),
    "#/trip/trip-abc/brief"
  );
});

test("dest → '#/trip/<id>/dest/<destId>'", function () {
  assert.strictEqual(
    MaxRoute.build({ screen: "dest", tripId: "trip-abc", destId: "d3" }),
    "#/trip/trip-abc/dest/d3"
  );
});

test("trip without tripId → home", function () {
  assert.strictEqual(MaxRoute.build({ screen: "trip" }), "#/");
});

test("dest without destId → trip overview", function () {
  assert.strictEqual(
    MaxRoute.build({ screen: "dest", tripId: "abc" }),
    "#/trip/abc"
  );
});

test("special chars in tripId are encoded", function () {
  assert.strictEqual(
    MaxRoute.build({ screen: "trip", tripId: "trip 1/2" }),
    "#/trip/trip%201%2F2"
  );
});

test("special chars in destId are encoded", function () {
  assert.strictEqual(
    MaxRoute.build({ screen: "dest", tripId: "abc", destId: "d/1" }),
    "#/trip/abc/dest/d%2F1"
  );
});

console.log("\nengine-routing — round-trip\n");

test("home survives parse(build())", function () {
  var r = { screen: "home" };
  assert.deepStrictEqual(MaxRoute.parse(MaxRoute.build(r)), r);
});

test("trip survives parse(build())", function () {
  var r = { screen: "trip", tripId: "trip-abc" };
  assert.deepStrictEqual(MaxRoute.parse(MaxRoute.build(r)), r);
});

test("discovery survives parse(build())", function () {
  var r = { screen: "discovery", tripId: "trip-abc" };
  assert.deepStrictEqual(MaxRoute.parse(MaxRoute.build(r)), r);
});

test("brief survives parse(build())", function () {
  var r = { screen: "brief", tripId: "trip-abc" };
  assert.deepStrictEqual(MaxRoute.parse(MaxRoute.build(r)), r);
});

test("dest survives parse(build())", function () {
  var r = { screen: "dest", tripId: "trip-abc", destId: "d3" };
  assert.deepStrictEqual(MaxRoute.parse(MaxRoute.build(r)), r);
});

test("encoded special chars survive round-trip", function () {
  var r = { screen: "dest", tripId: "trip 1", destId: "d/1" };
  assert.deepStrictEqual(MaxRoute.parse(MaxRoute.build(r)), r);
});

console.log("\nengine-routing — SCREENS constants\n");

test("SCREENS exposes canonical names", function () {
  assert.strictEqual(MaxRoute.SCREENS.HOME, "home");
  assert.strictEqual(MaxRoute.SCREENS.TRIP, "trip");
  assert.strictEqual(MaxRoute.SCREENS.DISCOVERY, "discovery");
  assert.strictEqual(MaxRoute.SCREENS.BRIEF, "brief");
  assert.strictEqual(MaxRoute.SCREENS.DEST, "dest");
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + passed + "    FAIL: " + failed);
if (failed > 0) process.exit(1);
