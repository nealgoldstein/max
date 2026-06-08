// tests/contract-checks.js — PD.333 (architecture audit, June 2026).
//
// Mechanical enforcement of the three architectural rules that the
// audit found behind every recurring bug class. These are SOURCE
// checks (grep-grade, no browser): cheap, deterministic, and wired
// into tests/run.sh so a violation fails the same gate that blocks
// deploys.
//
// Rule 1 — RENDERERS NEVER NAVIGATE.
//   MaxRoute.navigate must not appear inside drawTripMode's body.
//   (drawDestMode retains a single fresh-arrival stamp — asserted to
//   stay guarded.) Renderer URL stamps caused four shipped bugs:
//   refresh-in-Discovery landing on trip view (×3 variants) and
//   background renders yanking the user out of the picker.
//
// Rule 2 — ONE ID, ONE KEY.
//   MaxDB.tripWriteRaw must contain the id/key heal+assert block.
//
// Rule 3 — THE _tb BRIDGE IS BY-REFERENCE.
//   No `.slice()` re-hydration of _tb.candidates / _tb.placeActivities
//   from trip.* in the route dispatcher (the seam that broke PD.303).
//
// Plus: both Discovery surfaces must stamp the discovery route
// (renderActivityPicker AND showCandidateExplorer), and the GC must
// carry its signed-in guard.

"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var indexSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
var dbSrc = fs.readFileSync(path.join(ROOT, "db.js"), "utf8");

var pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); }
}

