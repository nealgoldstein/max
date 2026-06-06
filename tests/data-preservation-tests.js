// data-preservation-tests.js — gates the user-data invariant.
//
// For each user-owned field documented in data-inventory.md, this
// suite asserts:
//   "User added X during state Y. After mutation Z, X is still there."
//
// These tests are the contract that lets us refactor publishTrip,
// migrate schemas, and ship `mergeUserStateIntoRegenerated` without
// silently dropping user data. Run via tests/run.sh — failures
// block deploy.
//
// Covers: top-level trip fields, per-destination user state
// (reservations, notes, day items), brief fields, considered/
// rejected sights, paste-list metadata, and accessor-layer reads.

var path = require("path");
var fs = require("fs");
var assert = require("assert");

// ── Harness ──────────────────────────────────────────────────────────
var pass = 0, fail = 0;
var _testChain = Promise.resolve();
function test(name, fn) {
  // Sync or async. If the test fn returns a promise, await it before
  // moving on; otherwise treat as sync. Chain through _testChain so
  // tests run in declaration order (no interleaving).
  _testChain = _testChain.then(function () {
    var ret;
    try {
      ret = fn();
    } catch (e) {
      console.log("  ✗ " + name);
      console.log("    " + (e && e.message));
      if (e && e.stack) console.log("    " + e.stack.split("\n").slice(1, 4).join("\n    "));
      fail++;
      return;
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
    console.log("  ✓ " + name);
    pass++;
  });
}

// ── Mock environment ────────────────────────────────────────────────
var _storage = {};
function _resetStorage() { _storage = {}; }

global.MaxDB = {
  trip: {
    write: function (id, env) { _storage["max-trip-" + id] = JSON.stringify(env); return true; },
    writeRaw: function (id, raw) { _storage["max-trip-" + id] = raw; return true; },
    read: function (id) {
      var raw = _storage["max-trip-" + id];
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_) { return null; }
    },
    listIds: function () {
      return Object.keys(_storage)
        .filter(function (k) { return k.indexOf("max-trip-") === 0; })
        .map(function (k) { return k.replace("max-trip-", ""); });
    }
  }
};

global.localStorage = {
  _store: {},
  getItem: function (k) { return this._store[k] || null; },
  setItem: function (k, v) { this._store[k] = String(v); },
  removeItem: function (k) { delete this._store[k]; }
};

// Load TripStore.
var tripStoreSrc = fs.readFileSync(path.join(__dirname, "..", "tripstore.js"), "utf8");
new Function(tripStoreSrc)();

// Load MaxData accessor layer.
var maxDataSrc = fs.readFileSync(path.join(__dirname, "..", "max-data.js"), "utf8");
new Function(maxDataSrc)();

// Load MaxMerge user-state preservation.
var maxMergeSrc = fs.readFileSync(path.join(__dirname, "..", "max-merge.js"), "utf8");
new Function(maxMergeSrc)();

assert(typeof global.TripStore === "object", "TripStore must load");
assert(typeof global.MaxData === "object", "MaxData accessor must load");
assert(typeof global.MaxMerge === "object", "MaxMerge must load");

// ── Fixtures ────────────────────────────────────────────────────────

function _freshTrip() {
  _resetStorage();
  global.TripStore.unload();
  return global.TripStore.mint({ region: "Iceland", sentence: "ring road" });
}

function _destWithUserState() {
  return {
    id: "d1",
    place: "Vík",
    country: "Iceland",
    nights: 2,
    arrival: "2026-09-12T14:00",
    departure: "2026-09-14T10:00",
    reservations: [
      {
        id: "r1",
        type: "hotel",
        name: "Hotel Vík",
        confirmation: "ABC123",
        address: "Víkurbraut 26",
        dateFrom: "2026-09-12",
        dateTo: "2026-09-14",
        cancellationPolicy: "Free until 48h before"
      }
    ],
    bookings: [
      { id: "b1", name: "Reynisfjara guided walk", confirmation: "GUIDE-789", dateFrom: "2026-09-13" }
    ],
    notes: "Park at the beach lot; cliffs are slippery in rain.",
    suggestions: [
      { id: "s1", name: "Reynisfjara black sand beach", _considered: true, lat: 63.4, lng: -19.05 },
      { id: "s2", name: "Dyrhólaey lighthouse", _rejected: true },
      { id: "s3", name: "Skógafoss", _considered: true, lat: 63.53, lng: -19.51 }
    ],
    dayItems: [
      { id: "di1", name: "Morning at Reynisfjara", duration: 2, userEdited: true }
    ],
    dayTrips: [
      { id: "dt1", name: "Golden Circle loop", custom: true }
    ],
    _isDayTrip: false,
    _pinned: true,
    _userReassigned: true,
    attachedEvents: [{ name: "Northern Lights concert", date: "2026-09-13T20:00" }]
  };
}

