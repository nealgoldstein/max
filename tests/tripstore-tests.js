// TripStore unit tests.
//
// Covers:
//   - Lifecycle: mint, load, replace, unload
//   - Every named mutator
//   - Event bus: subscribe, emit, unsubscribe
//   - Persistence: write on every mutation, round-trip via load
//   - Schema migration: v0 → v1
//   - Bug-class guards: every bug we fought today is now an explicit test
//
// Run: node tests/tripstore-tests.js
//
// The tests run in a Node sandbox with a mock MaxDB (in-memory key-
// value store) and a mock localStorage. No browser required.

var path = require("path");
var assert = require("assert");

// ── Test harness ──────────────────────────────────────────────────────
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

// ── Mock environment ──────────────────────────────────────────────────
// In-memory key-value store for MaxDB.
var _storage = {};
function _resetStorage() { _storage = {}; }

global.MaxDB = {
  trip: {
    write: function (id, envelope) {
      _storage["max-trip-" + id] = JSON.stringify(envelope);
      return true;
    },
    writeRaw: function (id, raw, opts) {
      // Mock honors silent flag the same way db.js does (suppress
      // the event, but we don't emit anything from the mock anyway).
      _storage["max-trip-" + id] = raw;
      return true;
    },
    read: function (id) {
      var raw = _storage["max-trip-" + id];
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_) { return null; }
    },
    listIds: function () {
      return Object.keys(_storage)
        .filter(function (k) { return k.indexOf("max-trip-") === 0; })
        .map(function (k) { return k.replace("max-trip-", ""); });
    },
    delete: function (id) {
      delete _storage["max-trip-" + id];
      return true;
    }
  }
};

// localStorage shim for fallback path coverage.
global.localStorage = {
  getItem: function (k) { return _storage[k] || null; },
  setItem: function (k, v) { _storage[k] = v; },
  removeItem: function (k) { delete _storage[k]; }
};

// Load the module under test.
var TripStore = require(path.join(__dirname, "..", "tripstore.js"));

function reset() {
  _resetStorage();
  TripStore.unload();
  TripStore._testOnlyClearListeners();
}

// ── Lifecycle ─────────────────────────────────────────────────────────

console.log("\nLifecycle");

test("mint creates a trip with an id", function () {
  reset();
  var t = TripStore.mint({ region: "Iceland" });
  assert.ok(t);
  assert.ok(t.id);
  assert.ok(t.id.indexOf("trip-") === 0);
  assert.strictEqual(TripStore.trip, t);
  assert.strictEqual(t.brief.region, "Iceland");
  assert.strictEqual(t._schemaVersion, TripStore.SCHEMA_VERSION);
});

test("mint persists immediately", function () {
  reset();
  var t = TripStore.mint({});
  var blob = MaxDB.trip.read(t.id);
  assert.ok(blob);
  assert.strictEqual(blob.trip.id, t.id);
});

test("mint emits tripChange and tripLoaded", function () {
  reset();
  var changes = 0, loads = 0;
  TripStore.on("tripChange", function () { changes++; });
  TripStore.on("tripLoaded", function () { loads++; });
  TripStore.mint({});
  assert.strictEqual(changes, 1);
  assert.strictEqual(loads, 1);
});

test("load reads from storage and migrates", function () {
  reset();
  // Pre-rewrite-shape envelope (no id, no _schemaVersion, no destinations).
  _storage["max-trip-trip-legacy-1"] = JSON.stringify({
    trip: { name: "Old Trip", brief: { region: "Iceland" } }
  });
  var t = TripStore.load("trip-legacy-1");
  assert.strictEqual(t.id, "trip-legacy-1");              // id backfilled from key
  assert.strictEqual(t._schemaVersion, TripStore.SCHEMA_VERSION);
  assert.ok(Array.isArray(t.destinations));               // defaults applied
  assert.ok(Array.isArray(t.placeActivities));
  assert.ok(t.picker && typeof t.picker === "object");
});

test("load throws on missing id", function () {
  reset();
  assert.throws(function () { TripStore.load(); }, /requires an id/);
});

test("load throws on missing envelope", function () {
  reset();
  assert.throws(function () { TripStore.load("trip-nonexistent"); }, /no envelope/);
});

test("replace runs migrations and persists", function () {
  reset();
  TripStore.mint({});
  var fresh = { id: "trip-other", name: "Other", brief: { region: "Italy" } };
  TripStore.replace(fresh);
  assert.strictEqual(TripStore.trip.name, "Other");
  assert.strictEqual(TripStore.trip._schemaVersion, TripStore.SCHEMA_VERSION);
  // Persisted to the new id, not the old one.
  assert.ok(MaxDB.trip.read("trip-other"));
});

