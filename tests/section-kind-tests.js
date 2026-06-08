// tests/section-kind-tests.js — PD.381: section identity in one place.

"use strict";

var SK = require("../section-kind.js");

var pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); }
}

console.log("section-kind-tests — PD.381\n");

// ── canonical names ──────────────────────────────────────────────────
t("exposes the six canonical section names",
  SK.NAMES.STAYS_USER === "Overnight stays"
    && SK.NAMES.STAYS_REC === "Recommended overnight stays"
    && SK.NAMES.STAYS_CONSIDER === "Overnight stays to consider"
    && SK.NAMES.SIGHTS_NEAR === "Sights near places you listed"
    && SK.NAMES.FROM_LIST === "From your list"
    && SK.NAMES.MORE === "More places to consider");

// ── stay predicates ──────────────────────────────────────────────────
t("isStay: all three stay sections",
  SK.isStay(SK.NAMES.STAYS_USER) && SK.isStay(SK.NAMES.STAYS_REC) && SK.isStay(SK.NAMES.STAYS_CONSIDER));
t("isStay: a theme section is not a stay section",
  !SK.isStay("Chase waterfalls") && !SK.isStay(SK.NAMES.MORE));
t("isCommittedStay: user + recommended, NOT 'to consider'",
  SK.isCommittedStay(SK.NAMES.STAYS_USER) && SK.isCommittedStay(SK.NAMES.STAYS_REC)
    && !SK.isCommittedStay(SK.NAMES.STAYS_CONSIDER));
t("isStayConsider: only 'to consider'",
  SK.isStayConsider(SK.NAMES.STAYS_CONSIDER) && !SK.isStayConsider(SK.NAMES.STAYS_USER));

// ── catchall precedence ──────────────────────────────────────────────
t("isCatchall: the three catchalls, nothing else",
  SK.isCatchall(SK.NAMES.FROM_LIST) && SK.isCatchall(SK.NAMES.SIGHTS_NEAR) && SK.isCatchall(SK.NAMES.MORE)
    && !SK.isCatchall(SK.NAMES.STAYS_USER) && !SK.isCatchall("Chase waterfalls"));
t("catchallRank: From-your-list (1) beats Sights-near (2) beats More (3)",
  SK.catchallRank(SK.NAMES.FROM_LIST) === 1
    && SK.catchallRank(SK.NAMES.SIGHTS_NEAR) === 2
    && SK.catchallRank(SK.NAMES.MORE) === 3);
t("catchallRank: 0 for non-catchall",
  SK.catchallRank("Chase waterfalls") === 0 && SK.catchallRank(SK.NAMES.STAYS_USER) === 0);
t("catchallPrecedence: ordered, and a copy (not the live array)",
  (function () {
    var a = SK.catchallPrecedence();
    a.push("mutate");
    return SK.catchallPrecedence().length === 3
      && SK.catchallPrecedence()[0] === SK.NAMES.FROM_LIST;
  })());

// ── synthetic (Max-managed structural) set ───────────────────────────
t("isSynthetic: stays + catchalls are structural",
  SK.isSynthetic(SK.NAMES.STAYS_USER) && SK.isSynthetic(SK.NAMES.STAYS_REC)
    && SK.isSynthetic(SK.NAMES.MORE) && SK.isSynthetic(SK.NAMES.SIGHTS_NEAR));
t("isSynthetic: an LLM theme section is NOT structural",
  !SK.isSynthetic("Chase waterfalls") && !SK.isSynthetic("Explore Reykjavik"));

// ── integration: max-data canonicalizer uses SectionKind precedence ──
t("canonicalizer routes a catchall dupe to the best-precedence bucket",
  (function () {
    global.SectionKind = SK;
    delete require.cache[require.resolve("../max-data.js")];
    require("../max-data.js");
    var MaxData = global.MaxData;
    if (!MaxData || typeof MaxData.canonicalizePlaceActivities !== "function") return false;
    // Same place in two catchalls → must survive only in the
    // better-precedence one ("From your list" beats "More places…").
    var items = [
      { id: "a", section: "More places to consider",
        requiredPlaces: [{ place: "Dettifoss", country: "Iceland" }] },
      { id: "b", section: "From your list",
        requiredPlaces: [{ place: "Dettifoss", country: "Iceland" }] }
    ];
    var out = MaxData.canonicalizePlaceActivities(items);
    var fromList = out.find(function (it) { return it.section === "From your list"; });
    var more = out.find(function (it) { return it.section === "More places to consider"; });
    var inFromList = fromList && fromList.requiredPlaces.some(function (p) { return p.place === "Dettifoss"; });
    var inMore = more && more.requiredPlaces.some(function (p) { return p.place === "Dettifoss"; });
    return inFromList === true && !inMore;
  })());

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