// Extract a top-level function body by brace counting from its
// declaration. Good enough for the inline script's style.
function fnBody(src, declRe) {
  var m = declRe.exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index);
  if (i === -1) return null;
  var depth = 0, start = i;
  for (; i < src.length; i++) {
    var c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

console.log("contract-checks — architectural rules (PD.333)\n");

// ── Rule 1: renderers never navigate ──────────────────────────────
var dtm = fnBody(indexSrc, /function drawTripMode\s*\(/);
check("Rule 1a: drawTripMode exists", !!dtm);
check("Rule 1b: drawTripMode contains NO MaxRoute.navigate",
  dtm !== null && dtm.indexOf("MaxRoute.navigate") === -1,
  "a renderer is writing the URL again");

var ddm = fnBody(indexSrc, /function drawDestMode\s*\(/);
check("Rule 1c: drawDestMode exists", !!ddm);
check("Rule 1d: drawDestMode's stamp is fresh-arrival-guarded",
  ddm !== null && (ddm.indexOf("MaxRoute.navigate") === -1 ||
    (ddm.indexOf("_navFreshArrival") !== -1 && ddm.indexOf("noUrlStamp") !== -1)),
  "the dest stamp lost its arrival/repaint guard");

// ── Rule 2: one id, one key ────────────────────────────────────────
check("Rule 2: MaxDB.tripWriteRaw asserts envelope id == storage key",
  /ID\/KEY MISMATCH/.test(dbSrc) && /healed to storage key/.test(dbSrc),
  "the id/key assert block was removed from db.js");

// ── Rule 3: by-reference _tb bridge in the dispatcher ──────────────
var dispatch = fnBody(indexSrc, /function _dispatchRoute\s*\(/);
check("Rule 3a: _dispatchRoute exists", !!dispatch);
check("Rule 3b: dispatcher hydration takes NO .slice() copies of the bridge arrays",
  dispatch !== null &&
    !/_tb\.candidates\s*=\s*trip\.candidates\.slice/.test(dispatch) &&
    !/_tb\.placeActivities\s*=\s*trip\.placeActivities\.slice/.test(dispatch),
  ".slice() re-hydration severs the PD.303 invariant");

// ── Both Discovery surfaces are routed ─────────────────────────────
var rap = fnBody(indexSrc, /function renderActivityPicker\s*\(/);
check("Discovery 1: renderActivityPicker stamps the discovery route",
  rap !== null && rap.indexOf("SCREENS.DISCOVERY") !== -1);
var sce = fnBody(indexSrc, /function showCandidateExplorer\s*\(/);
check("Discovery 2: showCandidateExplorer stamps the discovery route",
  sce !== null && sce.indexOf("SCREENS.DISCOVERY") !== -1,
  "the second Discovery surface went unrouted again");
check("Discovery 3: the dispatcher can restore the candidate explorer",
  dispatch !== null && dispatch.indexOf("reopenCandidateExplorer") !== -1);

// ── Rule 4: construct-then-decorate (PD.337) ───────────────────────
// User-listed places are CONSTRUCTED into the picker data before any
// LLM call; LLM output merges around them and can only decorate.
check("Rule 4a: _constructUserListedItems exists",
  /function _constructUserListedItems\s*\(/.test(indexSrc));
var pasteFlow = fnBody(indexSrc, /async function _buildPickerFromPastedList\s*\(/);
check("Rule 4b: the paste flow constructs BEFORE the LLM build",
  pasteFlow !== null && pasteFlow.indexOf("_constructUserListedItems()") !== -1
    && pasteFlow.indexOf("_constructUserListedItems()") < pasteFlow.indexOf("MaxBuild.findCandidates"),
  "construction must precede the LLM orchestrator call");
// (Whole-source check: brace-counting can't reliably extract
// _generateActivitiesForPlaceImpl — its prompt strings contain
// braces — so assert the merge markers exist in the file.)
check("Rule 4c: LLM output MERGES around constructed items (never replaces)",
  indexSrc.indexOf("_constructed.concat(items)") !== -1
    && /_tb\.placeActivities\s*=\s*items;/.test(indexSrc),
  "the merge that preserves user-constructed items was removed");

// ── Rule 5: canonical place-set invariant (PD.349) ─────────────────
// One dedupe owner; enforced at the render chokepoint every path
// crosses. Re-running any pass can never grow the Discovery set.
var maxDataSrc = fs.readFileSync(path.join(ROOT, "max-data.js"), "utf8");
// PD.401g: the Discovery placement adapter was extracted out of index.html
// into discovery-adapter.js. Checks that used to grep the inline code now
// read it here. `placementSrc` is "wherever the adapter lives" so the
// rules don't care which file holds it.
var adapterSrc = fs.existsSync(path.join(ROOT, "discovery-adapter.js"))
  ? fs.readFileSync(path.join(ROOT, "discovery-adapter.js"), "utf8") : "";
var placementSrc = indexSrc + "\n" + adapterSrc;
check("Rule 5a: MaxData.canonicalizePlaceActivities exists",
  /function canonicalizePlaceActivities\s*\(/.test(maxDataSrc));
var keepsPass = fnBody(indexSrc, /function _reconcileUserListedKeeps\s*\(/);
check("Rule 5b: the render chokepoint enforces canonical form",
  keepsPass !== null && keepsPass.indexOf("canonicalizePlaceActivities") !== -1,
  "_reconcileUserListedKeeps no longer canonicalizes — the ratchet can return");

// ── Rule 6: one array, one door (PD.356, Phase 1+2) ────────────────
// _tb.placeActivities is a routed VIEW of the trip's array; writes go
// through TripStore.setPlaceActivities, which canonicalizes at write
// and treats identical state as a silent no-op (loop-proof). And
// renderers never trigger builds: the picker auto-fire is deleted.
var tripstoreSrc = fs.readFileSync(path.join(ROOT, "tripstore.js"), "utf8");
check("Rule 6a: TripStore.setPlaceActivities canonicalizes at write",
  tripstoreSrc.indexOf("canonicalizePlaceActivities") !== -1,
  "canonical-at-write was removed from the one door");
check("Rule 6b: identical writes are silent no-ops (feedback-loop guard)",
  /PD\.356a/.test(tripstoreSrc) && tripstoreSrc.indexOf("if (_same) return _trip;") !== -1,
  "removing the no-op guard re-opens the tripChange render loop");
check("Rule 6c: _tbInstall routes _tb.placeActivities through the store",
  indexSrc.indexOf("function _tbInstall(tb)") !== -1
    && indexSrc.indexOf("__paRouted") !== -1,
  "the routed-view accessor was removed — _tb is a copy again");
check("Rule 6d: every _tb creation site uses the factory",
  !/window\._tb = _tb = \{\};/.test(indexSrc),
  "a bare `window._tb = _tb = {}` bypasses the accessor");
check("Rule 6e: renderers never trigger builds (auto-fire deleted)",
  indexSrc.indexOf("the auto-fire is DELETED") !== -1
    && fnBody(indexSrc, /function renderActivityPicker\s*\(/) !== null
    && fnBody(indexSrc, /function renderActivityPicker\s*\(/).indexOf("generateActivitiesForPlace();") === -1,
  // (the explicit onclick BUTTON is a user action and is allowed;
  // a bare `generateActivitiesForPlace();` statement is not)
  "a renderer is starting LLM builds again");
check("Rule 6f: the mint snapshots drafts before the source flips",
  indexSrc.indexOf("_paDraft") !== -1 && indexSrc.indexOf("TripStore.setPlaceActivities(_paDraft)") !== -1,
  "post-mint reads of _tb.placeActivities adopt an empty store array");

// ── Rule 7: one place identity (PD.357, Phase 3) ───────────────────
// Place-name matching routes through PlaceKey: the canonicalizer's
// key is alias-aware, the badge/keep resolver learns from fuzzy hits,
// and learned aliases persist on trip.brief._placeAliases.
var placeKeySrc = fs.readFileSync(path.join(ROOT, "place-key.js"), "utf8");
check("Rule 7a: PlaceKey module exists with learn/resolve/same",
  /function learn\(/.test(placeKeySrc) && /function resolve\(/.test(placeKeySrc)
    && /function same\(/.test(placeKeySrc));
check("Rule 7b: MaxData._normKey is alias-aware",
  maxDataSrc.indexOf("PlaceKey.resolve") !== -1,
  "the canonicalizer fell back to bare normalization");
check("Rule 7c: the listed-info resolver LEARNS from fuzzy hits",
  (function () {
    var rli = fnBody(indexSrc, /function _resolveListedInfo\s*\(/);
    return rli !== null && (rli.match(/PlaceKey\.learn\(/g) || []).length >= 3;
  })(),
  "prefix/token/overlap hits no longer teach the alias registry");
check("Rule 7d: learned aliases persist on the brief",
  indexSrc.indexOf("_placeAliases = PlaceKey.serialize()") !== -1
    && indexSrc.indexOf("PlaceKey.hydrate(trip.brief._placeAliases)") !== -1,
  "the persistence bridge (serialize on save / hydrate on load) broke");

// ── Rule 8: the parallel-store debt is paid (PD.358–PD.362) ────────
var syncSrc = fs.readFileSync(path.join(ROOT, "sync.js"), "utf8");
check("Rule 8a: _mdcItems is a routed view, not a store",
  !/var _mdcItems = \[\];/.test(indexSrc)
    && indexSrc.indexOf('Object.defineProperty(window, "_mdcItems"') !== -1,
  "_mdcItems regressed to an independent copy");
check("Rule 8b: pre-mint drafts share ONE buffer (_PA_BUF)",
  indexSrc.indexOf("window._PA_BUF") !== -1,
  "per-object buffers can diverge pre-mint");
check("Rule 8c: the PD.300 write-through is deleted (structurally dead)",
  indexSrc.indexOf("PD.300: write-through") === -1,
  "the four-copies write-through patch came back");
check("Rule 8d: in-place curation persists via explicit touch()",
  /TripStore\.touch\("discovery-curate"\)/.test(indexSrc)
    && /function touch\(name\)/.test(tripstoreSrc),
  "the no-op guard would silently skip same-ref persists");
check("Rule 8e: the paste stash is deleted — trip mints at build start",
  indexSrc.indexOf('localStorage.setItem("max-pending-user-list"') === -1
    && indexSrc.indexOf("minted at build start") !== -1,
  "the localStorage side channel returned");
check("Rule 8f: build milestones run the place-set passes",
  indexSrc.indexOf('_runPlaceSetPasses("build:done")') !== -1
    && indexSrc.indexOf('_runPlaceSetPasses("build:enhance-done")') !== -1,
  "writers no longer reconcile — render is primary again");
check("Rule 8g: sync conflicts ask the user (chooser registered)",
  syncSrc.indexOf("onConflict") !== -1
    && indexSrc.indexOf("MaxSync.onConflict = _chooser") !== -1,
  "conflicts silently force local again");
check("Rule 8h: aliases are correctable (forget + console API)",
  placeKeySrc.indexOf("function forget(") !== -1
    && indexSrc.indexOf("window.MaxAliases") !== -1,
  "a bad learn is permanent again");

// ── Rule 9: one binding to the current trip (PD.369–PD.371) ────────
check("Rule 9a: the trip global is an accessor, not a var",
  !/\nvar trip = \{/.test(indexSrc)
    && indexSrc.indexOf('Object.defineProperty(window, "trip"') !== -1,
  "two bindings to the current trip again — the CTA-staleness class returns");
check("Rule 9b: candidates are a routed view with a no-op write guard",
  indexSrc.indexOf('Object.defineProperty(tb, "candidates"') !== -1
    && /PD\.370: identical writes are silent no-ops/.test(tripstoreSrc),
  "candidates regressed to an independent copy");
check("Rule 9c: publish's fresh stub carries the live arrays across the swap",
  (function () {
    var ep = fs.readFileSync(path.join(ROOT, "engine-picker.js"), "utf8");
    return ep.indexOf("candidates: (_tb && Array.isArray(_tb.candidates))") !== -1
        && ep.indexOf("placeActivities: (_tb && Array.isArray(_tb.placeActivities))") !== -1;
  })(),
  "the store swap voids the routed views mid-publish (flips get lost)");
check("Rule 9d: brief edits ride the curation save",
  indexSrc.indexOf("TripStore.updateBrief(_bDiff)") !== -1,
  "brief fields wait for publish again");

// ── Rule 10: every count is accounted for (PD.372) ─────────────────
check("Rule 10a: the place-set audit exists and runs at build:done",
  indexSrc.indexOf("function _maxPlaceSetAudit") !== -1
    && indexSrc.indexOf("window.MaxAudit") !== -1
    && indexSrc.indexOf("_maxPlaceSetAudit(false);") !== -1,
  "builds no longer end with a reconciled accounting");
check("Rule 10b: the receipt reports your-list coverage (incl. missing)",
  indexSrc.indexOf("you listed") !== -1 && indexSrc.indexOf("_aud.missing") !== -1,
  "the user can't see whether their places survived");

// ── Rule 11: hubs propose, the user commits (PD.378) ───────────────
check("Rule 11a: auto-created hubs arrive UNCHECKED in Recommended",
  indexSrc.indexOf("_keep: !p._autoCreated") !== -1,
  "Max is checking synthesized hubs again");
check("Rule 11b: two stay sections, split by provenance (PD.380)",
  indexSrc.indexOf("window._SEC_STAYS_USER") !== -1
    && indexSrc.indexOf("window._SEC_STAYS_REC") !== -1
    && indexSrc.indexOf("_isStaySection") !== -1,
  "the user/Max stay-section split was removed");
check("Rule 11d: Max never auto-checks its own suggestions",
  indexSrc.indexOf("MAX NEVER CHECKS ANYTHING") !== -1
    && /item\.checked = false;/.test(indexSrc),
  "iconic auto-check returned — Max is checking places again");
check("Rule 11c: provenance + verdict flags survive the reopen clone",
  indexSrc.indexOf("_autoCreated: (p._autoCreated === true)") !== -1
    && indexSrc.indexOf("_rejected: (p._rejected === true)") !== -1,
  "reopen drops _autoCreated/_rejected — hubs vanish, rejections revert");

// ── Rule 12: the numbers are explained on screen (PD.379) ──────────
check("Rule 12a: the provenance banner renders the full accounting",
  indexSrc.indexOf("on this page: ") !== -1
    && indexSrc.indexOf("Max suggested") !== -1
    && indexSrc.indexOf("overnight hub") !== -1,
  "the user can no longer see where the numbers come from");
check("Rule 12b: slots-vs-places is explained with the doubled places named",
  indexSrc.indexOf("Section counts add up to ") !== -1
    && indexSrc.indexOf("in more than one section") !== -1,
  "section sums exceeding the place count went unexplained again");
check("Rule 12c: uncommitted hubs never enter the considered pool",
  (function () {
    var ep = fs.readFileSync(path.join(ROOT, "engine-picker.js"), "utf8");
    return ep.indexOf("_pd269SkipHubs") !== -1;
  })(),
  "phantom town pins return to the trip view's considered sights");

// ── Rule 13: section identity has one owner (PD.381) ───────────────
check("Rule 13a: SectionKind module exists with the predicates",
  (function () {
    var sk = fs.readFileSync(path.join(ROOT, "section-kind.js"), "utf8");
    return /function isStay\(/.test(sk) && /function isCatchall\(/.test(sk)
      && /function catchallRank\(/.test(sk) && /function isSynthetic\(/.test(sk);
  })());
check("Rule 13b: index routes section identity through SectionKind",
  indexSrc.indexOf("SectionKind.isStay") !== -1
    && indexSrc.indexOf("SectionKind.isSynthetic") !== -1,
  "the inline string-matching for section kind came back");
check("Rule 13c: the canonicalizer takes its precedence from SectionKind",
  maxDataSrc.indexOf("_SK.catchallPrecedence()") !== -1
    && maxDataSrc.indexOf("_SK.isCommittedStay") !== -1,
  "max-data forked its own section-kind logic again");

// ── Rule 14: provenance is a stored field (PD.382) ─────────────────
check("Rule 14a: _placeOrigin + _defaultKeepForOrigin exist",
  indexSrc.indexOf("window._placeOrigin") !== -1
    && indexSrc.indexOf("window._defaultKeepForOrigin") !== -1,
  "provenance went back to being inferred everywhere");
check("Rule 14b: origin is tagged at the creation sites",
  (indexSrc.match(/_origin:/g) || []).length >= 5,
  "places are created without a provenance tag");
check("Rule 14c: origin survives the reopen clone",
  indexSrc.indexOf('_origin: (p._origin === "user"') !== -1,
  "reopen drops _origin — provenance is lost on every edit cycle");
check("Rule 14d: the audit derives provenance from the stored field",
  indexSrc.indexOf("window._placeOrigin(p)") !== -1
    && /_og === "max-hub"/.test(indexSrc),
  "the audit re-infers provenance instead of reading it");

// ── Rule 15: headliner marks, never checks (PD.383) ────────────────
check("Rule 15a: headliner = iconic AND matches-intent (not raw iconic)",
  /item\._headliner = !!item\.iconic && _itemMatchesIntent\(item\)/.test(indexSrc),
  "the headliner marker fell back to the noisy raw-iconic flag");
check("Rule 15b: the headliner marker never sets a check/_keep",
  (function () {
    var fn = fnBody(indexSrc, /function _pmHeadlinerBadgeHtml\s*\(/);
    return fn !== null && fn.indexOf("_keep") === -1 && fn.indexOf("checked") === -1;
  })(),
  "the headliner marker is mutating check-state");
check("Rule 15c: headliner survives the reopen clone",
  indexSrc.indexOf("_headliner: (m._headliner === true)") !== -1,
  "the headliner flag is dropped on reopen and the marker vanishes");

// ── Rule 16: the user's role is the contract (PD.384) ──────────────
check("Rule 16a: a listed SIGHT is excluded from stays before any signal",
  (function () {
    var fn = fnBody(indexSrc, /function _ensureSyntheticStaysSection\s*\(/) ||
             // it's an IIFE; fall back to a source-marker check
             indexSrc;
    return indexSrc.indexOf('if (listed[k] === "see") return false;') !== -1
      && indexSrc.indexOf("THE USER'S STATED ROLE IS THE CONTRACT") !== -1;
  })(),
  "an inferred overnight flag can override the user's stated sight role again");
check("Rule 16b: the rec-stays harvest also excludes user sights",
  indexSrc.indexOf('if (listed[k] === "see") return;') !== -1,
  "a user sight can be dragged into Recommended overnight stays");
check("Rule 16c: stay sections are pinned — user first, recommended second",
  indexSrc.indexOf("ORDER IS GUARANTEED") !== -1
    && /_tb\.placeActivities\.unshift\(_recItem2\)/.test(indexSrc)
    && /_tb\.placeActivities\.unshift\(_userItem\)/.test(indexSrc),
  "the stay-section order is no longer guaranteed");
check("Rule 16d: headliner intent includes the user's selected interests",
  indexSrc.indexOf("PD.383b") !== -1
    && /_tb\.interests.*join/.test(indexSrc),
  "headliners ignore selected interests again — paste-flow shows none");

// ── Rule 17: catchall dedupe uses real identity (PD.385) ───────────
check("Rule 17a: the canonicalizer dedupes themed places by the one identity",
  // PD.401k: themed dedupe is now EXACT on `_key` (themedKeys[p._key]),
  // because interning already merged naming variants/coordinate-dups to
  // one key. The behavioral guard lives in canonical-placeset-tests
  // (variant collapses into the theme).
  maxDataSrc.indexOf("themedKeys[p._key]") !== -1
    && maxDataSrc.indexOf("function _isThemed") !== -1,
  "the dedupe owner lost its themed-place matcher — naming variants duplicate");
check("Rule 17b: containment dedupe is COORDINATE-gated (no over-deletion)",
  // PD.401k: the coordinate gate now lives in the ONE identity
  // (MaxDiscovery.sameEntity), which the canon interns through. The
  // behavioral guard is canonical-placeset-tests' "distinct place inside
  // a destination is NOT deleted"; here we pin that the canon interns via
  // sameEntity rather than a forked name-only matcher.
  maxDataSrc.indexOf("function _internKey") !== -1
    && maxDataSrc.indexOf("_sameEntity ? _sameEntity(e, cand)") !== -1,
  "the canon stopped interning via the one coordinate-aware identity — over-deletion can return");

// ── Rule 18: one Considered count across views (PD.386) ────────────
check("Rule 18a: the audit computes a considered PREVIEW excluding destinations",
  indexSrc.indexOf("out.considered = 0") !== -1
    && indexSrc.indexOf("_destKeys[k]) return") !== -1,
  "the considered preview no longer excludes destinations — it won't match the trip pill");
check("Rule 18b: the receipt shows the considered bridge number",
  indexSrc.indexOf("will appear as <strong>Considered</strong> sights") !== -1,
  "the discovery receipt no longer previews the trip's Considered count");

// ── Rule 19: considered is ONE derivation (PD.387/388) ─────────────
check("Rule 19a: the considered set is derived from placeActivities (single owner)",
  maxDataSrc.indexOf("function consideredPlaceKeys") !== -1
    && /getConsideredSights[\s\S]*consideredPlaceKeys\(trip\)/.test(maxDataSrc),
  "getConsideredSights forked its own derivation again");
check("Rule 19b: the count IS the set size — no parallel tally",
  /countConsideredSights[\s\S]*Object\.keys\(consideredPlaceKeys\(trip\)\)\.length/.test(maxDataSrc),
  "countConsideredSights re-counts independently — it can drift");
check("Rule 19c: the discovery preview calls the same owner",
  indexSrc.indexOf("MaxData.countConsideredSights(_audTripC)") !== -1,
  "the discovery preview re-derives considered instead of calling the owner");
check("Rule 19d: committed sights render on the overview (green teardrops)",
  maxDataSrc.indexOf("function getCommittedSights") !== -1
    && indexSrc.indexOf("_renderCommittedSightPins") !== -1,
  "committed sights are invisible on the trip overview again");

// ── Rule 20: TOC ordering routes through SectionKind (PD.389) ──────
check("Rule 20a: _pinSyntheticStaysFirst pins all THREE stay sections via SectionKind",
  indexSrc.indexOf("SK.NAMES.STAYS_USER : \"Overnight stays\"") !== -1
    && indexSrc.indexOf("if (user)  head.push(user)") !== -1,
  "the stays-first pin still uses old names — 'Overnight stays' won't be first");
check("Rule 20b: the section-rank pins user stays (0) above Max stays (0.4)",
  indexSrc.indexOf("name === SK.NAMES.STAYS_USER)     return 0") !== -1,
  "the rank no longer orders user stays before Max stays");
check("Rule 20c: the stay/sight signal collector skips BOTH stay sections",
  indexSrc.indexOf("skip BOTH stay sections (user + Max)") !== -1,
  "the rename left the signal collector scanning the user stays section");
// (Rule 20d retired: PD.390's raw per-section count was superseded by
//  PD.391 — the receipt reads the single considered owner, see Rule 21.)

// ── Rule 21: the receipt reads the ONE considered owner (PD.391) ───
check("Rule 21a: the receipt has NO bespoke counting loop",
  indexSrc.indexOf("ONE OWNER. The receipt no longer has") !== -1
    && indexSrc.indexOf("MaxData.consideredPlaceKeys(_rcTrip2)") !== -1,
  "the receipt re-derives the considered count — it can drift again (the '104' bug)");
check("Rule 21b: the create-phase banner says 'determining your route'",
  indexSrc.indexOf("Max is determining your route") !== -1,
  "the create banner copy regressed");

// ── Rule 22: stay split is provenance-driven (PD.393) ──────────────
check("Rule 22a: the stay partition uses _origin, not just name-hydration",
  indexSrc.indexOf("PARTITION BY PROVENANCE, not by name-hydration") !== -1
    && indexSrc.indexOf("function _isUserStayPlace") !== -1,
  "the user/Max stay split depends on _userListedNames again — a hydration miss merges them");

// ── Rule 23: build banner copy is mode-driven (PD.394) ─────────────
check("Rule 23a: MaxBuild exposes the build mode",
  (function () {
    var eb = fs.readFileSync(path.join(ROOT, "engine-build.js"), "utf8");
    return /function mode\(\)/.test(eb) && /mode:\s*mode,/.test(eb);
  })());
check("Rule 23b: recontext maps activity-first → 'looking for other places'",
  indexSrc.indexOf("Max is looking for other places that you might want to consider") !== -1
    && indexSrc.indexOf('_bmode === "activity-first"') !== -1,
  "the after-upload banner copy regressed");
check("Rule 23c: recontext maps candidate-first → 'determining your route'",
  indexSrc.indexOf('_bmode === "candidate-first"') !== -1
    && indexSrc.indexOf("Max is determining your route") !== -1,
  "the Discovery→trip banner copy regressed");

// ── Rule 24: catchall chip == receipt (one owner) (PD.395) ─────────
check("Rule 24a: MaxData.consideredBySection groups the single set",
  maxDataSrc.indexOf("function consideredBySection") !== -1,
  "the per-section considered count owner is missing");
// ── Rule 25: the catchall invariant (PD.396) ───────────────────────
// The two "to consider" catchalls hold ONLY unchecked sights. A checked
// sight is a DECISION — it leaves to-consider and commits. This makes
// chip == rows == unchecked == considered == receipt with NO per-surface
// special-casing: the data itself is coherent.
check("Rule 25a: the catchall invariant is the model's derivation, not a pass (PD.401d)",
  // The imperative _ensureCatchallsUnchecked pass is DELETED. A checked
  // sight leaving "to consider" for "Sights you're keeping" is now a pure
  // consequence of PlacementPolicy.sectionFor — there is no pass to run.
  indexSrc.indexOf("function _ensureCatchallsUnchecked") === -1
    && (function () {
      var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
      return dm.indexOf("SECTION.KEEPING") !== -1 && /sectionFor\s*:\s*function/.test(dm);
    })(),
  "the deleted catchall pass came back, or the model stopped deriving 'keeping'");
check("Rule 25b: the DiscoveryModel owns final placement at the chokepoint (PD.401)",
  (function () {
    // The catchall invariant is now SUBSUMED by the model: the reconcile
    // chokepoint ends by handing every sight to DiscoveryModel, which
    // RE-DERIVES each section from one pure policy. A checked sight can no
    // longer sit in a catchall because its section is a function of its
    // decision — not the residue of a mutation pass.
    var fn = fnBody(indexSrc, /function _reconcileUserListedKeeps\s*\(/);
    return fn !== null && fn.indexOf("_applyDiscoveryModelToSights()") !== -1
      && placementSrc.indexOf("function _applyDiscoveryModelToSights") !== -1;
  })(),
  "the model isn't the final placement authority on every render");
check("Rule 25c: the section chip reads the model count, not a bespoke hack (PD.401i)",
  (function () {
    // Formerly asserted the chip showed `destOrder.length` directly. The
    // chip now reads `_pmModelSectionCount(sec)` — the SAME model count
    // the TOC and the banner read — which equals the rendered rows by
    // construction. What it must NOT do is re-acquire a special-case
    // counter (e.g. reading consideredBySection only for catchalls).
    var fn = fnBody(indexSrc, /function _renderPlaceActivityItems\s*\(/);
    return fn !== null && fn.indexOf("_pmModelSectionCount(sec)") !== -1
      && fn.indexOf("consideredBySection") === -1;
  })(),
  "the chip re-acquired a special-case count instead of the one model source");

// ── Rule 26: ONE identity matcher (PD.397) ─────────────────────────
check("Rule 26a: PlaceKey owns contains + relatedTo",
  (function () {
    var pk = fs.readFileSync(path.join(ROOT, "place-key.js"), "utf8");
    return /function contains\(/.test(pk) && /function relatedTo\(/.test(pk);
  })());
check("Rule 26b: the canon delegates its matcher to the ONE identity (PD.401k)",
  // Was PlaceKey.relatedTo; the canon now interns through
  // MaxDiscovery.sameEntity — the single identity the model uses — so
  // there is exactly one matcher, not a forked containment one.
  maxDataSrc.indexOf("_sameEntity ? _sameEntity(e, cand)") !== -1
    && maxDataSrc.indexOf("function _isAlreadyThemed") === -1,
  "the canon forked its own containment matcher again instead of the one identity");
check("Rule 26c: the coverage audit uses relatedTo (Þingvellir not falsely missing)",
  indexSrc.indexOf("PlaceKey.relatedTo(lk, allKeys[i])") !== -1,
  "the coverage check reverted to PlaceKey.same — one-word listed places report missing");
check("Rule 26d: the model ingestion excludes dests/hubs (no catchall padding)",
  (function () {
    // Formerly enforced by _ensureCatchallsUnchecked (deleted PD.401d).
    // Now fromPlaceActivities skips hubs and destinations at ingestion,
    // so they can never become catchall rows in the first place.
    var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
    return /if\s*\(\s*isHub\(p\)\s*\)\s*return/.test(dm)
      && /if\s*\(\s*isDestination\(p\)\s*\)\s*return/.test(dm);
  })(),
  "destinations/hubs can pad a catchall and break chip==receipt");
check("Rule 26e: route-umbrella detection is folded into the model (PD.401e)",
  (function () {
    // The _routeUmbrellasToScenicRoutes pre-pass is DELETED. The model
    // now owns the decision (isRouteUmbrella → SECTION.SCENIC) and the
    // adapter merges it into the route container.
    var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
    return indexSrc.indexOf("function _routeUmbrellasToScenicRoutes") === -1
      && /function isRouteUmbrella\(/.test(dm)
      && dm.indexOf("SCENIC") !== -1
      && placementSrc.indexOf("S.SCENIC") !== -1;
  })(),
  "Golden/Diamond Circle fall back to From-your-list / the pre-pass came back");

// ── Rule 31: ONE identity, stamped once at the write door (PD.401k) ─
// The canonicalizer stamps a coordinate-canonical `_key` on every place;
// the model and the renderer read it (via _pmKey) instead of recomputing
// `place.toLowerCase()`. Identity is established once; readers group by
// it. (The Leaflet marker subsystem's internal keying is a documented
// holdout — non-divergent, and coupled to inline-generated scripts.)
check("Rule 31a: the write door stamps a coordinate-canonical _key",
  maxDataSrc.indexOf("function _internKey") !== -1
    && maxDataSrc.indexOf("p._key = _internKey(p)") !== -1
    && maxDataSrc.indexOf("_MD.sameEntity") !== -1,
  "identity isn't interned at the write door — readers will recompute and drift");
check("Rule 31b: the one identity accessor exists and the model reads _key",
  indexSrc.indexOf("window._pmKey = function") !== -1
    && (function () {
      var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
      return dm.indexOf("raw._key || _norm(raw.place)") !== -1;
    })(),
  "the single identity accessor is missing or the model recomputes identity");
check("Rule 31c: the picker groupings dedup by the one identity, not toLowerCase",
  (function () {
    var fn = fnBody(indexSrc, /function _renderPlaceActivityItems\s*\(/);
    if (fn === null) return false;
    // byDest, byPlace, and the place-TOC must all key via _pmKey.
    var hits = (fn.match(/window\._pmKey\(/g) || []).length;
    return hits >= 3 && fn.indexOf("var key = p.place.toLowerCase()") === -1;
  })(),
  "a picker grouping still keys by place.toLowerCase() instead of the one identity");
check("Rule 31d: the picker-map markers are keyed by the one identity (PD.401k)",
  // The marker dictionary's allPlaces build and the primary marker lookup
  // both key via _pmKey; the fuzzy fallback is retained intentionally for
  // bare-name lookups (documented), so it is NOT required to be removed.
  indexSrc.indexOf("var key = window._pmKey(p);                      // PD.401k: one identity") !== -1
    && indexSrc.indexOf("var keyLower = window._pmKey(placeName);") !== -1,
  "the picker-map markers reverted to raw place.toLowerCase() keying");

// ── Rule 30: ONE displayed section-count source (PD.401i) ──────────
// The TOC and the section headers must read the model's per-section count
// (_pmModelSectionCount), not each re-dedup placeActivities with its own
// lowercase key. Three copies of "count a section" are three chances to
// drift; there is now one source.
check("Rule 30a: the adapter stashes the model's per-section counts",
  adapterSrc.indexOf("window._discoverySectionCounts") !== -1
    && /function _pmModelSectionCount\s*\(/.test(adapterSrc),
  "the single section-count source is missing");
check("Rule 30b: the TOC and the section header read _pmModelSectionCount",
  (function () {
    var fn = fnBody(indexSrc, /function _renderPlaceActivityItems\s*\(/);
    if (fn === null) return false;
    // Both the TOC count and the header count must consult the model
    // source; at least two call sites inside the renderer.
    var hits = (fn.match(/_pmModelSectionCount\(/g) || []).length;
    return hits >= 2;
  })(),
  "a section-count display still re-derives its own count instead of the model's");

// ── Rule 29: the render applies the model every paint (PD.401h) ────
// The chip-vs-banner divergence (38+9 rendered, banner said 51) came
// from the section renderer trusting `_placeSetClean` to skip re-deriving
// placement — a discipline flag a writer could leave stale. The renderer
// must apply the model UNCONDITIONALLY before grouping, so the painted
// section chips == the model == the banner == the pill, with no flag to
// get wrong.
check("Rule 29a: _renderPlaceActivityItems applies the model before grouping",
  (function () {
    var fn = fnBody(indexSrc, /function _renderPlaceActivityItems\s*\(/);
    if (fn === null) return false;
    var applyAt = fn.indexOf("_applyDiscoveryModelToSights()");
    var groupAt = fn.indexOf("var bySection");
    return applyAt !== -1 && groupAt !== -1 && applyAt < groupAt;
  })(),
  "the renderer groups sections without first applying the model — chips can drift from the banner");
check("Rule 29b: the model apply is NOT gated by _placeSetClean",
  (function () {
    var fn = fnBody(indexSrc, /function _renderPlaceActivityItems\s*\(/);
    if (fn === null) return false;
    // The apply call must not sit inside an `if (window._placeSetClean...`
    // block. Cheap proxy: the apply appears before the _placeSetClean gate.
    var applyAt = fn.indexOf("_applyDiscoveryModelToSights()");
    var gateAt = fn.indexOf("_placeSetClean !== true");
    return applyAt !== -1 && (gateAt === -1 || applyAt < gateAt);
  })(),
  "the model apply got gated behind the discipline flag again");

// ── Rule 28: no third-party CDN for Leaflet (PD.401f) ──────────────
// Leaflet is vendored locally (vendor/leaflet/). A CDN <script>/<link>
// is a runtime supply-chain + uptime dependency AND makes the map tests
// non-deterministic (they fail when the network is blocked). This rule
// keeps both the top-of-file load and the dynamically-built map HTML on
// the vendored copy.
check("Rule 28a: Leaflet is vendored, not loaded from a CDN",
  indexSrc.indexOf("cdnjs.cloudflare.com/ajax/libs/leaflet") === -1
    && indexSrc.indexOf("unpkg.com/leaflet") === -1
    && indexSrc.indexOf("vendor/leaflet/leaflet.js") !== -1,
  "a Leaflet CDN reference returned — vendor it under vendor/leaflet/ instead");
check("Rule 28b: the vendored Leaflet files exist",
  fs.existsSync(path.join(ROOT, "vendor/leaflet/leaflet.js"))
    && fs.existsSync(path.join(ROOT, "vendor/leaflet/leaflet.css")),
  "vendor/leaflet/ is missing its files");

// ── Rule 27: ONE considered derivation (PD.401c) ───────────────────
// The whole "two owners" bug class — banner 63 vs chips 56, discovery
// preview vs trip pill — comes from "what's considered and where" being
// computed in more than one place with more than one dedup. These rules
// pin the single owner: ONE ingestion (DiscoveryModel.fromPlaceActivities)
// that the render, the receipt banner, and MaxData's count surfaces all
// build through.
check("Rule 27a: DiscoveryModel owns the one ingestion (fromPlaceActivities)",
  (function () {
    var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
    return /DiscoveryModel\.fromPlaceActivities\s*=/.test(dm)
      && /consideredKeyedSet\s*=\s*function/.test(dm);
  })(),
  "the single ingestion/derivation owner is missing");
check("Rule 27b: MaxData.consideredPlaceKeys DELEGATES to the model",
  maxDataSrc.indexOf("MD.DiscoveryModel.fromPlaceActivities") !== -1
    && maxDataSrc.indexOf("model.consideredKeyedSet()") !== -1,
  "the trip pill/audit/count forked their own considered derivation again");
check("Rule 27e: MaxData.getCommittedSights DELEGATES to the model (PD.401j)",
  (function () {
    var fn = fnBody(maxDataSrc, /function getCommittedSights\s*\(/);
    return fn !== null && fn.indexOf("model.committed()") !== -1
      && fn.indexOf("DiscoveryModel.fromPlaceActivities") !== -1;
  })(),
  "the committed (green-pin) set forked its own derivation instead of the model's");
check("Rule 27c: the render adapter uses the SAME ingestion",
  placementSrc.indexOf("MaxDiscovery.DiscoveryModel.fromPlaceActivities") !== -1,
  "the picker placement re-implemented its own ingestion");
check("Rule 27d: the receipt banner reads the model count, not a forked loop",
  indexSrc.indexOf("_discoveryConsideredCounts()") !== -1
    && placementSrc.indexOf("function _discoveryConsideredCounts") !== -1,
  "the banner re-acquired its own count derivation (63-vs-56 returns)");

// ── GC safety ──────────────────────────────────────────────────────
var gc = fnBody(indexSrc, /function cleanupOrphanedTrips\s*\(/);
check("GC 1: cleanup protects the URL-referenced trip",
  gc !== null && gc.indexOf("_routeTripId") !== -1);
check("GC 2: cleanup is non-destructive for signed-in users",
  gc !== null && gc.indexOf("_gcSignedIn") !== -1);
check("GC 3: empty-shell reaping has an age floor",
  gc !== null && gc.indexOf("EMPTY_SHELL_MIN_AGE_MS") !== -1);

// ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