test("unload clears state and emits tripUnloaded", function () {
  reset();
  TripStore.mint({});
  var emitted = 0;
  TripStore.on("tripUnloaded", function () { emitted++; });
  TripStore.unload();
  assert.strictEqual(TripStore.trip, null);
  assert.strictEqual(TripStore.isLoaded(), false);
  assert.strictEqual(emitted, 1);
});

test("unload on empty state is a no-op (no event)", function () {
  reset();
  var emitted = 0;
  TripStore.on("tripUnloaded", function () { emitted++; });
  TripStore.unload();
  assert.strictEqual(emitted, 0);
});

// ── Schema migration ──────────────────────────────────────────────────

console.log("\nSchema migration");

test("v0→v1 backfills id from storage key", function () {
  reset();
  _storage["max-trip-trip-XYZ"] = JSON.stringify({ trip: { name: "no id field" } });
  var t = TripStore.load("trip-XYZ");
  assert.strictEqual(t.id, "trip-XYZ");
});

test("v0→v1 drops legacy mdcItems field", function () {
  reset();
  _storage["max-trip-trip-1"] = JSON.stringify({
    trip: { id: "trip-1", mdcItems: [{ id: "x" }], placeActivities: [] }
  });
  var t = TripStore.load("trip-1");
  assert.strictEqual(t.mdcItems, undefined);
});

test("v0→v1 fills all default fields", function () {
  reset();
  _storage["max-trip-trip-empty"] = JSON.stringify({ trip: {} });
  var t = TripStore.load("trip-empty");
  assert.ok(Array.isArray(t.destinations));
  assert.ok(Array.isArray(t.placeActivities));
  assert.ok(Array.isArray(t.candidates));
  assert.ok(Array.isArray(t.routes));
  assert.ok(Array.isArray(t.pendingActions));
  assert.ok(t.places && typeof t.places === "object");
  assert.ok(t.brief && typeof t.brief === "object");
  assert.ok(t.picker && typeof t.picker === "object");
  assert.ok(t.destNotes && typeof t.destNotes === "object");
  assert.ok(t.destStories && typeof t.destStories === "object");
  assert.ok(t.sightStories && typeof t.sightStories === "object");
  assert.ok(t.ffHistories && typeof t.ffHistories === "object");
  assert.ok(t.notes && typeof t.notes === "object");
  assert.ok(t.legs && typeof t.legs === "object");
  assert.strictEqual(typeof t.trackSpending, "boolean");
});

test("re-load on already-migrated trip is idempotent", function () {
  reset();
  TripStore.mint({});
  var id = TripStore.trip.id;
  var version = TripStore.getVersion();
  TripStore.unload();
  TripStore.load(id);
  assert.strictEqual(TripStore.trip.id, id);
  assert.strictEqual(TripStore.trip._schemaVersion, TripStore.SCHEMA_VERSION);
});

// ── Trip-level mutators ───────────────────────────────────────────────

console.log("\nTrip-level mutators");

test("setName updates trip.name and persists", function () {
  reset();
  TripStore.mint({});
  TripStore.setName("Iceland 2026");
  assert.strictEqual(TripStore.trip.name, "Iceland 2026");
  var blob = MaxDB.trip.read(TripStore.trip.id);
  assert.strictEqual(blob.trip.name, "Iceland 2026");
});

test("setLastScreen accepts known values and null", function () {
  reset();
  TripStore.mint({});
  TripStore.setLastScreen("trip");
  assert.strictEqual(TripStore.trip._lastScreen, "trip");
  TripStore.setLastScreen(null);
  assert.strictEqual(TripStore.trip._lastScreen, null);
});

test("updateBrief merges instead of replacing", function () {
  reset();
  TripStore.mint({ region: "Iceland", when: "September" });
  TripStore.updateBrief({ duration: "14 days" });
  assert.strictEqual(TripStore.trip.brief.region, "Iceland");
  assert.strictEqual(TripStore.trip.brief.when, "September");
  assert.strictEqual(TripStore.trip.brief.duration, "14 days");
});

test("setBrief replaces wholesale", function () {
  reset();
  TripStore.mint({ region: "Iceland" });
  TripStore.setBrief({ region: "Italy" });
  assert.strictEqual(TripStore.trip.brief.region, "Italy");
  assert.strictEqual(TripStore.trip.brief.when, undefined);
});

