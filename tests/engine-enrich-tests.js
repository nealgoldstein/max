// engine-enrich.js — enrichment queue tests.
//
// PD.325. The queue's job is to serialize parallel LLM bombardment
// into a single-file FIFO with backoff. Tests verify:
//   - FIFO order
//   - Concurrency 1 (no overlap)
//   - Min interval between calls
//   - 429 / network retries with exponential backoff
//   - Non-retryable failures (401/403) drop immediately
//   - Idempotent enqueue (same destId twice = once)
//   - Priority moves entry to front
//   - persistOnSuccess fires after each landing
//   - alreadyEnriched probe skips done destinations

var path = require("path");
var fs = require("fs");
var assert = require("assert");

var pass = 0, fail = 0;
var _chain = Promise.resolve();
function test(name, fn) {
  _chain = _chain.then(function () {
    var ret;
    try { ret = fn(); } catch (e) {
      console.log("  ✗ " + name); console.log("    " + e.message);
      fail++; return;
    }
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
    console.log("  ✓ " + name); pass++;
  });
}

// Load module.
require("../engine-enrich.mjs");
assert(typeof global.MaxEnrich === "object", "MaxEnrich must load");
// Speed up timing for tests.
global.MaxEnrich._setIntervalMs(20);
global.MaxEnrich._setBackoffBase(20);

function _resetQueue() {
  global.MaxEnrich._reset();
  // Re-shim the timing for tests after _reset.
  global.MaxEnrich._setIntervalMs(20);
  global.MaxEnrich._setBackoffBase(20);
}

function _sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

console.log("\nengine-enrich — basic queueing\n");

test("status reports pending=0 + no enricher initially", function () {
  _resetQueue();
  var s = global.MaxEnrich.status();
  assert.strictEqual(s.pending, 0);
  assert.strictEqual(s.processing, false);
  assert.strictEqual(s.hasEnricher, false);
});

test("enqueue requires destId AND place", function () {
  _resetQueue();
  global.MaxEnrich.setEnricher(function () { return Promise.resolve(); });
  assert.strictEqual(global.MaxEnrich.enqueue(null, "Paris"), false);
  assert.strictEqual(global.MaxEnrich.enqueue("d1", null), false);
  assert.strictEqual(global.MaxEnrich.enqueue("d1", "Paris"), true);
});

test("enqueue is idempotent — same destId twice = single entry", function () {
  _resetQueue();
  global.MaxEnrich.setEnricher(function () { return new Promise(function(){}); }); // never resolves
  global.MaxEnrich.enqueue("d1", "Paris");
  global.MaxEnrich.enqueue("d1", "Paris");
  global.MaxEnrich.enqueue("d1", "Paris");
  return _sleep(30).then(function () {
    var s = global.MaxEnrich.status();
    // One pending in queue OR one in flight (depends on timing).
    assert(s.pending <= 1);
    assert.strictEqual(s.enqueuedDestIds.length, 1);
  });
});

test("enqueueAll skips entries without id or place", function () {
  _resetQueue();
  global.MaxEnrich.setEnricher(function () { return new Promise(function(){}); });
  var n = global.MaxEnrich.enqueueAll([
    { id: "d1", place: "Paris" },
    { id: "d2", place: null },           // skipped
    { place: "Berlin" },                  // skipped (no id)
    null,                                 // skipped
    { id: "d3", place: "Rome" }
  ]);
  assert.strictEqual(n, 2);
});

test("alreadyEnriched probe skips done destinations", function () {
  _resetQueue();
  global.MaxEnrich.setEnricher(function () { return new Promise(function(){}); });
  global.MaxEnrich.setAlreadyEnrichedProbe(function (id) { return id === "d2"; });
  assert.strictEqual(global.MaxEnrich.enqueue("d1", "Paris"), true);
  assert.strictEqual(global.MaxEnrich.enqueue("d2", "Berlin"), false); // skipped
  assert.strictEqual(global.MaxEnrich.enqueue("d3", "Rome"), true);
});

console.log("\nengine-enrich — concurrency + FIFO\n");