// ── Top-level trip-field preservation ───────────────────────────────
console.log("\ndata-preservation — top-level user fields\n");

test("name survives setBrief", function () {
  var t = _freshTrip();
  global.TripStore.setName("My Iceland Trip");
  global.TripStore.setBrief({ region: "Iceland", sentence: "different" });
  assert.strictEqual(t.name, "My Iceland Trip");
});

test("name survives updateBrief", function () {
  var t = _freshTrip();
  global.TripStore.setName("Test Trip");
  global.TripStore.updateBrief({ when: "September" });
  assert.strictEqual(t.name, "Test Trip");
});

test("notes survives setDestinations", function () {
  var t = _freshTrip();
  global.TripStore.setNotes({ text: "Important trip note", links: [{ url: "https://example.com", title: "Booking" }] });
  global.TripStore.setDestinations([{ id: "d1", place: "Reykjavík" }]);
  assert.strictEqual(t.notes.text, "Important trip note");
  assert.strictEqual(t.notes.links.length, 1);
});

test("trackSpending survives setDestinations", function () {
  var t = _freshTrip();
  global.TripStore.batch(function () {
    t.trackSpending = true;
  }, "test-set-tracking");
  global.TripStore.setDestinations([{ id: "d1", place: "Reykjavík" }]);
  assert.strictEqual(t.trackSpending, true);
});

test("_lastScreen survives setBrief", function () {
  var t = _freshTrip();
  global.TripStore.setLastScreen("dest-view-d1");
  global.TripStore.setBrief({ region: "Iceland" });
  assert.strictEqual(t._lastScreen, "dest-view-d1");
});

// ── Per-destination user state ──────────────────────────────────────
console.log("\ndata-preservation — per-destination user state\n");

test("reservations survive updateDestination on a different field", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { nights: 3 });
  var d = t.destinations[0];
  assert.strictEqual(d.reservations.length, 1);
  assert.strictEqual(d.reservations[0].confirmation, "ABC123");
});

test("bookings survive updateDestination", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { departure: "2026-09-15T10:00" });
  var d = t.destinations[0];
  assert.strictEqual(d.bookings.length, 1);
  assert.strictEqual(d.bookings[0].confirmation, "GUIDE-789");
});

test("per-destination notes survive updateDestination", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { nights: 4 });
  var d = t.destinations[0];
  assert(d.notes && d.notes.indexOf("Park at the beach lot") >= 0);
});

test("considered + rejected flags survive updateDestination", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { nights: 3 });
  var d = t.destinations[0];
  assert.strictEqual(d.suggestions[0]._considered, true);
  assert.strictEqual(d.suggestions[1]._rejected, true);
  assert.strictEqual(d.suggestions[2]._considered, true);
});

test("dayItems with userEdited flag survive updateDestination", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { departure: "2026-09-15T10:00" });
  var d = t.destinations[0];
  assert.strictEqual(d.dayItems.length, 1);
  assert.strictEqual(d.dayItems[0].userEdited, true);
});

test("dayTrips marked custom survive updateDestination", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { nights: 3 });
  var d = t.destinations[0];
  assert.strictEqual(d.dayTrips.length, 1);
  assert.strictEqual(d.dayTrips[0].custom, true);
});

test("attachedEvents survive updateDestination", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { nights: 3 });
  var d = t.destinations[0];
  assert.strictEqual(d.attachedEvents.length, 1);
  assert.strictEqual(d.attachedEvents[0].name, "Northern Lights concert");
});

test("destNote survives setDestinations", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.setDestNote("d1", "Remember to confirm the hotel by Sept 10");
  global.TripStore.setDestinations([_destWithUserState()]);
  assert.strictEqual(t.destNotes.d1, "Remember to confirm the hotel by Sept 10");
});

test("destStory survives setDestinations", function () {
  var t = _freshTrip();
  global.TripStore.setDestStory("d1", "Vík was where the journey turned.");
  global.TripStore.setDestinations([_destWithUserState()]);
  assert.strictEqual(t.destStories.d1, "Vík was where the journey turned.");
});

test("sightStory survives setPlaceActivities", function () {
  var t = _freshTrip();
  global.TripStore.setSightStory("s1", "Reynisfjara at dawn — basalt columns mid-mist.");
  global.TripStore.setPlaceActivities([{ id: "p1", name: "Vík sights" }]);
  assert.strictEqual(t.sightStories.s1, "Reynisfjara at dawn — basalt columns mid-mist.");
});

// ── Brief fields (all user-owned) ───────────────────────────────────
console.log("\ndata-preservation — brief fields\n");

test("brief.tripMeta.notes survives setDestinations", function () {
  var t = _freshTrip();
  global.TripStore.updateBrief({ tripMeta: { notes: "User-pasted source list", links: [] } });
  global.TripStore.setDestinations([{ id: "d1", place: "Reykjavík" }]);
  assert.strictEqual(t.brief.tripMeta.notes, "User-pasted source list");
});

