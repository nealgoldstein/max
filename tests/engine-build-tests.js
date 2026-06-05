// engine-build.js unit tests.
//
// Covers the buildTrip orchestrator (PD.309 — Phase 7):
//   - Input contract: rejects missing mode, rejects unknown mode
//   - Mode dispatch: candidate-first, activity-first, rebuild
//   - Phase ordering: primary → mint → enhance → reconcile → done
//   - Rebuild skips mint (preserves trip identity)
//   - Enhance failure is best-effort (build:done still fires)
//   - Phase events are emitted with payloads
//   - rerunEnhance fires enhance:start / enhance:done
//
// Run: node tests/engine-build-tests.js
//
// Mocks the legacy entry-point bodies (runCandidateSearch,
// generateActivitiesForPlace, enhanceDiscovery, expandMustDos,
// _initialTripSave) so the orchestrator can be tested in isolation
// without booting the whole app.

var assert = require("assert");

var pass = 0, fail = 0;
function test(name, fn) {
  try {
    var ret = fn();
    if (ret && typeof ret.then === "function") {
      return ret.then(
        function () { console.log("  ✓ " + name); pass++; },
        function (e) {
          console.log("  ✗ " + name);
          console.log("    " + (e && e.message));
          if (e && e.stack) console.log("    " + e.stack.split("\n").slice(1, 4).join("\n    "));
          fail++;
        }
      );
    }
    console.log("  ✓ " + name);
    pass++;
  } catch (e) {
    console.log("  ✗ " + name);
    console.log("    " + (e && e.message));
    if (e && e.stack) console.log("    " + e.stack.split("\n").slice(1, 4).join("\n    "));
    fail++;
  }
}

// ── Mock environment ──────────────────────────────────────────────────
//
// Stubs for the legacy functions that engine-build.js delegates to.
// Each stub records its invocation in `calls` so tests can assert
// ordering + arguments.

var calls = [];
function _resetCalls() { calls = []; }

global._tb = { region: "", candidates: [], placeActivities: [] };

function _resetTb() {
  global._tb = { region: "", candidates: [], placeActivities: [] };
}

global.runCandidateSearch = async function (requiredPlaces) {
  calls.push({ fn: "runCandidateSearch", arg: requiredPlaces });
  // Simulate the function populating _tb.candidates.
  global._tb.candidates = [{ id: "c1", place: "Reykjavik" }];
};

global.expandMustDos = async function () {
  calls.push({ fn: "expandMustDos" });
  // Simulate populating candidates via its internal runCandidateSearch.
  global._tb.candidates = [{ id: "c1", place: "Reykjavik" }];
};

global.generateActivitiesForPlace = async function () {
  calls.push({ fn: "generateActivitiesForPlace" });
  global._tb.placeActivities = [{ id: "p1", name: "Visit Harpa", requiredPlaces: [{ place: "Reykjavik" }] }];
};

global._initialTripSave = function () {
  calls.push({ fn: "_initialTripSave" });
};

global.enhanceDiscovery = async function (btn, opts) {
  calls.push({ fn: "enhanceDiscovery", opts: opts });
  return 3; // added 3 places
};

// TripStore mock: just enough for the orchestrator's diagnostic read.
global.TripStore = {
  isLoaded: function () { return !!(global.TripStore.trip); },
  trip: null
};

// ── Load engine-build.js ──────────────────────────────────────────────

var path = require("path");
var fs = require("fs");
var mod = fs.readFileSync(path.join(__dirname, "..", "engine-build.js"), "utf8");
new Function(mod)();

assert(typeof global.MaxBuild === "object", "MaxBuild not exported");
assert(typeof global.MaxBuild.findCandidates === "function", "MaxBuild.findCandidates missing");
assert(typeof global.MaxBuild.rerunEnhance === "function", "MaxBuild.rerunEnhance missing");
assert(typeof global.MaxBuild.on === "function", "MaxBuild.on missing");

// ── Tests ─────────────────────────────────────────────────────────────
console.log("\nengine-build.js — input contract\n");

