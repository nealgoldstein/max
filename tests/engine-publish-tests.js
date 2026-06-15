// engine-publish.js helper tests.
//
// PD.320. The publishTrip function in engine-picker.js is being
// gradually carved into named, testable helpers. Each helper here
// corresponds to one or more PD-* patches that were embedded in
// publishTrip's body — the comment trail in engine-publish.js
// names the lineage.
//
// Per-helper unit tests prove each function in isolation. publishTrip
// itself continues to work as the orchestrator; these tests catch
// regressions when the helpers change.

var path = require("path");
var fs = require("fs");
var assert = require("assert");

var pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ✓ " + name);
    pass++;
  } catch (e) {
    console.log("  ✗ " + name);
    console.log("    " + (e && e.message));
    if (e && e.stack) console.log("    " + e.stack.split("\n").slice(1, 4).join("\n    "));
    fail++;
  }
}

// Load the module.
var src = fs.readFileSync(path.join(__dirname, "..", "engine-publish.js"), "utf8");
new Function(src)();
assert(typeof global.MaxPublish === "object", "MaxPublish must load");

// ── PD.234: dedupCandidatesByPlace ─────────────────────────────────
console.log("\nengine-publish — PD.234 dedup\n");

test("dedup keeps first occurrence", function () {
  var input = [
    { place: "Vík" },
    { place: "Reykjavík" },
    { place: "Vík" },     // duplicate
    { place: "Höfn" }
  ];
  var r = global.MaxPublish.dedupCandidatesByPlace(input);
  assert.strictEqual(r.deduped.length, 3);
  assert.strictEqual(r.droppedCount, 1);
  assert.strictEqual(r.deduped[0].place, "Vík");
});

test("dedup is normalized — case + diacritics handled (if _normPlaceName present)", function () {
  // Without _normPlaceName, falls back to lowercase trim.
  var input = [
    { place: "VÍK" },
    { place: "Vík" }
  ];
  var r = global.MaxPublish.dedupCandidatesByPlace(input);
  // Fallback lowercase: "vík" and "vík" → dedup'd
  assert.strictEqual(r.droppedCount, 1);
});

test("dedup preserves candidates without place (passes through)", function () {
  var input = [
    { id: "a" }, // no place
    { place: "Vík" },
    { id: "b" }  // no place
  ];
  var r = global.MaxPublish.dedupCandidatesByPlace(input);
  assert.strictEqual(r.deduped.length, 3, "candidates without place preserved");
  assert.strictEqual(r.droppedCount, 0);
});

test("dedup empty input safe", function () {
  assert.deepStrictEqual(global.MaxPublish.dedupCandidatesByPlace([]),
    { deduped: [], droppedCount: 0 });
  assert.deepStrictEqual(global.MaxPublish.dedupCandidatesByPlace(null),
    { deduped: [], droppedCount: 0 });
});

// ── PD.234: filterCandidatesForDestinations ────────────────────────
console.log("\nengine-publish — PD.234 filter\n");

test("filter keeps status:keep only", function () {
  var input = [
    { place: "Vík", status: "keep" },
    { place: "X", status: "reject" },
    { place: "Y", status: null },
    { place: "Z" }
  ];
  var r = global.MaxPublish.filterCandidatesForDestinations(input, {});
  assert.strictEqual(r.kept.length, 1);
  assert.strictEqual(r.kept[0].place, "Vík");
});

test("filter excludes wayside + dayTrip intents", function () {
  var input = [
    { place: "Vík", status: "keep" },
    { place: "Seljalandsfoss", status: "keep", intent: "wayside" },
    { place: "Þingvellir", status: "keep", intent: "dayTrip" },
    { place: "Reykjavík", status: "keep" }
  ];
  var r = global.MaxPublish.filterCandidatesForDestinations(input, {});
  assert.strictEqual(r.kept.length, 2);
  assert.deepStrictEqual(r.kept.map(function (c) { return c.place; }), ["Vík", "Reykjavík"]);
});