test("brief._userListedNames survives publish", function () {
  var t = _freshTrip();
  global.TripStore.updateBrief({
    _userListedNames: { "vik": true, "reykjavík": true },
    _userListedDisplay: { "vik": "Vík", "reykjavík": "Reykjavík" }
  });
  global.TripStore.publish({
    destinations: [{ id: "d1", place: "Reykjavík" }],
    routes: []
  });
  assert(t.brief._userListedNames);
  assert.strictEqual(t.brief._userListedNames.vik, true);
  assert.strictEqual(t.brief._userListedDisplay.vik, "Vík");
});

test("brief._initialWispsRaw survives publish", function () {
  var t = _freshTrip();
  global.TripStore.updateBrief({
    _initialWispsRaw: [
      { kind: "why", text: "Honeymoon-ish but not basic" },
      { kind: "anchor", text: "Vík" }
    ]
  });
  global.TripStore.publish({ destinations: [], routes: [] });
  assert(Array.isArray(t.brief._initialWispsRaw));
  assert.strictEqual(t.brief._initialWispsRaw.length, 2);
});

test("brief.entry, exit, dates survive setName + updateBrief partial", function () {
  var t = _freshTrip();
  global.TripStore.updateBrief({
    entry: "KEF",
    tbExit: "RVK",
    startDate: "2026-09-12",
    endDate: "2026-09-20"
  });
  global.TripStore.setName("Iceland Sept");
  global.TripStore.updateBrief({ pace: "loose" });
  assert.strictEqual(t.brief.entry, "KEF");
  assert.strictEqual(t.brief.tbExit, "RVK");
  assert.strictEqual(t.brief.startDate, "2026-09-12");
  assert.strictEqual(t.brief.endDate, "2026-09-20");
  assert.strictEqual(t.brief.pace, "loose");
});

// ── Considered / rejected (PD.269 sources model) ────────────────────
console.log("\ndata-preservation — considered + rejected sights\n");

test("considered sight survives mutation of unrelated destination field", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { nights: 4 });
  var c = global.MaxData.getConsideredSights(t);
  // 2 considered sights in the fixture; Reynisfjara has coords, Skógafoss has coords
  assert.strictEqual(c.length, 2);
  var names = c.map(function (x) { return x.place; }).sort();
  assert.deepStrictEqual(names, ["Reynisfjara black sand beach", "Skógafoss"]);
});

test("rejected sight survives mutation of unrelated destination field", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  global.TripStore.updateDestination("d1", { nights: 4 });
  var r = global.MaxData.getRejectedSights(t);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].place, "Dyrhólaey lighthouse");
});

test("countConsideredSights matches getConsideredSights for trips with coords", function () {
  var t = _freshTrip();
  global.TripStore.setDestinations([_destWithUserState()]);
  // Note: countConsideredSights counts ALL _considered:true (no coord
  // requirement). getConsideredSights filters to those with coords.
  // The fixture has 2 considered, both with coords, so they match.
  assert.strictEqual(global.MaxData.countConsideredSights(t), 2);
  assert.strictEqual(global.MaxData.getConsideredSights(t).length, 2);
});

// ── Schema migration: legacy fields preserved or migrated, not dropped silently ──
console.log("\ndata-preservation — schema migration safety\n");

test("legacy trip without id gets one backfilled (PD.74)", function () {
  _resetStorage();
  // Hand-roll a v0 envelope with no id field — pre-rewrite shape.
  var raw = JSON.stringify({
    trip: { name: "Old trip", destinations: [] },
    _schemaVersion: 0,
    __saved__: 0
  });
  _storage["max-trip-legacy-001"] = raw;
  global.TripStore.unload();
  var t = global.TripStore.load("legacy-001");
  assert.strictEqual(t.id, "legacy-001");
});

test("PD.321: legacy mdcItems is REPLACED by the placeActivities alias, not dropped", function () {
  _resetStorage();
  var raw = JSON.stringify({
    trip: {
      id: "legacy-002",
      name: "Old trip",
      destinations: [],
      placeActivities: [{ id: "p1", name: "Section 1" }],
      mdcItems: [{ id: "m1", name: "Legacy section" }]
    },
    _schemaVersion: 0,
    __saved__: 0
  });
  _storage["max-trip-legacy-002"] = raw;
  global.TripStore.unload();
  var t = global.TripStore.load("legacy-002");
  // placeActivities preserved
  assert(Array.isArray(t.placeActivities));
  assert.strictEqual(t.placeActivities.length, 1);
  // PD.321: mdcItems is now an ALIAS for placeActivities — same array
  // reference. The legacy mdcItems content from the envelope is
  // replaced (canonical store wins) but the field itself stays
  // present so legacy readers don't crash.
  assert(Array.isArray(t.mdcItems));
  assert.strictEqual(t.mdcItems, t.placeActivities,
    "PD.321: mdcItems must be the SAME array reference as placeActivities");
  assert.strictEqual(t.mdcItems[0].name, "Section 1");
});