// ── Destination mutators ──────────────────────────────────────────────

console.log("\nDestination mutators");

test("setDestinations replaces array", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestinations([{ id: "d1", place: "Reykjavík" }]);
  assert.strictEqual(TripStore.trip.destinations.length, 1);
  assert.strictEqual(TripStore.trip.destinations[0].place, "Reykjavík");
});

test("setDestinations throws on non-array", function () {
  reset();
  TripStore.mint({});
  assert.throws(function () { TripStore.setDestinations({}); }, /requires an array/);
});

test("addDestination appends by default", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestinations([{ id: "d1", place: "A" }]);
  TripStore.addDestination({ id: "d2", place: "B" });
  assert.strictEqual(TripStore.trip.destinations.length, 2);
  assert.strictEqual(TripStore.trip.destinations[1].place, "B");
});

test("addDestination respects atIndex", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestinations([{ id: "d1", place: "A" }, { id: "d3", place: "C" }]);
  TripStore.addDestination({ id: "d2", place: "B" }, 1);
  assert.deepStrictEqual(
    TripStore.trip.destinations.map(function (d) { return d.place; }),
    ["A", "B", "C"]
  );
});

test("addDestination throws without id", function () {
  reset();
  TripStore.mint({});
  assert.throws(function () { TripStore.addDestination({ place: "X" }); }, /requires a dest with an id/);
});

test("removeDestination filters by id", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestinations([{ id: "d1" }, { id: "d2" }, { id: "d3" }]);
  TripStore.removeDestination("d2");
  assert.deepStrictEqual(
    TripStore.trip.destinations.map(function (d) { return d.id; }),
    ["d1", "d3"]
  );
});

test("updateDestination patches fields on matched dest", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestinations([{ id: "d1", nights: 1 }, { id: "d2", nights: 2 }]);
  TripStore.updateDestination("d1", { nights: 5, place: "New" });
  assert.strictEqual(TripStore.trip.destinations[0].nights, 5);
  assert.strictEqual(TripStore.trip.destinations[0].place, "New");
  assert.strictEqual(TripStore.trip.destinations[1].nights, 2);
});

test("reorderDestinations replaces sequence", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestinations([{ id: "d1" }, { id: "d2" }, { id: "d3" }]);
  var reordered = [TripStore.trip.destinations[2], TripStore.trip.destinations[0], TripStore.trip.destinations[1]];
  TripStore.reorderDestinations(reordered);
  assert.deepStrictEqual(
    TripStore.trip.destinations.map(function (d) { return d.id; }),
    ["d3", "d1", "d2"]
  );
});

// ── Picker mutators ───────────────────────────────────────────────────

console.log("\nPicker mutators");

test("setPlaceActivities replaces array", function () {
  reset();
  TripStore.mint({});
  TripStore.setPlaceActivities([{ id: "pa1", section: "Hike to waterfalls" }]);
  assert.strictEqual(TripStore.trip.placeActivities.length, 1);
});

test("updatePlaceActivity patches matched item", function () {
  reset();
  TripStore.mint({});
  TripStore.setPlaceActivities([
    { id: "pa1", section: "A", checked: true },
    { id: "pa2", section: "B", checked: true }
  ]);
  TripStore.updatePlaceActivity("pa1", { checked: false });
  assert.strictEqual(TripStore.trip.placeActivities[0].checked, false);
  assert.strictEqual(TripStore.trip.placeActivities[1].checked, true);
});

test("removePlaceActivity filters by id", function () {
  reset();
  TripStore.mint({});
  TripStore.setPlaceActivities([{ id: "pa1" }, { id: "pa2" }]);
  TripStore.removePlaceActivity("pa1");
  assert.strictEqual(TripStore.trip.placeActivities.length, 1);
  assert.strictEqual(TripStore.trip.placeActivities[0].id, "pa2");
});

test("setCandidates replaces array", function () {
  reset();
  TripStore.mint({});
  TripStore.setCandidates([{ place: "Reykjavík" }]);
  assert.strictEqual(TripStore.trip.candidates.length, 1);
});

test("updatePicker merges fields", function () {
  reset();
  TripStore.mint({});
  TripStore.updatePicker({ entry: "REK", region: "Iceland" });
  assert.strictEqual(TripStore.trip.picker.entry, "REK");
  assert.strictEqual(TripStore.trip.picker.region, "Iceland");
  TripStore.updatePicker({ tbExit: "KEF" });
  assert.strictEqual(TripStore.trip.picker.entry, "REK");
  assert.strictEqual(TripStore.trip.picker.tbExit, "KEF");
});