test("concurrency 1 — only one enricher call in flight at a time", function () {
  _resetQueue();
  var inFlight = 0;
  var maxInFlight = 0;
  var completedOrder = [];
  global.MaxEnrich.setEnricher(function (place, destId) {
    inFlight++;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    return _sleep(30).then(function () {
      inFlight--;
      completedOrder.push(destId);
    });
  });
  global.MaxEnrich.enqueue("d1", "Paris");
  global.MaxEnrich.enqueue("d2", "Berlin");
  global.MaxEnrich.enqueue("d3", "Rome");
  return _sleep(500).then(function () {
    assert.strictEqual(maxInFlight, 1, "never more than 1 in flight at once");
    assert.deepStrictEqual(completedOrder, ["d1", "d2", "d3"], "FIFO order");
  });
});

test("min interval between calls respected", function () {
  _resetQueue();
  global.MaxEnrich._setIntervalMs(50);
  var timestamps = [];
  global.MaxEnrich.setEnricher(function () {
    timestamps.push(Date.now());
    return Promise.resolve();
  });
  global.MaxEnrich.enqueue("d1", "A");
  global.MaxEnrich.enqueue("d2", "B");
  global.MaxEnrich.enqueue("d3", "C");
  return _sleep(300).then(function () {
    global.MaxEnrich._setIntervalMs(20);
    assert.strictEqual(timestamps.length, 3, "all three should have run");
    // Each gap should be at least ~40ms (interval=50 minus a few ms slop)
    if (timestamps.length >= 2) {
      assert(timestamps[1] - timestamps[0] >= 40,
        "interval between call 1 and 2 should be >= 40ms; got " + (timestamps[1] - timestamps[0]));
    }
    if (timestamps.length >= 3) {
      assert(timestamps[2] - timestamps[1] >= 40,
        "interval between call 2 and 3 should be >= 40ms; got " + (timestamps[2] - timestamps[1]));
    }
  });
});

console.log("\nengine-enrich — retry + backoff\n");

test("429 triggers retry with exponential backoff", function () {
  _resetQueue();
  global.MaxEnrich._setIntervalMs(5);
  global.MaxEnrich._setBackoffBase(20);
  var attempts = 0;
  global.MaxEnrich.setEnricher(function () {
    attempts++;
    if (attempts <= 2) {
      var err = new Error("Rate limited"); err.status = 429;
      return Promise.reject(err);
    }
    return Promise.resolve();
  });
  global.MaxEnrich.enqueue("d1", "Paris");
  return _sleep(500).then(function () {
    assert.strictEqual(attempts, 3, "two 429s then success → 3 attempts total");
    var s = global.MaxEnrich.status();
    assert.strictEqual(s.pending, 0);
    global.MaxEnrich._setIntervalMs(20);
    global.MaxEnrich._setBackoffBase(20);
  });
});

test("401 (not retryable) drops after first attempt", function () {
  _resetQueue();
  var attempts = 0;
  global.MaxEnrich.setEnricher(function () {
    attempts++;
    var err = new Error("Unauthorized"); err.status = 401;
    return Promise.reject(err);
  });
  var failed = false;
  global.MaxEnrich.on("queue:fail", function () { failed = true; });
  global.MaxEnrich.enqueue("d1", "Paris");
  return _sleep(200).then(function () {
    assert.strictEqual(attempts, 1, "non-retryable should not retry");
    assert(failed);
  });
});

test("network error (no status) is retryable", function () {
  _resetQueue();
  global.MaxEnrich._setIntervalMs(5);
  global.MaxEnrich._setBackoffBase(15);
  var attempts = 0;
  global.MaxEnrich.setEnricher(function () {
    attempts++;
    if (attempts === 1) return Promise.reject(new Error("Failed to fetch"));
    return Promise.resolve();
  });
  global.MaxEnrich.enqueue("d1", "Paris");
  return _sleep(400).then(function () {
    assert.strictEqual(attempts, 2, "first network error retried, second succeeded");
    global.MaxEnrich._setIntervalMs(20);
    global.MaxEnrich._setBackoffBase(20);
  });
});

test("max attempts cap stops infinite retries", function () {
  _resetQueue();
  global.MaxEnrich._setIntervalMs(5);
  global.MaxEnrich._setBackoffBase(10);
  var attempts = 0;
  global.MaxEnrich.setEnricher(function () {
    attempts++;
    var err = new Error("Rate limited"); err.status = 429;
    return Promise.reject(err);
  });
  global.MaxEnrich.enqueue("d1", "Paris");
  return _sleep(2000).then(function () {
    assert(attempts >= 5, "should attempt at least 5 times: " + attempts);
    assert(attempts <= 6, "should NOT attempt more than 5 times: " + attempts);
    var s = global.MaxEnrich.status();
    assert.strictEqual(s.pending, 0, "queue should empty out after exhausting retries");
    global.MaxEnrich._setIntervalMs(20);
    global.MaxEnrich._setBackoffBase(20);
  });
});