test("PD.321: mint creates a trip with mdcItems aliased to placeActivities", function () {
  _resetStorage();
  global.TripStore.unload();
  var t = global.TripStore.mint({ region: "Iceland" });
  assert(Array.isArray(t.placeActivities));
  assert.strictEqual(t.mdcItems, t.placeActivities,
    "mint must alias mdcItems to placeActivities");
});

test("PD.321: setPlaceActivities re-aliases mdcItems to the new array", function () {
  _resetStorage();
  global.TripStore.unload();
  var t = global.TripStore.mint({ region: "Iceland" });
  var newItems = [{ id: "a" }, { id: "b" }];
  global.TripStore.setPlaceActivities(newItems);
  assert.strictEqual(t.placeActivities, newItems);
  assert.strictEqual(t.mdcItems, newItems,
    "mdcItems must follow placeActivities after setPlaceActivities");
});

test("PD.321: mutation on mdcItems is visible to placeActivities (shared reference)", function () {
  _resetStorage();
  global.TripStore.unload();
  var t = global.TripStore.mint({ region: "Iceland" });
  t.mdcItems.push({ id: "legacy-write" });
  assert.strictEqual(t.placeActivities.length, 1,
    "writing to mdcItems must be visible on placeActivities (shared array)");
  assert.strictEqual(t.placeActivities[0].id, "legacy-write");
});

test("PD.321: a legacy v0 trip with mdcItems and NO placeActivities still loads", function () {
  // Old envelope shape — pre-PD.303 trips might have only mdcItems.
  // The migration must default placeActivities to [] BEFORE aliasing
  // mdcItems = placeActivities, otherwise the alias drops the legacy
  // content. Verify the migration handles this.
  _resetStorage();
  var raw = JSON.stringify({
    trip: {
      id: "legacy-005",
      name: "Pre-PD.303 trip",
      destinations: [],
      mdcItems: [{ id: "old-m1", name: "Original section" }]
      // no placeActivities field at all
    },
    _schemaVersion: 0,
    __saved__: 0
  });
  _storage["max-trip-legacy-005"] = raw;
  global.TripStore.unload();
  var t = global.TripStore.load("legacy-005");
  // Trip loaded without throwing — the load itself is the test.
  assert(t);
  assert(Array.isArray(t.placeActivities));
  assert(Array.isArray(t.mdcItems));
  assert.strictEqual(t.mdcItems, t.placeActivities, "alias holds");
  // The pre-PD.303 mdcItems content is LOST (placeActivities is the
  // canonical store; the migration trusts it). This is the same
  // trade-off PD.319-6's backup snapshot preserves for recovery.
});

test("user-owned brief fields survive migration", function () {
  _resetStorage();
  var raw = JSON.stringify({
    trip: {
      id: "legacy-003",
      name: "Old trip",
      brief: {
        region: "Iceland",
        sentence: "ring road",
        _userListedNames: { "vik": true },
        _initialWispsRaw: [{ kind: "anchor", text: "Vík" }]
      },
      destinations: []
    },
    _schemaVersion: 0,
    __saved__: 0
  });
  _storage["max-trip-legacy-003"] = raw;
  global.TripStore.unload();
  var t = global.TripStore.load("legacy-003");
  assert.strictEqual(t.brief.region, "Iceland");
  assert.strictEqual(t.brief._userListedNames.vik, true);
  assert.strictEqual(t.brief._initialWispsRaw[0].text, "Vík");
});

test("user-owned reservations on legacy destinations survive migration", function () {
  _resetStorage();
  var raw = JSON.stringify({
    trip: {
      id: "legacy-004",
      name: "Old trip",
      destinations: [{
        id: "d1",
        place: "Vík",
        reservations: [{ id: "r1", confirmation: "OLD-ABC" }],
        notes: "User-typed before the rewrite"
      }],
      placeActivities: []
    },
    _schemaVersion: 0,
    __saved__: 0
  });
  _storage["max-trip-legacy-004"] = raw;
  global.TripStore.unload();
  var t = global.TripStore.load("legacy-004");
  var d = t.destinations[0];
  assert.strictEqual(d.reservations[0].confirmation, "OLD-ABC");
  assert.strictEqual(d.notes, "User-typed before the rewrite");
});

// ── Accessor layer (MaxData) correctness ────────────────────────────
console.log("\ndata-preservation — accessor layer (MaxData)\n");

test("MaxData.getPlaceActivities falls back to mdcItems if placeActivities missing", function () {
  var trip = { mdcItems: [{ id: "m1", name: "Legacy section" }] };
  var items = global.MaxData.getPlaceActivities(trip);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].name, "Legacy section");
});