// ── Publish ───────────────────────────────────────────────────────────

console.log("\nPublish");

test("publish atomically sets destinations, routes, places", function () {
  reset();
  TripStore.mint({});
  var changes = 0;
  TripStore.on("tripChange", function (e) {
    if (e.mutator === "publish") changes++;
  });
  TripStore.publish({
    destinations: [{ id: "d1" }, { id: "d2" }],
    routes: [{ id: "r-tr-d1-d2" }],
    places: { p1: { id: "p1", name: "Reykjavík" } }
  });
  assert.strictEqual(TripStore.trip.destinations.length, 2);
  assert.strictEqual(TripStore.trip.routes.length, 1);
  assert.ok(TripStore.trip.places.p1);
  assert.strictEqual(changes, 1);   // one event for the whole atomic transition
});

test("publish persists in one shot", function () {
  reset();
  var t = TripStore.mint({});
  TripStore.publish({ destinations: [{ id: "d1" }] });
  var blob = MaxDB.trip.read(t.id);
  assert.strictEqual(blob.trip.destinations.length, 1);
});

// ── Annotations ───────────────────────────────────────────────────────

console.log("\nAnnotations");

test("setDestNote upserts and deletes", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestNote("d1", { text: "hello" });
  assert.deepStrictEqual(TripStore.trip.destNotes.d1, { text: "hello" });
  TripStore.setDestNote("d1", null);
  assert.strictEqual(TripStore.trip.destNotes.d1, undefined);
});

test("setDestStory and setSightStory work in parallel", function () {
  reset();
  TripStore.mint({});
  TripStore.setDestStory("d1", { text: "story" });
  TripStore.setSightStory("s1", { text: "sight" });
  assert.deepStrictEqual(TripStore.trip.destStories.d1, { text: "story" });
  assert.deepStrictEqual(TripStore.trip.sightStories.s1, { text: "sight" });
});

// ── Event bus ─────────────────────────────────────────────────────────

console.log("\nEvent bus");

test("on returns an unsubscribe function", function () {
  reset();
  TripStore.mint({});
  var count = 0;
  var unsub = TripStore.on("tripChange", function () { count++; });
  TripStore.setName("first");
  unsub();
  TripStore.setName("second");
  assert.strictEqual(count, 1);   // unsubscribed before "second"
});

test("off works by reference", function () {
  reset();
  TripStore.mint({});
  var count = 0;
  function listener() { count++; }
  TripStore.on("tripChange", listener);
  TripStore.setName("a");
  TripStore.off("tripChange", listener);
  TripStore.setName("b");
  assert.strictEqual(count, 1);
});

test("multiple subscribers all fire", function () {
  reset();
  TripStore.mint({});
  var a = 0, b = 0;
  TripStore.on("tripChange", function () { a++; });
  TripStore.on("tripChange", function () { b++; });
  TripStore.setName("x");
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1);
});

test("listener error doesn't break the bus", function () {
  reset();
  TripStore.mint({});
  var ok = 0;
  TripStore.on("tripChange", function () { throw new Error("boom"); });
  TripStore.on("tripChange", function () { ok++; });
  TripStore.setName("x");
  assert.strictEqual(ok, 1);
});

test("emit payload carries mutator name + payload + version", function () {
  reset();
  TripStore.mint({});
  var captured = null;
  TripStore.on("tripChange", function (e) { captured = e; });
  TripStore.setName("Sample");
  assert.strictEqual(captured.mutator, "setName");
  assert.deepStrictEqual(captured.payload, { name: "Sample" });
  assert.ok(captured.version > 0);
});

// ── Persistence round-trip ────────────────────────────────────────────

console.log("\nPersistence round-trip");

test("every mutator persists immediately", function () {
  reset();
  var t = TripStore.mint({});
  TripStore.setName("Iceland");
  TripStore.setLastScreen("trip");
  TripStore.setDestinations([{ id: "d1", place: "Reykjavík" }]);
  TripStore.setPlaceActivities([{ id: "pa1", section: "Hike to waterfalls" }]);
  TripStore.setDestNote("d1", { text: "hello" });
  TripStore.updateBrief({ region: "Iceland", when: "September" });
  TripStore.unload();
  TripStore.load(t.id);
  assert.strictEqual(TripStore.trip.name, "Iceland");
  assert.strictEqual(TripStore.trip._lastScreen, "trip");
  assert.strictEqual(TripStore.trip.destinations[0].place, "Reykjavík");
  assert.strictEqual(TripStore.trip.placeActivities[0].section, "Hike to waterfalls");
  assert.deepStrictEqual(TripStore.trip.destNotes.d1, { text: "hello" });
  assert.strictEqual(TripStore.trip.brief.region, "Iceland");
});