console.log("\nengine-enrich — persistence hook + priority\n");

test("persistOnSuccess fires after each successful enrichment", function () {
  _resetQueue();
  var persistCount = 0;
  global.MaxEnrich.setEnricher(function () { return Promise.resolve(); });
  global.MaxEnrich.setPersistHook(function () { persistCount++; });
  global.MaxEnrich.enqueue("d1", "A");
  global.MaxEnrich.enqueue("d2", "B");
  global.MaxEnrich.enqueue("d3", "C");
  return _sleep(250).then(function () {
    assert.strictEqual(persistCount, 3, "persist hook should fire once per success");
  });
});

test("priority moves a queued entry to the front", function () {
  _resetQueue();
  global.MaxEnrich._setIntervalMs(40);
  var order = [];
  global.MaxEnrich.setEnricher(function (place, destId) {
    order.push(destId);
    return Promise.resolve();
  });
  global.MaxEnrich.enqueue("d1", "A");
  global.MaxEnrich.enqueue("d2", "B");
  global.MaxEnrich.enqueue("d3", "C");
  global.MaxEnrich.enqueue("d4", "D");
  // Bump d3 to front BEFORE any dispatch fires (sync after enqueue).
  // First dispatch is scheduled but hasn't run; the queue is mutable.
  global.MaxEnrich.priority("d3");
  return _sleep(400).then(function () {
    // Order: d3 (bumped), d1, d2, d4. priority correctly displaced d1.
    assert.deepStrictEqual(order, ["d3", "d1", "d2", "d4"],
      "priority should bump d3 to absolute front before any dispatch fires");
    global.MaxEnrich._setIntervalMs(20);
  });
});

test("cancel removes a queued entry", function () {
  _resetQueue();
  global.MaxEnrich._setIntervalMs(40);
  var ran = [];
  global.MaxEnrich.setEnricher(function (place, destId) {
    ran.push(destId);
    return Promise.resolve();
  });
  global.MaxEnrich.enqueue("d1", "A");
  global.MaxEnrich.enqueue("d2", "B");
  global.MaxEnrich.enqueue("d3", "C");
  global.MaxEnrich.cancel("d2");
  return _sleep(300).then(function () {
    assert.deepStrictEqual(ran, ["d1", "d3"], "cancelled d2 should not run");
    global.MaxEnrich._setIntervalMs(20);
  });
});

console.log("\nengine-enrich — events\n");

test("queue:add, queue:dispatch, queue:success fire in order", function () {
  _resetQueue();
  var events = [];
  global.MaxEnrich.on("queue:add", function () { events.push("add"); });
  global.MaxEnrich.on("queue:dispatch", function () { events.push("dispatch"); });
  global.MaxEnrich.on("queue:success", function () { events.push("success"); });
  global.MaxEnrich.setEnricher(function () { return Promise.resolve(); });
  global.MaxEnrich.enqueue("d1", "Paris");
  return _sleep(80).then(function () {
    assert.deepStrictEqual(events, ["add", "dispatch", "success"]);
  });
});

test("queue:retry fires on retryable failure", function () {
  _resetQueue();
  global.MaxEnrich._setIntervalMs(5);
  global.MaxEnrich._setBackoffBase(15);
  var retries = 0;
  global.MaxEnrich.on("queue:retry", function () { retries++; });
  var attempts = 0;
  global.MaxEnrich.setEnricher(function () {
    attempts++;
    if (attempts === 1) {
      var err = new Error("rate"); err.status = 429;
      return Promise.reject(err);
    }
    return Promise.resolve();
  });
  global.MaxEnrich.enqueue("d1", "Paris");
  return _sleep(200).then(function () {
    assert.strictEqual(retries, 1);
    global.MaxEnrich._setIntervalMs(20);
    global.MaxEnrich._setBackoffBase(20);
  });
});

// ── Final ──────────────────────────────────────────────────────────
_chain.then(function () {
  console.log("\n──────────────────────────────────────────────────");
  console.log("PASS: " + pass + "    FAIL: " + fail);
  process.exit(fail > 0 ? 1 : 0);
});