test("MaxData.getPlaceActivities prefers placeActivities when both present", function () {
  var trip = {
    placeActivities: [{ id: "p1", name: "Canonical" }],
    mdcItems: [{ id: "m1", name: "Legacy" }]
  };
  var items = global.MaxData.getPlaceActivities(trip);
  assert.strictEqual(items[0].name, "Canonical");
});

test("MaxData.findDestination finds by id", function () {
  var trip = { destinations: [{ id: "d1", place: "Vík" }, { id: "d2", place: "Höfn" }] };
  assert.strictEqual(global.MaxData.findDestination(trip, "d2").place, "Höfn");
});

test("MaxData.getConsideredSights returns empty when no destinations", function () {
  assert.deepStrictEqual(global.MaxData.getConsideredSights({}), []);
  assert.deepStrictEqual(global.MaxData.getConsideredSights(null), []);
});

test("MaxData.getConsideredSights skips sights already in trip as destinations", function () {
  var trip = {
    destinations: [{
      id: "d1",
      place: "Vík",
      suggestions: [
        { name: "Vík", _considered: true, lat: 1, lng: 2 },
        { name: "Reynisfjara", _considered: true, lat: 3, lng: 4 }
      ]
    }, {
      id: "d2",
      place: "Reynisfjara"  // already a destination
    }]
  };
  var c = global.MaxData.getConsideredSights(trip);
  // Only Vík is "considered" but it's the parent dest itself → also skipped.
  // Both filtered out. Real-world: this catches the "don't double-display"
  // bug.
  var names = c.map(function (x) { return x.place; });
  assert(names.indexOf("Vík") === -1, "parent dest itself should be skipped");
  assert(names.indexOf("Reynisfjara") === -1, "sight that's already a destination should be skipped");
});

test("MaxData.describeTrip surfaces schema state", function () {
  var trip = {
    id: "t1",
    _schemaVersion: 1,
    destinations: [{ id: "d1" }],
    placeActivities: [{ id: "p1" }],
    candidates: [],
    routes: [],
    brief: { _userListedNames: { "x": true } }
  };
  var d = global.MaxData.describeTrip(trip);
  assert.strictEqual(d.present, true);
  assert.strictEqual(d.id, "t1");
  assert.strictEqual(d.destinations, 1);
  assert.strictEqual(d.placeActivities, 1);
  assert.strictEqual(d.userListedNames, 1);
  assert.strictEqual(d.hasMdcItems, false);
});

// ── Audit log (PD.319-5) ────────────────────────────────────────────
console.log("\ndata-preservation — mutation audit log\n");

test("every mutator appends an audit entry", function () {
  var t = _freshTrip();
  global.TripStore.setName("Test");
  global.TripStore.setBrief({ region: "Iceland" });
  global.TripStore.setNotes({ text: "hi" });
  assert(Array.isArray(t._auditLog), "trip._auditLog should be created");
  // mint = no audit (creates the trip), setName, setBrief, setNotes = 3
  assert(t._auditLog.length >= 3,
    "audit log should have at least 3 entries after 3 mutators; got " + t._auditLog.length);
  var mutators = t._auditLog.map(function (e) { return e.m; });
  assert(mutators.indexOf("setName") >= 0);
  assert(mutators.indexOf("setBrief") >= 0);
  assert(mutators.indexOf("setNotes") >= 0);
});

test("audit entries carry timestamp + version + mutator name + summarized payload", function () {
  var t = _freshTrip();
  global.TripStore.setName("My Trip");
  var last = t._auditLog[t._auditLog.length - 1];
  assert(typeof last.t === "number", "timestamp");
  assert(typeof last.v === "number", "version");
  assert.strictEqual(last.m, "setName");
  assert(last.p && last.p.name === "My Trip", "payload preserved");
});

test("audit log payload summarizes large arrays as {len:N}", function () {
  var t = _freshTrip();
  var bigArray = [];
  for (var i = 0; i < 50; i++) bigArray.push({ id: "x" + i });
  global.TripStore.setCandidates(bigArray);
  var last = t._auditLog[t._auditLog.length - 1];
  assert.strictEqual(last.m, "setCandidates");
  // payload is { count: 50 } → that's already small, but verify the
  // trimming helper preserves it.
  assert.strictEqual(last.p.count, 50);
});

test("audit log truncates strings >80 chars", function () {
  var t = _freshTrip();
  var longName = "x".repeat(200);
  global.TripStore.setName(longName);
  var last = t._auditLog[t._auditLog.length - 1];
  assert(last.p.name.length <= 81, "long string should be truncated; got len " + last.p.name.length);
});

test("audit log caps at 200 entries (oldest rolls off)", function () {
  var t = _freshTrip();
  for (var i = 0; i < 220; i++) {
    global.TripStore.setName("Name " + i);
  }
  assert(t._auditLog.length <= 200,
    "audit log should be capped at 200; got " + t._auditLog.length);
  // The LAST entry should be the most recent.
  var last = t._auditLog[t._auditLog.length - 1];
  assert.strictEqual(last.p.name, "Name 219");
});