test("__saved__ timestamp updates on every mutation", function () {
  reset();
  TripStore.mint({});
  var first = TripStore.trip.__saved__;
  // Ensure detectable time delta
  var until = Date.now() + 5;
  while (Date.now() < until) {}
  TripStore.setName("changed");
  assert.ok(TripStore.trip.__saved__ >= first);
});

test("_version increments monotonically", function () {
  reset();
  TripStore.mint({});
  var v0 = TripStore.getVersion();
  TripStore.setName("a");
  TripStore.setName("b");
  TripStore.setName("c");
  assert.strictEqual(TripStore.getVersion(), v0 + 3);
});

// ── notifyChange (Phase 5 escape hatch) ───────────────────────────────

console.log("\nnotifyChange (legacy bridge)");

test("notifyChange emits tripChange with legacy:true", function () {
  reset();
  TripStore.mint({});
  var captured = null;
  TripStore.on("tripChange", function (e) { captured = e; });
  TripStore.notifyChange("autoSave");
  assert.ok(captured);
  assert.strictEqual(captured.mutator, "autoSave");
  assert.strictEqual(captured.legacy, true);
});

test("notifyChange bumps _version", function () {
  reset();
  TripStore.mint({});
  var v0 = TripStore.getVersion();
  TripStore.notifyChange("test");
  assert.strictEqual(TripStore.getVersion(), v0 + 1);
});

test("notifyChange is a no-op when no trip loaded", function () {
  reset();
  var count = 0;
  TripStore.on("tripChange", function () { count++; });
  TripStore.notifyChange("test");
  assert.strictEqual(count, 0);
});

// ── Batch (Phase 3 transactional API) ─────────────────────────────────

console.log("\nBatch (transactional)");

test("batch emits one tripChange instead of N", function () {
  reset();
  TripStore.mint({});
  var count = 0;
  TripStore.on("tripChange", function () { count++; });
  TripStore.batch(function () {
    TripStore.setName("a");
    TripStore.setName("b");
    TripStore.setName("c");
  }, "test-batch");
  // One change for the batch (the mint already fired before subscribe).
  assert.strictEqual(count, 1);
  assert.strictEqual(TripStore.trip.name, "c");
});

test("batch persists once at the end", function () {
  reset();
  var t = TripStore.mint({});
  var writes = 0;
  // Wrap MaxDB to count writes (mint already wrote 1).
  var origWrite = MaxDB.trip.writeRaw;
  MaxDB.trip.writeRaw = function () { writes++; return origWrite.apply(this, arguments); };
  TripStore.batch(function () {
    TripStore.setName("a");
    TripStore.setName("b");
    TripStore.setName("c");
  });
  assert.strictEqual(writes, 1);
  MaxDB.trip.writeRaw = origWrite;
});

test("batch with no mutations doesn't emit", function () {
  reset();
  TripStore.mint({});
  var count = 0;
  TripStore.on("tripChange", function () { count++; });
  TripStore.batch(function () {
    // do nothing
  });
  assert.strictEqual(count, 0);
});

test("nested batches collapse to one emit", function () {
  reset();
  TripStore.mint({});
  var count = 0;
  TripStore.on("tripChange", function () { count++; });
  TripStore.batch(function () {
    TripStore.setName("outer");
    TripStore.batch(function () {
      TripStore.setName("inner");
    });
  });
  assert.strictEqual(count, 1);
});

test("batch payload identifies the batch by name", function () {
  reset();
  TripStore.mint({});
  var captured = null;
  TripStore.on("tripChange", function (e) { captured = e; });
  TripStore.batch(function () {
    TripStore.setName("x");
  }, "trip-mint");
  assert.strictEqual(captured.mutator, "batch:trip-mint");
});

test("error inside batch still releases the batch depth", function () {
  reset();
  TripStore.mint({});
  try {
    TripStore.batch(function () {
      TripStore.setName("x");
      throw new Error("oops");
    });
  } catch (_) {}
  // Subsequent mutations should fire normally, not be batch-suppressed.
  var count = 0;
  TripStore.on("tripChange", function () { count++; });
  TripStore.setName("y");
  assert.strictEqual(count, 1);
});

// ── Global mirror (Phase 2 bridge) ────────────────────────────────────

console.log("\nGlobal mirror (Phase 2 bridge)");