test("filter excludes sights from classifier bucket", function () {
  var input = [
    { place: "Reykjavík", status: "keep" },
    { place: "Harpa", status: "keep" }
  ];
  var sights = { harpa: { parentRelation: "within" } };
  var r = global.MaxPublish.filterCandidatesForDestinations(input, sights);
  assert.strictEqual(r.kept.length, 1);
  assert.strictEqual(r.kept[0].place, "Reykjavík");
  assert.deepStrictEqual(r.skippedSights, ["Harpa"]);
});

test("filter handles missing sightsClassified", function () {
  var input = [{ place: "Vík", status: "keep" }];
  var r1 = global.MaxPublish.filterCandidatesForDestinations(input, null);
  var r2 = global.MaxPublish.filterCandidatesForDestinations(input, undefined);
  assert.strictEqual(r1.kept.length, 1);
  assert.strictEqual(r2.kept.length, 1);
});

// ── PD.234: synthesizeMissingCandidates ────────────────────────────
console.log("\nengine-publish — PD.234 synthesize\n");

test("synthesize creates candidates for placeActivity requiredPlaces not in kept", function () {
  var kept = [{ place: "Reykjavík", status: "keep" }];
  var activities = [
    {
      id: "a1",
      checked: true,
      requiredPlaces: [
        { place: "Reykjavík" },           // already kept
        { place: "Selfoss", country: "Iceland" }  // missing
      ]
    }
  ];
  var injected = global.MaxPublish.synthesizeMissingCandidates(kept, activities, {});
  assert.strictEqual(injected.length, 1);
  assert.strictEqual(injected[0].place, "Selfoss");
  assert.strictEqual(injected[0].status, "keep");
  // LIVE shape (matches publishTrip's reconcile-synthesis): role "see" so a
  // reconciled listed place stays a sight, reconciled tags + _required. NOT the
  // old _synthetic / role:"stay" shape the dead helper used to emit.
  assert.strictEqual(injected[0].role, "see");
  assert.strictEqual(injected[0]._required, true);
  assert.deepStrictEqual(injected[0].tags, ["reconciled"]);
  assert.strictEqual(injected[0]._synthetic, undefined, "old _synthetic field is gone");
});

test("synthesize guards (0,0) coords to null (no null-island centroid poison)", function () {
  var kept = [];
  var activities = [
    { id: "a1", checked: true, requiredPlaces: [
      { place: "Selfoss", lat: 0, lng: 0 },
      { place: "Vík", lat: 63.4, lng: -19.0 }
    ] }
  ];
  var injected = global.MaxPublish.synthesizeMissingCandidates(kept, activities, {});
  var sel = injected.filter(function (c) { return c.place === "Selfoss"; })[0];
  var vik = injected.filter(function (c) { return c.place === "Vík"; })[0];
  assert.strictEqual(sel.lat, null, "(0,0) latitude guarded to null");
  assert.strictEqual(sel.lng, null, "(0,0) longitude guarded to null");
  assert.strictEqual(vik.lat, 63.4, "real coord preserved");
  assert.strictEqual(vik.lng, -19.0);
});

test("synthesize skips unchecked sections", function () {
  var kept = [];
  var activities = [
    {
      id: "a1",
      checked: false,
      requiredPlaces: [{ place: "Selfoss" }]
    }
  ];
  var injected = global.MaxPublish.synthesizeMissingCandidates(kept, activities, {});
  assert.strictEqual(injected.length, 0);
});

test("synthesize skips _keep:false places", function () {
  var kept = [];
  var activities = [
    {
      id: "a1",
      checked: true,
      requiredPlaces: [
        { place: "Selfoss" },
        { place: "Vík", _keep: false }
      ]
    }
  ];
  var injected = global.MaxPublish.synthesizeMissingCandidates(kept, activities, {});
  assert.strictEqual(injected.length, 1);
  assert.strictEqual(injected[0].place, "Selfoss");
});

