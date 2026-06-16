// tests/place-key-tests.js — PD.357 (Phase 3): one place identity.
//
// PlaceKey is the single owner of place-name identity: normalization,
// the PD.339 token-overlap fuzz, and the alias registry that turns
// every fuzzy hit into a permanent exact hit. These tests pin the
// semantics the rest of the app now relies on.

"use strict";

var PlaceKey = require("../place-key.mjs").default;

var pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); }
}

console.log("place-key-tests — PD.357\n");

PlaceKey.reset();

// ── norm ────────────────────────────────────────────────────────────
t("norm lowercases and trims",
  PlaceKey.norm("  Reykjavík  ") === "reykjavík");
t("norm collapses inner whitespace",
  PlaceKey.norm("Blue   Lagoon") === "blue lagoon");
t("norm of null/undefined is empty string",
  PlaceKey.norm(null) === "" && PlaceKey.norm(undefined) === "");

// ── resolve without aliases = norm ──────────────────────────────────
t("resolve falls back to norm when no alias is known",
  PlaceKey.resolve("Blue Lagoon") === PlaceKey.norm("Blue Lagoon"));

// ── learn + resolve ─────────────────────────────────────────────────
t("learn records an alias and resolve follows it",
  PlaceKey.learn("Mývatn natursone baths", "Mývatn Nature Baths") === true
    && PlaceKey.resolve("Mývatn natursone baths") === PlaceKey.norm("Mývatn Nature Baths"));
t("learn is idempotent (re-learning returns false, no dirty churn)",
  (function () {
    PlaceKey.clearDirty();
    var again = PlaceKey.learn("Mývatn natursone baths", "Mývatn Nature Baths");
    return again === false && PlaceKey.isDirty() === false;
  })());
t("learn refuses self-aliases",
  PlaceKey.learn("Vik", "vik") === false);
t("aliases are ONE HOP — no chain collapse",
  (function () {
    PlaceKey.reset();
    PlaceKey.learn("a town", "b town");
    PlaceKey.learn("b town", "c town");
    // "a town" must still point at "b town" (its learn-time canonical),
    // NOT follow the chain to "c town".
    return PlaceKey.resolve("a town") === "b town"
        && PlaceKey.resolve("b town") === "c town";
  })());
t("learn stores the CANONICAL end of an existing alias",
  (function () {
    PlaceKey.reset();
    PlaceKey.learn("old name", "real place");
    // Learning an alias TO "old name" should land on "real place".
    PlaceKey.learn("typo name", "old name");
    return PlaceKey.resolve("typo name") === "real place";
  })());

// ── same (token overlap centralization) ─────────────────────────────
PlaceKey.reset();
t("same: exact match after normalization",
  PlaceKey.same("Blue Lagoon", "blue lagoon") === true);
t("same: PD.339 overlap — 2+ shared tokens covering 2/3 of shorter",
  PlaceKey.same("Mývatn Nature Baths", "Mývatn natursone Baths") === true);
t("same: one-token overlap does NOT match (Reykjavík vs Old Harbour)",
  PlaceKey.same("Reykjavík", "Reykjavík Old Harbour") === false);
t("same: unrelated places do not match",
  PlaceKey.same("Blue Lagoon", "Golden Circle") === false);
t("same: alias-linked names match exactly",
  (function () {
    PlaceKey.learn("the bureaucrat statue", "Monument to the Unknown Bureaucrat");
    return PlaceKey.same("the bureaucrat statue", "Monument to the Unknown Bureaucrat") === true;
  })());

// ── contains / relatedTo (PD.397) ───────────────────────────────────
t("contains: a one-word name is a word-prefix of a longer name",
  PlaceKey.contains("Þingvellir", "Þingvellir National Park") === true
    && PlaceKey.contains("Þingvellir National Park", "Þingvellir") === true);
t("contains: NOT a partial-word match (Vik vs Vikurfjara)",
  PlaceKey.contains("Vik", "Vikurfjara") === false);
t("relatedTo: union of same + contains (covers the 1-token case same misses)",
  PlaceKey.relatedTo("Þingvellir", "Þingvellir National Park") === true
    && PlaceKey.same("Þingvellir", "Þingvellir National Park") === false);
t("relatedTo: distinct places still distinct",
  PlaceKey.relatedTo("Diamond Circle", "Diamond Beach") === false);

// ── serialize / hydrate round-trip ──────────────────────────────────
t("serialize → hydrate round-trips the registry",
  (function () {
    PlaceKey.reset();
    PlaceKey.learn("foo bar", "foo bar baz");
    var snap = PlaceKey.serialize();
    PlaceKey.reset();
    if (PlaceKey.resolve("foo bar") !== "foo bar") return false; // empty again
    PlaceKey.hydrate(snap);
    return PlaceKey.resolve("foo bar") === "foo bar baz";
  })());
t("hydrate ignores junk values",
  (function () {
    PlaceKey.reset();
    PlaceKey.hydrate({ good: "target", bad1: 42, bad2: null, bad3: "" });
    return PlaceKey.resolve("good") === "target" && PlaceKey.resolve("bad1") === "bad1";
  })());
t("hydrate clears the dirty flag (loaded state is persisted state)",
  (function () {
    PlaceKey.reset();
    PlaceKey.learn("x y", "x y z");
    PlaceKey.hydrate(PlaceKey.serialize());
    return PlaceKey.isDirty() === false;
  })());

// ── forget (PD.361): bad learns are correctable ─────────────────────
t("forget removes a learned alias and marks dirty",
  (function () {
    PlaceKey.reset();
    PlaceKey.learn("wrong name", "some place");
    PlaceKey.clearDirty();
    var ok = PlaceKey.forget("Wrong Name"); // normalized lookup
    return ok === true && PlaceKey.resolve("wrong name") === "wrong name"
        && PlaceKey.isDirty() === true;
  })());
t("forget of an unknown alias returns false, no dirty churn",
  (function () {
    PlaceKey.reset();
    return PlaceKey.forget("never learned") === false && PlaceKey.isDirty() === false;
  })());
t("list returns alias→canonical rows",
  (function () {
    PlaceKey.reset();
    PlaceKey.learn("a b", "a b c");
    var rows = PlaceKey.list();
    return rows.length === 1 && rows[0].alias === "a b" && rows[0].canonical === "a b c";
  })());

// ── integration: MaxData._normKey is alias-aware ────────────────────
t("canonicalizer dedupes alias-linked names via PlaceKey",
  (function () {
    PlaceKey.reset();
    global.PlaceKey = PlaceKey;
    delete require.cache[require.resolve("../max-data.mjs")];
    require("../max-data.mjs");
    var MaxData = global.MaxData;
    if (!MaxData || typeof MaxData.canonicalizePlaceActivities !== "function") return false;
    PlaceKey.learn("myvatn natursone baths", "myvatn nature baths");
    var items = [
      { id: "s1", section: "Relax in hot springs", requiredPlaces: [
        { place: "Myvatn Nature Baths", country: "Iceland" } ] },
      { id: "s2", section: "More places to consider", requiredPlaces: [
        { place: "myvatn natursone baths", country: "Iceland" } ] }
    ];
    var out = MaxData.canonicalizePlaceActivities(items);
    var total = 0;
    out.forEach(function (it) { total += (it.requiredPlaces || []).length; });
    // The alias-linked duplicate must collapse to ONE place, kept in
    // the thematic (non-catchall) section.
    var thematic = out.find(function (it) { return it.section === "Relax in hot springs"; });
    return total === 1 && !!thematic && thematic.requiredPlaces.length === 1;
  })());

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