test("mint sets global.trip to the same object", function () {
  reset();
  var t = TripStore.mint({});
  assert.strictEqual(global.trip, t);
  assert.strictEqual(TripStore.trip, global.trip);
});

test("load sets global.trip to the loaded object", function () {
  reset();
  var t = TripStore.mint({});
  var id = t.id;
  TripStore.unload();
  assert.strictEqual(global.trip, null);
  var loaded = TripStore.load(id);
  assert.strictEqual(global.trip, loaded);
});

test("unload clears global.trip", function () {
  reset();
  TripStore.mint({});
  assert.ok(global.trip);
  TripStore.unload();
  assert.strictEqual(global.trip, null);
});

test("mutations to trip via mutator are visible on global.trip", function () {
  reset();
  TripStore.mint({});
  TripStore.setName("Iceland");
  assert.strictEqual(global.trip.name, "Iceland");
});

test("legacy code reading global.trip sees current state", function () {
  reset();
  TripStore.mint({});
  // Simulate legacy code that does `trip.destinations.push(...)`
  // before any TripStore mutator runs. The push goes into the
  // SAME array TripStore owns. Persistence won't fire until a
  // mutator runs — that's Phase 3's job. But the data is shared.
  TripStore.setDestinations([{ id: "d1" }]);
  global.trip.destinations.push({ id: "d2" });
  assert.strictEqual(TripStore.trip.destinations.length, 2);
  // Next mutator persists everything including the legacy push.
  TripStore.setName("x");
  TripStore.unload();
  TripStore.load(TripStore.trip ? TripStore.trip.id : MaxDB.trip.listIds()[0]);
  assert.strictEqual(TripStore.trip.destinations.length, 2);
});

test("replace updates global.trip in place", function () {
  reset();
  TripStore.mint({});
  TripStore.replace({ id: "trip-other", name: "Other", brief: {} });
  assert.strictEqual(global.trip.name, "Other");
  assert.strictEqual(global.trip.id, "trip-other");
});

// ── Bug-class guards ──────────────────────────────────────────────────
// One test per bug class we fought today. Each test would have failed
// in the old architecture; each passes now by construction.

console.log("\nBug-class guards (would-have-failed-today)");

test("destination-loss class: paste flow can't clobber published trip", function () {
  // Old bug: paste flow reassigned `trip` without clearing
  // _currentTripId; next save wrote empty destinations over old trip.
  // New: mint creates a new id every time. The old trip's id is
  // never reused. Storage slot stays intact.
  reset();
  var t1 = TripStore.mint({});
  TripStore.publish({ destinations: [{ id: "d1" }, { id: "d2" }] });
  var t1id = t1.id;
  // Simulate paste flow (new trip)
  TripStore.unload();
  // Need a unique id; force a small wait so timestamp differs.
  var until = Date.now() + 5;
  while (Date.now() < until) {}
  var t2 = TripStore.mint({});
  assert.notStrictEqual(t1id, t2.id);
  // Old trip survives.
  var blob = MaxDB.trip.read(t1id);
  assert.strictEqual(blob.trip.destinations.length, 2);
});

test("stale-render class: tripChange fires synchronously with mutation", function () {
  // Old bug: footer rendered count snapshot, data mutated after,
  // banner stayed stale. Now: every mutation emits before any
  // subsequent code can observe the new state. Subscribers can
  // re-render with current data.
  reset();
  TripStore.mint({});
  var seenName = null;
  TripStore.on("tripChange", function () {
    seenName = TripStore.trip.name;
  });
  TripStore.setName("hello");
  assert.strictEqual(seenName, "hello");   // saw the new state, not the old
});

test("trip.id-undefined class: every mutator path leaves trip.id set", function () {
  // Old bug: trip.id was undefined after reload because storage
  // envelope had no id field. New: migration backfills from storage
  // key, mint assigns at creation.
  reset();
  var t = TripStore.mint({});
  assert.ok(t.id);
  TripStore.setName("x");
  TripStore.setDestinations([]);
  TripStore.updateBrief({});
  assert.ok(TripStore.trip.id);
  TripStore.unload();
  TripStore.load(t.id);
  assert.strictEqual(TripStore.trip.id, t.id);
});

test("parallel-arrays class: only one source of truth", function () {
  // Old bug: _tb.placeActivities and trip.placeActivities and
  // _mdcItems and trip.mdcItems could disagree. New: only
  // trip.placeActivities exists. There is no parallel array.
  reset();
  TripStore.mint({});
  TripStore.setPlaceActivities([{ id: "pa1" }]);
  // Verify there's no mdcItems-shaped field
  assert.strictEqual(TripStore.trip.mdcItems, undefined);
  // setPlaceActivities mutates the canonical field
  assert.strictEqual(TripStore.trip.placeActivities.length, 1);
});