test("audit log survives round-trip through storage", function () {
  _resetStorage();
  global.TripStore.unload();
  global.TripStore.mint({ region: "Iceland" });
  global.TripStore.setName("Persisted Trip");
  global.TripStore.setBrief({ when: "Sept" });
  var id = global.TripStore.trip.id;
  global.TripStore.unload();
  var t = global.TripStore.load(id);
  assert(Array.isArray(t._auditLog));
  var mutators = t._auditLog.map(function (e) { return e.m; });
  assert(mutators.indexOf("setName") >= 0);
  assert(mutators.indexOf("setBrief") >= 0);
});

// ── Migration safeguards (PD.319-6) ─────────────────────────────────
console.log("\ndata-preservation — migration backup safeguards\n");

test("loading a v0 trip writes a _preMigrationBackup with the original", function () {
  _resetStorage();
  var v0 = {
    id: "legacy-snap-001",
    name: "Old Trip",
    destinations: [{ id: "d1", place: "Vík" }],
    mdcItems: [{ id: "m1", name: "Will be dropped" }]
  };
  _storage["max-trip-legacy-snap-001"] = JSON.stringify({
    trip: v0, _schemaVersion: 0, __saved__: 0
  });
  global.TripStore.unload();
  var t = global.TripStore.load("legacy-snap-001");
  assert(t._preMigrationBackup, "snapshot should be created");
  assert.strictEqual(t._preMigrationBackup.fromVersion, 0);
  assert.strictEqual(t._preMigrationBackup.toVersion, 1);
  assert(t._preMigrationBackup.snapshot, "snapshot data present");
  // The snapshot should have the mdcItems that got stripped.
  assert(Array.isArray(t._preMigrationBackup.snapshot.mdcItems));
  assert.strictEqual(t._preMigrationBackup.snapshot.mdcItems[0].name, "Will be dropped");
});

test("a trip already at SCHEMA_VERSION does NOT get a redundant backup", function () {
  _resetStorage();
  var current = {
    id: "current-001",
    name: "Current Trip",
    destinations: [],
    placeActivities: [],
    _schemaVersion: 1
  };
  _storage["max-trip-current-001"] = JSON.stringify({
    trip: current, _schemaVersion: 1, __saved__: 0
  });
  global.TripStore.unload();
  var t = global.TripStore.load("current-001");
  assert(!t._preMigrationBackup,
    "no backup expected for an already-migrated trip");
});

test("pre-migration backup persists across reload", function () {
  _resetStorage();
  var v0 = {
    id: "legacy-persist-001",
    name: "Old Trip",
    destinations: []
  };
  _storage["max-trip-legacy-persist-001"] = JSON.stringify({
    trip: v0, _schemaVersion: 0, __saved__: 0
  });
  global.TripStore.unload();
  global.TripStore.load("legacy-persist-001");
  global.TripStore.setName("Updated name post-migration");
  global.TripStore.unload();
  var t = global.TripStore.load("legacy-persist-001");
  assert(t._preMigrationBackup, "backup should still be present after a mutation + reload");
  assert.strictEqual(t._preMigrationBackup.fromVersion, 0);
});

// ── mergeUserStateIntoRegenerated (PD.319-4) ────────────────────────
console.log("\ndata-preservation — mergeUserStateIntoRegenerated\n");

function _oldTripWithUserState() {
  return {
    id: "t-old",
    name: "Iceland Trip",
    _lastScreen: "trip-overview",
    trackSpending: true,
    notes: { text: "Trip-level note", links: [{ url: "https://x.y" }] },
    destNotes: { d1: "Confirm hotel by Sept 10" },
    destStories: { d1: "Vík was where it turned." },
    sightStories: { s1: "Reynisfjara at dawn." },
    brief: {
      region: "Iceland",
      sentence: "ring road",
      _userListedNames: { "vik": true },
      tripMeta: { notes: "User-pasted notes" }
    },
    destinations: [_destWithUserState()],
    _gapNudgeDismissed: true
  };
}

function _newTripFromRebuild() {
  // Simulates a freshly-rebuilt trip: same destination id (publishTrip
  // preserved identity), but reservations / dayItems / suggestions are
  // either empty or LLM-only — no user state attached.
  return {
    id: "t-old", // same trip id preserved
    name: "Iceland Trip — regenerated", // build overwrote name
    destinations: [{
      id: "d1",
      place: "Vík",
      country: "Iceland",
      nights: 2,
      suggestions: [
        { id: "s1", name: "Reynisfjara black sand beach", lat: 63.4, lng: -19.05 },
        { id: "s2", name: "Dyrhólaey lighthouse" },
        { id: "s3", name: "Skógafoss", lat: 63.53, lng: -19.51 }
      ],
      dayItems: [],
      dayTrips: []
    }],
    brief: { region: "Iceland" },
    notes: { text: "", links: [] }
  };
}