test("synthesize skips classifier-marked sights (PD.234 contract)", function () {
  var kept = [];
  var activities = [
    {
      id: "a1",
      checked: true,
      requiredPlaces: [
        { place: "Reykjavík" },
        { place: "Harpa" }  // a sight
      ]
    }
  ];
  var sights = { harpa: { parentRelation: "within" } };
  var injected = global.MaxPublish.synthesizeMissingCandidates(kept, activities, sights);
  assert.strictEqual(injected.length, 1);
  assert.strictEqual(injected[0].place, "Reykjavík");
});

test("synthesize dedupes within injections", function () {
  var kept = [];
  var activities = [
    { id: "a1", checked: true, requiredPlaces: [{ place: "Selfoss" }] },
    { id: "a2", checked: true, requiredPlaces: [{ place: "Selfoss" }] }
  ];
  var injected = global.MaxPublish.synthesizeMissingCandidates(kept, activities, {});
  assert.strictEqual(injected.length, 1);
});

// ── PD.236: rehydrateClassifierBuckets ─────────────────────────────
console.log("\nengine-publish — PD.236 rehydrate\n");

test("rehydrate copies _sightsClassified when tb's is empty", function () {
  var tb = {};
  var brief = { _sightsClassified: { harpa: { parentRelation: "within" } } };
  global.MaxPublish.rehydrateClassifierBuckets(tb, brief);
  assert(tb._sightsClassified);
  assert(tb._sightsClassified.harpa);
});

test("rehydrate does NOT overwrite existing tb buckets", function () {
  var tb = { _sightsClassified: { existingKey: 1 } };
  var brief = { _sightsClassified: { newKey: 2 } };
  global.MaxPublish.rehydrateClassifierBuckets(tb, brief);
  assert(tb._sightsClassified.existingKey);
  assert(!tb._sightsClassified.newKey, "should not overwrite when tb already has buckets");
});

test("rehydrate copies _classificationByPlace too", function () {
  var tb = {};
  var brief = {
    _classificationByPlace: { vik: { classification: "city" } }
  };
  global.MaxPublish.rehydrateClassifierBuckets(tb, brief);
  assert.strictEqual(tb._classificationByPlace.vik.classification, "city");
});

test("rehydrate is idempotent", function () {
  var tb = {};
  var brief = { _sightsClassified: { x: 1 } };
  global.MaxPublish.rehydrateClassifierBuckets(tb, brief);
  global.MaxPublish.rehydrateClassifierBuckets(tb, brief);
  global.MaxPublish.rehydrateClassifierBuckets(tb, brief);
  assert.strictEqual(Object.keys(tb._sightsClassified).length, 1);
});

test("rehydrate safe with missing brief", function () {
  var tb = {};
  global.MaxPublish.rehydrateClassifierBuckets(tb, null);
  global.MaxPublish.rehydrateClassifierBuckets(tb, undefined);
  global.MaxPublish.rehydrateClassifierBuckets(tb, {});
  // No-op — no buckets set
  assert(!tb._sightsClassified);
});

// ── validateEntryExit ──────────────────────────────────────────────
console.log("\nengine-publish — entry/exit validation\n");

test("validateEntryExit preserves entry that matches a kept candidate", function () {
  var kept = [{ place: "Reykjavík" }, { place: "Vík" }];
  var r = global.MaxPublish.validateEntryExit("Reykjavík", "Vík", kept);
  assert.strictEqual(r.entry, "Reykjavík");
  assert.strictEqual(r.tbExit, "Vík");
});

test("validateEntryExit clears entry that doesn't match", function () {
  var kept = [{ place: "Reykjavík" }, { place: "Vík" }];
  var r = global.MaxPublish.validateEntryExit("Akureyri", "Höfn", kept);
  assert.strictEqual(r.entry, "");
  assert.strictEqual(r.tbExit, "");
});

test("validateEntryExit preserves typed* for restoration after clear", function () {
  var kept = [{ place: "Reykjavík" }];
  var r = global.MaxPublish.validateEntryExit("Akureyri", "Höfn", kept);
  assert.strictEqual(r.typedEntry, "Akureyri");
  assert.strictEqual(r.typedExit, "Höfn");
});