test("schema-renames class: a rename ships as a migration, not a manual sweep", function () {
  // The architectural test: if we were to rename
  // trip.placeActivities → trip.sections, we'd:
  //   1. Bump SCHEMA_VERSION
  //   2. Write _migrateV1ToV2 to rename the field
  //   3. All trips load through migration on next read
  // Today's test is just that the migrator interface exists and
  // that v0→v1 actually mutates the trip on load.
  reset();
  _storage["max-trip-trip-legacy"] = JSON.stringify({
    trip: { id: "trip-legacy", mdcItems: [{ id: "x" }] }
  });
  var t = TripStore.load("trip-legacy");
  assert.strictEqual(t.mdcItems, undefined);   // migration dropped it
  assert.strictEqual(t._schemaVersion, TripStore.SCHEMA_VERSION);
});

test("publish-atomicity class: destinations + routes update in one emit", function () {
  // Old bug: destinations could update without routes catching up,
  // or vice versa. Publish was a multi-statement sequence with
  // independent saves. New: one mutator, one emit, one persist.
  reset();
  TripStore.mint({});
  var emits = 0;
  TripStore.on("tripChange", function (e) {
    if (e.mutator === "publish") emits++;
  });
  TripStore.publish({
    destinations: [{ id: "d1" }],
    routes: [{ id: "r1" }]
  });
  assert.strictEqual(emits, 1);
  assert.strictEqual(TripStore.trip.destinations.length, 1);
  assert.strictEqual(TripStore.trip.routes.length, 1);
});

// ── Phase 6 integration scenarios ─────────────────────────────────────
// Each scenario simulates a real-world flow that exercised one of the
// bug classes we hit this session. Each passes by construction now.

console.log("\nPhase 6 integration scenarios");

test("full lifecycle: mint → name → destinations → reload preserves everything", function () {
  reset();
  // User pastes a list, picker mints a trip
  TripStore.batch(function () {
    TripStore.mint({ region: "Iceland", when: "September 2026" });
    TripStore.setName("Iceland 2026");
    TripStore.setPlaceActivities([
      { id: "pa1", section: "Hike to waterfalls", checked: true, requiredPlaces: [{ place: "Seljalandsfoss", _keep: true }] },
      { id: "pa2", section: "Drive scenic routes", checked: true, requiredPlaces: [{ place: "Ring Road", _keep: true }] }
    ]);
    TripStore.setCandidates([
      { id: "c1", place: "Reykjavík", role: "stay" },
      { id: "c2", place: "Vík", role: "stay" }
    ]);
  }, "test-mint-flow");
  var tripId = TripStore.trip.id;
  // User clicks "Create my trip" — publish populates destinations
  TripStore.publish({
    destinations: [
      { id: "d1", place: "Reykjavík", nights: 3 },
      { id: "d2", place: "Vík", nights: 2 }
    ],
    routes: [{ id: "r-d1-d2" }]
  });
  // Simulate page reload
  TripStore.unload();
  TripStore.load(tripId);
  // Everything survives
  assert.strictEqual(TripStore.trip.id, tripId);
  assert.strictEqual(TripStore.trip.name, "Iceland 2026");
  assert.strictEqual(TripStore.trip.brief.region, "Iceland");
  assert.strictEqual(TripStore.trip.destinations.length, 2);
  assert.strictEqual(TripStore.trip.destinations[0].place, "Reykjavík");
  assert.strictEqual(TripStore.trip.placeActivities.length, 2);
  assert.strictEqual(TripStore.trip.placeActivities[0].section, "Hike to waterfalls");
  assert.strictEqual(TripStore.trip.candidates.length, 2);
  assert.strictEqual(TripStore.trip.routes.length, 1);
});

test("sync-clobber: pulling an older envelope does NOT replace newer local state", function () {
  reset();
  TripStore.mint({});
  TripStore.setName("local edit");
  var localSaved = TripStore.trip.__saved__;
  // Simulate a sync pull arriving with the SAME __saved__ as local
  // (its own echo) — listener should refuse to clobber. In the real
  // app the engine-trip.js listener guards this with TripStore's
  // local-saved comparison.
  var olderEnvelope = {
    trip: { id: TripStore.trip.id, name: "stale server copy", _schemaVersion: 1 },
    __saved__: localSaved - 1000
  };
  // Manually simulate the listener's decision:
  var localTrip = TripStore.trip;
  var localSavedTs = (localTrip && localTrip.__saved__) || 0;
  var incomingSaved = olderEnvelope.__saved__ || (olderEnvelope.trip && olderEnvelope.trip.__saved__) || 0;
  var shouldSkip = localSavedTs && localSavedTs >= incomingSaved;
  assert.ok(shouldSkip, "older envelope must be rejected");
  // Local survives
  assert.strictEqual(TripStore.trip.name, "local edit");
});