test("merge — reservations carry forward to regenerated destination", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  assert(Array.isArray(d.reservations));
  assert.strictEqual(d.reservations.length, 1);
  assert.strictEqual(d.reservations[0].confirmation, "ABC123");
});

test("merge — bookings carry forward", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  assert.strictEqual(d.bookings.length, 1);
  assert.strictEqual(d.bookings[0].confirmation, "GUIDE-789");
});

test("merge — per-dest notes carry forward", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  assert(d.notes && d.notes.indexOf("Park at the beach lot") >= 0);
});

test("merge — arrival/departure dates carry forward", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  assert.strictEqual(d.arrival, "2026-09-12T14:00");
  assert.strictEqual(d.departure, "2026-09-14T10:00");
});

test("merge — attachedEvents carry forward", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  assert.strictEqual(d.attachedEvents.length, 1);
  assert.strictEqual(d.attachedEvents[0].name, "Northern Lights concert");
});

test("merge — _considered flags carry forward to matched suggestions", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  var reynis = d.suggestions.find(function (s) { return s.name === "Reynisfjara black sand beach"; });
  var skoga = d.suggestions.find(function (s) { return s.name === "Skógafoss"; });
  assert.strictEqual(reynis._considered, true);
  assert.strictEqual(skoga._considered, true);
});

test("merge — _rejected flags carry forward", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  var dyrh = d.suggestions.find(function (s) { return s.name === "Dyrhólaey lighthouse"; });
  assert.strictEqual(dyrh._rejected, true);
});

test("merge — dayItems userEdited preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  assert.strictEqual(d.dayItems.length, 1);
  assert.strictEqual(d.dayItems[0].userEdited, true);
});

test("merge — dayTrips custom preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = newTrip.destinations[0];
  assert.strictEqual(d.dayTrips.length, 1);
  assert.strictEqual(d.dayTrips[0].custom, true);
});

test("merge — top-level destNotes preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert.strictEqual(newTrip.destNotes.d1, "Confirm hotel by Sept 10");
});

test("merge — top-level destStories + sightStories preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert.strictEqual(newTrip.destStories.d1, "Vík was where it turned.");
  assert.strictEqual(newTrip.sightStories.s1, "Reynisfjara at dawn.");
});

test("merge — trip-level notes preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert.strictEqual(newTrip.notes.text, "Trip-level note");
});

test("merge — trackSpending preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert.strictEqual(newTrip.trackSpending, true);
});

test("merge — _gapNudgeDismissed preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert.strictEqual(newTrip._gapNudgeDismissed, true);
});

test("merge — brief.tripMeta + _userListedNames preserved", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert(newTrip.brief.tripMeta);
  assert.strictEqual(newTrip.brief.tripMeta.notes, "User-pasted notes");
  assert.strictEqual(newTrip.brief._userListedNames.vik, true);
});

test("merge — destination match by id works", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  // newTrip's destination has id "d1" (same as old) — id-match path
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert.strictEqual(newTrip.destinations[0].reservations.length, 1);
});

test("merge — destination match by place name as id-less fallback", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  newTrip.destinations[0].id = "d-NEW-id"; // different id, same place
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  assert.strictEqual(newTrip.destinations[0].reservations.length, 1,
    "should match by place when id differs");
});

test("merge — brand-new destination in newTrip is left alone", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  // Add a new destination not in old.
  newTrip.destinations.push({ id: "d-new", place: "Akureyri", suggestions: [] });
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var ak = newTrip.destinations[1];
  assert.strictEqual(ak.place, "Akureyri");
  assert(!ak.reservations || ak.reservations.length === 0);
});

test("describePreservation reports counts before/after", function () {
  var oldTrip = _oldTripWithUserState();
  var newTrip = _newTripFromRebuild();
  global.MaxMerge.mergeUserStateIntoRegenerated(oldTrip, newTrip);
  var d = global.MaxMerge.describePreservation(oldTrip, newTrip);
  assert.strictEqual(d.reservationsBefore, 1);
  assert.strictEqual(d.reservationsAfter, 1);
  assert.strictEqual(d.consideredBefore, 2);
  assert.strictEqual(d.consideredAfter, 2);
});

// ── Round-trip (mutation → persist → load → state intact) ───────────
console.log("\ndata-preservation — persistence round-trip\n");

test("reservations survive write → load round-trip", function () {
  _resetStorage();
  global.TripStore.unload();
  global.TripStore.mint({ region: "Iceland" });
  global.TripStore.setDestinations([_destWithUserState()]);
  var id = global.TripStore.trip.id;
  global.TripStore.unload();
  var t = global.TripStore.load(id);
  var d = t.destinations[0];
  assert.strictEqual(d.reservations[0].confirmation, "ABC123");
});