test("validateEntryExit substring match works both directions", function () {
  // typed entry is substring of candidate
  var r1 = global.MaxPublish.validateEntryExit("KEF", "", [{ place: "Keflavík" }]);
  assert.strictEqual(r1.entry, "KEF");
  // candidate is substring of typed entry
  var r2 = global.MaxPublish.validateEntryExit("Vík village", "", [{ place: "Vík" }]);
  assert.strictEqual(r2.entry, "Vík village");
});

// ── deriveStayOverrideBridges (PD.16) ──────────────────────────────
console.log("\nengine-publish — PD.16 stayOverride bridge\n");

test("derive stay bridge from placeMeta", function () {
  var kept = [{ place: "Vík", role: "see" }];
  // Key matches the normalization output (lowercase + accent preserved
  // in the test env where _normPlaceName isn't loaded).
  var placeMeta = { "vík": { stayOverride: true } };
  var actions = global.MaxPublish.deriveStayOverrideBridges(kept, placeMeta);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].place, "Vík");
  assert.strictEqual(actions[0].toRole, "stay");
});

test("derive see bridge from placeMeta", function () {
  var kept = [{ place: "Vík", role: "stay" }];
  var placeMeta = { "vík": { stayOverride: false } };
  var actions = global.MaxPublish.deriveStayOverrideBridges(kept, placeMeta);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].toRole, "see");
});

test("derive returns empty when c.role already matches override", function () {
  var kept = [{ place: "Vík", role: "stay" }];
  // Key matches the normalization output (lowercase + accent preserved
  // in the test env where _normPlaceName isn't loaded).
  var placeMeta = { "vík": { stayOverride: true } };
  var actions = global.MaxPublish.deriveStayOverrideBridges(kept, placeMeta);
  assert.strictEqual(actions.length, 0);
});

test("derive skips candidates with no placeMeta entry", function () {
  var kept = [{ place: "Vík", role: "see" }, { place: "Reykjavík", role: "see" }];
  // Key matches the normalization output (lowercase + accent preserved
  // in the test env where _normPlaceName isn't loaded).
  var placeMeta = { "vík": { stayOverride: true } };
  var actions = global.MaxPublish.deriveStayOverrideBridges(kept, placeMeta);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].place, "Vík");
});

// ── detectRebuild (Round DW) ───────────────────────────────────────
console.log("\nengine-publish — rebuild detection\n");

test("detectRebuild — explicit _isRebuild flag", function () {
  assert.strictEqual(global.MaxPublish.detectRebuild({ _isRebuild: true }, {}), true);
});

test("detectRebuild — existing trip has destinations", function () {
  assert.strictEqual(global.MaxPublish.detectRebuild({}, { destinations: [{ id: "d1" }] }), true);
});

test("detectRebuild — fresh build (no flag, no destinations)", function () {
  assert.strictEqual(global.MaxPublish.detectRebuild({}, { destinations: [] }), false);
  assert.strictEqual(global.MaxPublish.detectRebuild({}, {}), false);
  assert.strictEqual(global.MaxPublish.detectRebuild(null, null), false);
});

// ── Trip name derivation ──────────────────────────────────────────
// F2: deriveTripName / isAutoName trip-name derivation moved to the LIVE
// MaxEnginePicker versions — tested in tests/engine-tests.js. The dead,
// divergent MaxPublish twin was removed.

// ── describeFilterOutput diagnostic ───────────────────────────────
console.log("\nengine-publish — diagnostic\n");

test("describeFilterOutput summarizes pipeline", function () {
  var input = [
    { place: "Reykjavík", status: "keep" },
    { place: "Vík", status: "keep" },
    { place: "Reykjavík", status: "keep" }, // dupe
    { place: "Harpa", status: "keep" },     // sight
    { place: "Selfoss", status: "reject" }
  ];
  var sights = { harpa: { parentRelation: "within" } };
  var d = global.MaxPublish.describeFilterOutput(input, sights);
  assert.strictEqual(d.input, 5);
  assert.strictEqual(d.deduped, 1);
  assert.strictEqual(d.keptForDestinations, 2);
  assert.strictEqual(d.skippedAsSights, 1);
});

// ── Final ──────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