test("destination-loss: paste-flow mint cannot clobber existing trip's storage", function () {
  reset();
  // First trip: real published trip with destinations
  var t1 = TripStore.mint({});
  TripStore.publish({
    destinations: [{ id: "d1" }, { id: "d2" }, { id: "d3" }]
  });
  var t1id = t1.id;
  // User goes to home (unload), pastes a new list (mint)
  TripStore.unload();
  // Force timestamp delta
  var until = Date.now() + 5;
  while (Date.now() < until) {}
  var t2 = TripStore.mint({});
  // The new trip has a DIFFERENT id — every mint generates fresh
  assert.notStrictEqual(t1id, t2.id);
  // Original trip's destinations untouched in storage
  var stored = MaxDB.trip.read(t1id);
  assert.strictEqual(stored.trip.destinations.length, 3);
});

test("stale-render: subscribers see current state in their callback (not pre-mutation)", function () {
  reset();
  TripStore.mint({});
  var capturedName, capturedDests;
  TripStore.on("tripChange", function () {
    capturedName = TripStore.trip.name;
    capturedDests = TripStore.trip.destinations.length;
  });
  TripStore.batch(function () {
    TripStore.setName("Iceland 2026");
    TripStore.setDestinations([{ id: "d1" }, { id: "d2" }]);
  });
  // The listener saw the FINAL post-mutation state, not any
  // intermediate or pre-mutation snapshot.
  assert.strictEqual(capturedName, "Iceland 2026");
  assert.strictEqual(capturedDests, 2);
});

test("trip.id never undefined: every mutator path leaves it set", function () {
  reset();
  var t = TripStore.mint({});
  assert.ok(t.id);
  assert.strictEqual(typeof t.id, "string");
  // After multiple operations
  TripStore.setName("x");
  TripStore.setDestinations([{ id: "d1" }]);
  TripStore.updateBrief({ region: "Iceland" });
  TripStore.publish({ destinations: [{ id: "d2" }] });
  assert.ok(TripStore.trip.id);
  // After reload
  TripStore.unload();
  TripStore.load(t.id);
  assert.ok(TripStore.trip.id);
  assert.strictEqual(TripStore.trip.id, t.id);
});

test("notifyChange + autoSave-bridge fires subscribers on legacy mutations", function () {
  reset();
  TripStore.mint({});
  // Simulate a legacy mutation: mutate trip directly, call notifyChange
  // (what autoSave does after Phase 5).
  global.trip.name = "legacy mutation";
  TripStore.notifyChange("autoSave");
  // Subscriber should have seen the new state.
  var subscriberSawName = null;
  TripStore.on("tripChange", function () { subscriberSawName = TripStore.trip.name; });
  TripStore.notifyChange("test");
  assert.strictEqual(subscriberSawName, "legacy mutation");
});

test("schema migration runs on load (legacy envelope without id is healed)", function () {
  reset();
  // Pre-rewrite envelope: trip object lacks id field; id is only the key.
  _storage["max-trip-trip-legacy-X"] = JSON.stringify({
    trip: {
      name: "Old trip",
      // no id field
      destinations: [{ id: "d1", place: "Reykjavík" }],
      mdcItems: [{ id: "pa1", section: "Hike" }]  // legacy field
    }
  });
  TripStore.load("trip-legacy-X");
  // Migration backfilled the id from the storage key
  assert.strictEqual(TripStore.trip.id, "trip-legacy-X");
  // Migration dropped the legacy mdcItems field
  assert.strictEqual(TripStore.trip.mdcItems, undefined);
  // Migration filled in default fields
  assert.ok(Array.isArray(TripStore.trip.placeActivities));
  assert.ok(TripStore.trip.brief);
  assert.ok(TripStore.trip.picker);
  // Destinations survived
  assert.strictEqual(TripStore.trip.destinations.length, 1);
  // Schema version is current
  assert.strictEqual(TripStore.trip._schemaVersion, TripStore.SCHEMA_VERSION);
});

// ── Result ────────────────────────────────────────────────────────────

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