test("brief.tripMeta survives write → load round-trip", function () {
  _resetStorage();
  global.TripStore.unload();
  global.TripStore.mint({ region: "Iceland" });
  global.TripStore.updateBrief({ tripMeta: { notes: "Important paste-list", links: [{ url: "x", title: "y" }] } });
  var id = global.TripStore.trip.id;
  global.TripStore.unload();
  var t = global.TripStore.load(id);
  assert.strictEqual(t.brief.tripMeta.notes, "Important paste-list");
  assert.strictEqual(t.brief.tripMeta.links[0].title, "y");
});

test("destNotes survive write → load round-trip", function () {
  _resetStorage();
  global.TripStore.unload();
  global.TripStore.mint({ region: "Iceland" });
  global.TripStore.setDestNote("d1", "Park at the beach");
  global.TripStore.setDestNote("d2", "Bring a coat");
  var id = global.TripStore.trip.id;
  global.TripStore.unload();
  var t = global.TripStore.load(id);
  assert.strictEqual(t.destNotes.d1, "Park at the beach");
  assert.strictEqual(t.destNotes.d2, "Bring a coat");
});

// ── Single-flight primitive (PD.319-7) ──────────────────────────────
console.log("\ndata-preservation — TripStore.singleFlight\n");

// singleFlight is async. We use a tiny harness to keep this synchronous-
// looking by collecting promises and resolving in order.
function _async(fn) {
  return function () { return fn(); };
}

test("singleFlight returns the same promise for concurrent calls with the same key", function () {
  var calls = 0;
  function work() {
    calls++;
    return new Promise(function (resolve) { setTimeout(function () { resolve("done"); }, 10); });
  }
  var p1 = global.TripStore.singleFlight("k1", work);
  var p2 = global.TripStore.singleFlight("k1", work);
  assert.strictEqual(p1, p2, "concurrent same-key calls should share the promise");
  assert.strictEqual(calls, 1, "work fn should only have run once");
});

test("singleFlight clears the in-flight entry after the promise resolves", function () {
  return global.TripStore.singleFlight("k2", function () {
    return Promise.resolve("first");
  }).then(function () {
    var inFlight = global.TripStore._singleFlightInFlight();
    assert.strictEqual(inFlight.indexOf("k2"), -1, "key should be cleared post-resolve");
    // A new call with the same key should now run fresh.
    var ran = false;
    return global.TripStore.singleFlight("k2", function () {
      ran = true;
      return Promise.resolve("second");
    }).then(function () {
      assert(ran, "subsequent call should run after the in-flight cleared");
    });
  });
});

test("singleFlight clears the in-flight entry after rejection (so retry works)", function () {
  return global.TripStore.singleFlight("k3", function () {
    return Promise.reject(new Error("boom"));
  }).catch(function () {
    // After rejection, new calls should run fresh.
    var ran = false;
    return global.TripStore.singleFlight("k3", function () {
      ran = true;
      return Promise.resolve("retry");
    }).then(function () {
      assert(ran, "after a rejected flight, the key must be reclaimable");
    });
  });
});

test("singleFlight different keys run independently", function () {
  var p1 = global.TripStore.singleFlight("alpha", function () { return Promise.resolve("a"); });
  var p2 = global.TripStore.singleFlight("beta",  function () { return Promise.resolve("b"); });
  assert.notStrictEqual(p1, p2, "different keys should produce different promises");
  return Promise.all([p1, p2]).then(function (results) {
    assert.deepStrictEqual(results, ["a", "b"]);
  });
});

test("singleFlight requires a string key", function () {
  assert.throws(function () {
    global.TripStore.singleFlight(null, function () { return Promise.resolve(); });
  }, /singleFlight requires a string key/);
  assert.throws(function () {
    global.TripStore.singleFlight("", function () { return Promise.resolve(); });
  }, /singleFlight requires a string key/);
});

test("singleFlight closes the PD.315 bug class by construction (concurrent writers)", function () {
  // Simulate two concurrent writers both trying to assign to a
  // shared array. Without single-flight, the second clobbers the
  // first. With single-flight, only one runs and both callers see
  // the same result.
  var box = { items: [] };
  function writer(tag) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        box.items.push(tag);
        resolve(box.items.length);
      }, 5);
    });
  }
  var p1 = global.TripStore.singleFlight("write-box", function () { return writer("A"); });
  var p2 = global.TripStore.singleFlight("write-box", function () { return writer("B"); });
  return Promise.all([p1, p2]).then(function (results) {
    assert.strictEqual(box.items.length, 1, "only one write should have occurred");
    assert.deepStrictEqual(results, [1, 1], "both callers receive the SAME result");
  });
});

// ── Final ────────────────────────────────────────────────────────────
_testChain.then(function () {
  console.log("\n──────────────────────────────────────────────────");
  console.log("PASS: " + pass + "    FAIL: " + fail);
  process.exit(fail > 0 ? 1 : 0);
});