(async function runAll() {

  await test("missing mode throws", async function () {
    await assert.rejects(function () {
      return global.MaxBuild.findCandidates({});
    }, /input\.mode/);
  });

  await test("unknown mode throws", async function () {
    await assert.rejects(function () {
      return global.MaxBuild.findCandidates({ mode: "bogus", region: "X" });
    }, /input\.mode/);
  });

  await test("missing region throws (non-rebuild)", async function () {
    await assert.rejects(function () {
      return global.MaxBuild.findCandidates({ mode: "candidate-first" });
    }, /region/);
  });

  await test("rebuild without region does NOT throw", async function () {
    _resetCalls();
    _resetTb();
    await global.MaxBuild.findCandidates({ mode: "rebuild" });
    // Rebuild routed to expandMustDos (no precomputed requiredPlaces)
    // and skipped mint.
    assert(calls.some(function (c) { return c.fn === "expandMustDos"; }), "expandMustDos should have been called");
    assert(!calls.some(function (c) { return c.fn === "_initialTripSave"; }), "_initialTripSave should NOT have been called in rebuild mode");
  });

  console.log("\nengine-build.js — mode dispatch\n");

  await test("candidate-first without requiredPlaces routes through expandMustDos", async function () {
    _resetCalls();
    _resetTb();
    await global.MaxBuild.findCandidates({
      mode: "candidate-first", region: "Iceland", sentence: "ring road"
    });
    assert(calls.some(function (c) { return c.fn === "expandMustDos"; }),
      "expandMustDos should have been called");
    assert(!calls.some(function (c) { return c.fn === "runCandidateSearch"; }),
      "runCandidateSearch should NOT have been called directly (only via expandMustDos internals)");
  });

  await test("candidate-first WITH requiredPlaces routes through runCandidateSearch directly", async function () {
    _resetCalls();
    _resetTb();
    var reqs = [{ place: "Reykjavik", country: "Iceland" }];
    await global.MaxBuild.findCandidates({
      mode: "candidate-first", region: "Iceland", requiredPlaces: reqs
    });
    var rcs = calls.filter(function (c) { return c.fn === "runCandidateSearch"; });
    assert.strictEqual(rcs.length, 1, "runCandidateSearch should have been called once");
    assert.deepStrictEqual(rcs[0].arg, reqs, "runCandidateSearch should receive the requiredPlaces");
    assert(!calls.some(function (c) { return c.fn === "expandMustDos"; }),
      "expandMustDos should NOT have been called when requiredPlaces is precomputed");
  });

  await test("activity-first routes through generateActivitiesForPlace", async function () {
    _resetCalls();
    _resetTb();
    await global.MaxBuild.findCandidates({
      mode: "activity-first", region: "Iceland", placeName: "Iceland"
    });
    assert(calls.some(function (c) { return c.fn === "generateActivitiesForPlace"; }),
      "generateActivitiesForPlace should have been called");
  });

  console.log("\nengine-build.js — phase ordering\n");

  await test("phases run in order: primary → mint → enhance", async function () {
    _resetCalls();
    _resetTb();
    await global.MaxBuild.findCandidates({
      mode: "candidate-first", region: "Iceland", requiredPlaces: []
    });
    var idxPrimary = calls.findIndex(function (c) { return c.fn === "runCandidateSearch"; });
    var idxMint    = calls.findIndex(function (c) { return c.fn === "_initialTripSave"; });
    var idxEnh     = calls.findIndex(function (c) { return c.fn === "enhanceDiscovery"; });
    assert(idxPrimary >= 0 && idxMint >= 0 && idxEnh >= 0, "all three phases should fire");
    assert(idxPrimary < idxMint, "primary phase should fire BEFORE mint phase");
    assert(idxMint    < idxEnh,  "mint phase should fire BEFORE enhance phase");
  });

  await test("rebuild mode SKIPS mint phase", async function () {
    _resetCalls();
    _resetTb();
    await global.MaxBuild.findCandidates({ mode: "rebuild", region: "Iceland" });
    assert(!calls.some(function (c) { return c.fn === "_initialTripSave"; }),
      "_initialTripSave must NOT fire in rebuild mode");
    // Enhance still fires.
    assert(calls.some(function (c) { return c.fn === "enhanceDiscovery"; }),
      "enhanceDiscovery should still fire in rebuild mode");
  });

  console.log("\nengine-build.js — phase events\n");

  await test("emits build:start with mode", async function () {
    _resetCalls();
    _resetTb();
    var seen = null;
    var off = global.MaxBuild.on("build:start", function (p) { seen = p; });
    await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    off();
    assert(seen && seen.mode === "candidate-first", "build:start payload should carry mode");
  });

  await test("emits build:primary-done with count and mode", async function () {
    _resetCalls();
    _resetTb();
    var seen = null;
    var off = global.MaxBuild.on("build:primary-done", function (p) { seen = p; });
    await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    off();
    assert(seen && typeof seen.count === "number", "build:primary-done payload should carry count");
    assert(seen.mode === "candidate-first", "build:primary-done payload should carry mode");
  });

  await test("emits build:enhance-done with added count", async function () {
    _resetCalls();
    _resetTb();
    var seen = null;
    var off = global.MaxBuild.on("build:enhance-done", function (p) { seen = p; });
    await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    off();
    assert(seen && seen.added === 3, "build:enhance-done should carry the added count from enhanceDiscovery");
  });

  await test("emits build:done at the end", async function () {
    _resetCalls();
    _resetTb();
    var seen = false;
    var off = global.MaxBuild.on("build:done", function () { seen = true; });
    await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    off();
    assert(seen, "build:done should fire on successful build");
  });

  await test("emits build:error on primary phase failure", async function () {
    _resetCalls();
    _resetTb();
    var originalRCS = global.runCandidateSearch;
    global.runCandidateSearch = async function () { throw new Error("boom"); };
    var seen = null;
    var off = global.MaxBuild.on("build:error", function (p) { seen = p; });
    try {
      await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    } catch (_) {}
    off();
    global.runCandidateSearch = originalRCS;
    assert(seen && seen.error && /boom/.test(seen.error.message),
      "build:error should fire with the thrown error");
  });

  console.log("\nengine-build.js — enhance phase resilience\n");

  await test("enhance failure does NOT abort the build (best-effort)", async function () {
    _resetCalls();
    _resetTb();
    var originalEnh = global.enhanceDiscovery;
    global.enhanceDiscovery = async function () { throw new Error("enhance LLM hosed"); };
    var doneFired = false;
    var off = global.MaxBuild.on("build:done", function () { doneFired = true; });
    await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    off();
    global.enhanceDiscovery = originalEnh;
    assert(doneFired, "build:done should still fire even when enhance fails");
  });

  await test("enhance returns 0 added when it throws", async function () {
    _resetCalls();
    _resetTb();
    var originalEnh = global.enhanceDiscovery;
    global.enhanceDiscovery = async function () { throw new Error("LLM hosed"); };
    var seen = null;
    var off = global.MaxBuild.on("build:enhance-done", function (p) { seen = p; });
    await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    off();
    global.enhanceDiscovery = originalEnh;
    assert(seen && seen.added === 0, "build:enhance-done should carry added=0 on failure");
  });

  console.log("\nengine-build.js — rerunEnhance (standalone button)\n");

  await test("rerunEnhance fires enhance:start and enhance:done", async function () {
    _resetCalls();
    _resetTb();
    var startFired = false, doneFired = false, doneAdded = null;
    var offA = global.MaxBuild.on("enhance:start", function () { startFired = true; });
    var offB = global.MaxBuild.on("enhance:done", function (p) { doneFired = true; doneAdded = p && p.added; });
    var ret = await global.MaxBuild.rerunEnhance();
    offA(); offB();
    assert(startFired, "enhance:start should fire");
    assert(doneFired, "enhance:done should fire");
    assert.strictEqual(doneAdded, 3, "enhance:done should carry the added count");
    assert.strictEqual(ret.added, 3, "rerunEnhance return value should carry added");
  });

  await test("rerunEnhance does NOT suppress toast/popup (manual click)", async function () {
    _resetCalls();
    _resetTb();
    await global.MaxBuild.rerunEnhance();
    var ehCall = calls.filter(function (c) { return c.fn === "enhanceDiscovery"; })[0];
    assert(ehCall && ehCall.opts, "enhanceDiscovery should have been called with opts");
    assert(ehCall.opts.suppressToast === false, "manual rerunEnhance must NOT suppress toast");
    assert(ehCall.opts.silentNoOp === false, "manual rerunEnhance must NOT silentNoOp");
  });

  await test("rerunEnhance emits enhance:error on failure", async function () {
    _resetCalls();
    _resetTb();
    var originalEnh = global.enhanceDiscovery;
    global.enhanceDiscovery = async function () { throw new Error("rerun failed"); };
    var seen = null;
    var off = global.MaxBuild.on("enhance:error", function (p) { seen = p; });
    try { await global.MaxBuild.rerunEnhance(); } catch (_) {}
    off();
    global.enhanceDiscovery = originalEnh;
    assert(seen && seen.error && /rerun failed/.test(seen.error.message),
      "enhance:error should fire with the thrown error");
  });

  console.log("\nengine-build.js — auto-Enhance opts passed to enhanceDiscovery\n");

  await test("build-time enhance suppresses toast and silentNoOp", async function () {
    _resetCalls();
    _resetTb();
    await global.MaxBuild.findCandidates({ mode: "candidate-first", region: "Iceland", requiredPlaces: [] });
    var ehCall = calls.filter(function (c) { return c.fn === "enhanceDiscovery"; })[0];
    assert(ehCall && ehCall.opts, "enhanceDiscovery should be called with opts");
    assert(ehCall.opts.suppressToast === true, "build-time enhance must suppressToast");
    assert(ehCall.opts.silentNoOp === true, "build-time enhance must silentNoOp");
    assert(ehCall.opts.suppressMaxAlert === true, "build-time enhance must suppressMaxAlert");
  });

  console.log("\nengine-build.js — input contract enforcement (PD.303 alarm)\n");

  await test("normalize copies input → _tb but does NOT touch unrelated _tb fields", async function () {
    _resetCalls();
    global._tb = {
      region: "old-region",
      candidates: [{ id: "existing" }],
      placeActivities: [{ id: "existing-pa" }],
      _userListedNames: { "harpa": true } // unrelated, must survive
    };
    await global.MaxBuild.findCandidates({
      mode: "candidate-first",
      region: "Iceland",
      requiredPlaces: []
    });
    assert.strictEqual(global._tb.region, "Iceland", "normalize should overwrite _tb.region from input");
    assert.deepStrictEqual(global._tb._userListedNames, { "harpa": true },
      "unrelated _tb fields must survive normalize");
  });

  console.log("\n──────────────────────────────────────────────────");
  console.log("PASS: " + pass + "    FAIL: " + fail);
  process.exit(fail > 0 ? 1 : 0);

})();
