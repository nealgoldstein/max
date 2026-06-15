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
// PD.449–456: functions are being lifted out of the index.html monolith
// into sibling modules (bloat reduction). The architecture greps below
// care that a function EXISTS and keeps a property — not which file holds
// it — so fold the extracted modules into the same haystack. File-specific
// checks (db.js, sync.js, …) still read their own files separately.
["util-esc.js", "apikey.js", "features-conversation.js", "features-trip.js", "trip-edit.js",
 "trip-detail-render.js", "exec-mode.js", "logistics.js", "home-screen.js",
 "trip-affordance.js", "geography-model.js", "who-avoidances.js", "edit-constraints.js",
 "map-pin-panel.js", "itinerary-ordering.js", "discovery-curation.js",
 "entry-point-map.js", "picker-hero-sidebar.js", "construct-decorate.js",
 "pm-doclink-dest.js", "pm-clip-share.js", "pm-docs-editor.js", "pm-docs-core.js", "pm-richtext.js", "menubar-phase.js", "paste-browse-modal.js"
].forEach(function (f) {
  var p = path.join(ROOT, f);
  if (fs.existsSync(p)) indexSrc += "\n" + fs.readFileSync(p, "utf8");
});
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

// PD.453: the destination-mode renderer was extracted out of index.html
// into trip-detail-render.js (bloat reduction). Same precedent as the
// discovery-adapter extraction below — point the grep at the module that
// now owns drawDestMode, falling back to the inline source if absent.
var renderSrc = fs.existsSync(path.join(ROOT, "trip-detail-render.js"))
  ? fs.readFileSync(path.join(ROOT, "trip-detail-render.js"), "utf8") : indexSrc;
var ddm = fnBody(renderSrc, /function drawDestMode\s*\(/);
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
  // PD.434: coverage moved from the compact strip into the narrative — it states
  // your list ("Your list had …"), computes a genuine drop from the PlaceSet
  // (_pmiss), and surfaces it ("… here yet").
  indexSrc.indexOf("Your list had") !== -1 && indexSrc.indexOf("_pmiss") !== -1
    && indexSrc.indexOf("here yet") !== -1,
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
check("Rule 12a: the ONE narrative banner renders the full accounting (PD.434)",
  // The stacked coverage/breakdown/slots banners were collapsed into ONE
  // narrative computed from ONE accounting: your list (taught as destinations
  // vs sights), Max's suggestions split by KIND, and the page total — so the
  // numbers reconcile and the user learns the vocabulary.
  indexSrc.indexOf("what we call <em>destinations</em>") !== -1
    && indexSrc.indexOf("what we call <em>sights</em>") !== -1
    && indexSrc.indexOf("It came back with ") !== -1
    && indexSrc.indexOf(" more destination") !== -1 && indexSrc.indexOf(" more sight") !== -1,
  "the user can no longer see where the numbers come from");
check("Rule 12b: the narrative explains that a sight can sit in several categories (PD.434)",
  // A place can be a slot in multiple categories (themes), so the section
  // chips can sum to more than the unique place total — the banner says so.
  indexSrc.indexOf("Some sights fit into multiple categories") !== -1
    && indexSrc.indexOf("Max has sorted the ") !== -1,
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
check("Rule 14d: the audit derives provenance from the stored field (via the repo)",
  // PD.401M: the audit's provenance now comes from the place repository,
  // whose `originOf` reads window._placeOrigin (the stored _origin field).
  // Hubs are origin "max-hub".
  indexSrc.indexOf("originOf: function(p){ return window._placeOrigin") !== -1
    && indexSrc.indexOf('r.origin === "max-hub"') !== -1,
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
  // PD.401M: the audit's provenance now runs over the place repository;
  // destinations are excluded via the record's kind, not a _destKeys map.
  indexSrc.indexOf("out.considered = 0") !== -1
    && indexSrc.indexOf("if (r.kinds.destination) return") !== -1,
  "the considered preview no longer excludes destinations — it won't match the trip pill");
check("Rule 18b: the discovery banner does NOT show the separate-source 'considered' number (PD.431)",
  // The "N will appear as Considered" bridge came from countConsideredSights —
  // a DIFFERENT derivation than the audit registry, so it didn't reconcile with
  // "Max suggested M sights". The one-accounting banner omits it; "Considered"
  // stays a trip-view concept. (Guard against it being re-added to the banner.)
  indexSrc.indexOf("will appear as <strong>Considered</strong> sights on your trip map") === -1,
  "a count from a non-audit source crept back into the discovery banner");

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
  // sight's placement (its theme, its own single-member category, or the
  // "Unique sights" fallback) is now a pure consequence of
  // PlacementPolicy.sectionFor — there is no pass to run. (PD.405 renamed
  // the fallback constant KEEPING → UNIQUE.)
  indexSrc.indexOf("function _ensureCatchallsUnchecked") === -1
    && (function () {
      var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
      return dm.indexOf("SECTION.UNIQUE") !== -1 && /sectionFor\s*:\s*function/.test(dm);
    })(),
  "the deleted catchall pass came back, or the model stopped deriving the kept-sight fallback");
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
check("Rule 26c: coverage DERIVES from the repository records by origin (PD.429)",
  // PD.429: coverage is no longer a name→find() lookup driven by the parallel
  // _userListedNames map. It iterates the ONE registry's records and treats a
  // record as listed iff origin === "user" (baked by _stampListedOrigin). Two
  // names for one place are ONE interned record → counted once, no merge note.
  // The repo is still the single registry (fromTrip), and the missing-place
  // safety net keeps sameEntity fuzz so a variant name isn't falsely "missing".
  indexSrc.indexOf("PlaceRepository.fromTrip(") !== -1
    && /_allRecs\.forEach\(function\(r\)\{[\s\S]*?r\.origin !== "user"/.test(indexSrc)
    && indexSrc.indexOf("MaxData.deriveListedFromRecords") !== -1
    && (function () {
      var pr = fs.readFileSync(path.join(ROOT, "place-repo.js"), "utf8");
      return /function _related/.test(pr) && pr.indexOf("PK.relatedTo") !== -1;
    })(),
  "coverage no longer derives the listed set from the repository records by origin");
check("Rule 26f: the audit has ONE registry — no byKey second owner (PD.401M)",
  (function () {
    var fn = fnBody(indexSrc, /function _maxPlaceSetAudit\s*\(/);
    if (fn === null) return false;
    // The whole audit (sections, coverage, provenance) derives from the
    // repo; the second `byKey`/`bySec` registry is gone, so the receipt
    // can't show two different totals from two registries.
    return fn.indexOf("var byKey") === -1 && fn.indexOf("var bySec") === -1
      && fn.indexOf("_repo.all()") !== -1
      && fn.indexOf("out.pageTotal") !== -1;
  })(),
  "the audit re-grew a second place registry (byKey) — two totals can diverge again");
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
check("Rule 31j: identity is name-driven — no pure-coordinate merge (PD.401P)",
  (function () {
    var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
    var fn = fnBody(dm, /function sameEntity\s*\(/);
    if (fn === null) return false;
    // sameEntity must NOT merge on coordinates ALONE (the 0.3km branch is
    // gone); coords only confirm a name relation (the 0.6km containment).
    return fn.indexOf("_coordsClose(a.coords, b.coords, 0.3)") === -1
      && fn.indexOf("PK.contains") !== -1;
  })(),
  "identity reverted to merging unrelated names by coordinate — instability + hidden places return");
check("Rule 31h: a name-merge LEARNS the alias (one stable identity, PD.401N)",
  // When two different names merge by a NAME relation, the write door
  // learns the alias once (PlaceKey.learn) so identity becomes stable
  // alias-aware resolution — the listed name is found AND counted once by
  // the SAME rule. Pure coordinate merges are NOT learned.
  maxDataSrc.indexOf("_PKlearn.learn(p.place, e.place)") !== -1
    && maxDataSrc.indexOf("nameRel") !== -1,
  "the write door stopped learning aliases on merge — identity reverts to two heuristics");
check("Rule 31a: the write door stamps a coordinate-canonical _key",
  maxDataSrc.indexOf("function _internKey") !== -1
    && maxDataSrc.indexOf("p._key = _internKey(p, ") !== -1   // PD.438: now carries kind
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
check("Rule 31e: placeMeta is keyed by the one identity, with a migration (PD.401k)",
  indexSrc.indexOf("function _pmMetaKey") !== -1
    && /function _pmMetaKey\([^)]*\)\{[^}]*window\._pmKey/.test(indexSrc.replace(/\n/g, " "))
    && indexSrc.indexOf("function _migratePlaceMetaKeys") !== -1,
  "placeMeta reverted to _normPlaceName keying, or the migration is gone");
check("Rule 31f: the popup map keys via one helper (pk) and map hub-matching normalizes input",
  indexSrc.indexOf("function pk(x){var o=window.opener;") !== -1
    && indexSrc.indexOf("hubKey = window._pmKey(hubKey)") !== -1,
  "the popup map or hub matcher reverted to bare place.toLowerCase()");
check("Rule 31i: the overview map draws one marker per identity (PD.401O)",
  // Destinations, committed, and considered pins share a single seen-set
  // keyed by window._pmKey (alias-aware), so a coordinate/alias duplicate
  // can't paint two overlapping markers.
  indexSrc.indexOf("var _pinSeen = {}") !== -1
    && indexSrc.indexOf("if (_pinSeen[_ck]) return;") !== -1
    && indexSrc.indexOf("if (_pinSeen[_ck2]) return;") !== -1,
  "the overview map can paint two pins for one place again");
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

// ── Rule 30: the orphan-catchall rebuild MERGES, never OVERWRITES ──
// SSOT Stage 5. The user-listed orphan-sights pass found the "Sights near
// places you listed" section BY NAME and did `existingSights.requiredPlaces =
// sightRequiredPlaces` — overwriting it. That section is frequently a
// type:"synthetic-enhance" item carrying ✦ Enhance ("more like this") additions
// and migrated legacy sights that share the label (PD.312). The overwrite
// deleted all of them every render — the 114-place "Sights near" disappearance
// that flipped the considered count 131<->17 on re-entry and made "more like
// this" additions vanish. The rebuild must UNION the orphans into the existing
// section, never replace its requiredPlaces wholesale.
check("Rule 30: orphan-sights rebuild does not overwrite the 'Sights near' section",
  indexSrc.indexOf("existingSights.requiredPlaces = sightRequiredPlaces") === -1,
  "the orphan-catchall rebuild overwrites 'Sights near places you listed' — it deletes Enhance additions + migrated legacy sights every render (the 114-place disappearance)");

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

// ── PD.401W: persistence/sync invariants — the guards that keep a
//    curated list from being silently replaced by an older copy. These
//    are the structural rules behind "my list vanished"; locking them in
//    source means a future edit that removes one fails the deploy gate.
var syncSrc = fs.readFileSync(path.join(ROOT, "sync.js"), "utf8");

check("Sync 1: a server body is pulled ONLY when the server is strictly ahead (rev-gated)",
  // shouldPull must require s.rev > our recorded rev (or no local body),
  // never an unconditional or clock-only pull that could overwrite newer
  // local curation with an older server copy.
  /shouldPull\s*=\s*!hasLocalBody\s*\|\|\s*s\.rev\s*>\s*_getRev\(/.test(syncSrc),
  "the rev-gated pull guard is gone — sync could overwrite newer local curation");

check("Sync 2: a real conflict DEFAULTS to keeping this device's version ('mine')",
  // Without an explicit user chooser, the conflict path must force-keep
  // local ('mine'); only an explicit chooser may adopt 'theirs'. A default
  // of 'theirs' would silently drop local curation on any rev mismatch.
  /var\s+_choice\s*=\s*'mine'/.test(syncSrc)
    && syncSrc.indexOf("_choice === 'theirs'") !== -1
    && syncSrc.indexOf("force: true") !== -1,
  "the conflict default no longer keeps the local version");

check("Sync 3: adopting 'theirs' is gated on a real fetched server body",
  // The take-theirs branch only overwrites local after it actually has the
  // server body (_srvTrip.body), else it keeps yours — so a failed fetch
  // can't blank the trip.
  /_choice === 'theirs'[\s\S]{0,600}_srvTrip && _srvTrip\.body/.test(syncSrc),
  "take-theirs can overwrite local without a confirmed server body");

check("Persist 1: the one write door tripwires a large place-set drop",
  // setPlaceActivities logs loudly if a substantial set is replaced by a
  // near-empty one — the diagnostic net for the elusive curated-list drop.
  tripstoreSrc.indexOf("LARGE place-set drop") !== -1,
  "the place-set-drop tripwire was removed from setPlaceActivities");

check("Theming 1: the theming pass is ON by default (PD.486; '0' is the escape hatch)",
  // #80 shipped behind a default-OFF flag while the persistence trap was
  // open; PD.404/405 closed it and PD.486 flipped the default on. Guard it
  // so the default can't silently revert: _runThemingPass must start on and
  // only disable when the flag is the explicit string "0".
  /_runThemingPass[\s\S]{0,1200}var on = true;[\s\S]{0,300}getItem\("max-theming-pass"\) === "0"/.test(indexSrc),
  "the theming pass default reverted to OFF — listed sights would pile in a catch-all again");

check("Identity 1: kind is intrinsic, and a USER base never merges with a USER sight (PD.438)",
  // Kind is stamped ONCE at the write door (beside _key), and sameEntity reads
  // it intrinsically with an origin-gated veto — so a base you listed and a
  // same-named sight you listed stay distinct everywhere, by construction, while
  // a Max suggestion still folds into your base.
  (function () {
    var dm = fs.readFileSync(path.join(ROOT, "discovery-model.js"), "utf8");
    return dm.indexOf("function _entityKind") !== -1
      && dm.indexOf("_entityIsUser") !== -1
      && maxDataSrc.indexOf("p._kind = _itKind") !== -1;
  })(),
  "the intrinsic kind stamp or the origin-gated kind veto was removed — a base can be absorbed by a sight again");

check("Identity 3: the listed-set PRESENCE invariant lives at the write door (PD.443)",
  // Every listed STAY ends in a stay section and every listed SIGHT on the page —
  // RESTORED at canonicalizePlaceActivities (which runs on every save), identity-
  // aware and idempotent. The scattered pipeline postcondition _assertUserListed-
  // Present is gone; removal (PD.441/442) and restoration (PD.443) are one owner.
  (function () {
    var cd = fs.readFileSync(path.join(ROOT, "construct-decorate.js"), "utf8");
    return maxDataSrc.indexOf("the write door also RESTORES a listed place") !== -1
      && maxDataSrc.indexOf("_presentByIdentity") !== -1
      && cd.indexOf("window._assertUserListedPresent = function") === -1;  // the pass is gone
  })(),
  "the listed-set presence invariant left the write door, or the scattered _assertUserListedPresent pass came back");

check("Identity 2: the kind invariant lives at the WRITE DOOR, not a scattered pass (PD.442)",
  // The kind invariant — a place you listed as a SIGHT is never left in a stay
  // section, exact-matched against your canonical list — now lives ONCE in
  // canonicalizePlaceActivities (reading _listedGroundTruth), subsuming the
  // deleted, loosely-matched _collapseKindConflicts pass.
  (function () {
    var cd = fs.readFileSync(path.join(ROOT, "construct-decorate.js"), "utf8");
    return maxDataSrc.indexOf("_listedGroundTruth") !== -1
      && maxDataSrc.indexOf("a place you listed as a SIGHT is not a base") !== -1
      && cd.indexOf("window._collapseKindConflicts = function") === -1;  // the pass is gone
  })(),
  "the kind invariant left the write door, or the scattered _collapseKindConflicts pass came back");

check("Enhance 1: auto-enhance is permanently one-shot — existing enhance content blocks it (PD.437)",
  // Auto-enhance must run ONCE and then only on explicit "More like this". The
  // durable gate is the enhance content itself (a type:"synthetic-enhance"
  // section that survives reopen), so a re-entry can't re-fire it even when a
  // trip's destinations were lost (the navigation count-drift bug).
  (function () {
    var eb = fs.readFileSync(path.join(ROOT, "engine-build.js"), "utf8");
    return eb.indexOf('type === "synthetic-enhance"') !== -1
      && eb.indexOf("_hasEnhanceContent") !== -1;
  })(),
  "the durable enhance-content gate was removed — auto-enhance can re-fire on navigation again");

check("Gateway 1: the paste parser won't promote a sight to a gateway on descriptive 'end'/'finish' (PD.436)",
  // The arrival/departure auto-wire must require an EXPLICIT travel word, not
  // bare start/begin/end/finish (which appear in sight descriptions like
  // "east end of the ring road" and used to hijack the exit gateway).
  indexSrc.indexOf("departure|depart|departing|exit|fly out|flying out") !== -1
    && indexSrc.indexOf("departure|exit|end|finish") === -1,
  "the loose arrival/departure keyword returned — a sight can hijack the gateway again");

check("Gateway 2: a sight can never be the arrival/departure gateway (PD.436)",
  // orderKeptCandidates guards entry AND exit matches with _gatewayEligible,
  // and falls through to inference when a hint resolves to no eligible city.
  (function () {
    var ep = fs.readFileSync(path.join(ROOT, "engine-picker.js"), "utf8");
    return ep.indexOf("function _gatewayEligible") !== -1
      && (ep.match(/_gatewayEligible\(/g) || []).length >= 3;
  })(),
  "the gateway-eligibility guard was removed — a canyon can be the departure city again");

check("Discovery 1: build + reopen finalize placement through ONE pipeline (PD.435)",
  // The ordered placement sequence (consolidate orphan themes → surface
  // route-only sights → bake user provenance + re-project cache → collapse
  // kind conflicts) lives in _finalizeDiscoveryPlacement and is CALLED by every
  // finalize site, never re-inlined — so the build and reopen paths cannot
  // drift apart again (they used to run different orderings).
  /window\._finalizeDiscoveryPlacement\s*=/.test(indexSrc)
    && (indexSrc.match(/_finalizeDiscoveryPlacement\(/g) || []).length >= 2,
  "a caller hand-rolled the placement sequence again instead of the one pipeline");

check("T3.2: direct trip-render calls don't grow past the ratchet baseline",
  // The bus is advisory (PD.333) and ~150 sites still call drawTripMode/
  // drawDestMode/updateMainMap directly. requestTripRepaint() (full repaint) and
  // _scheduleMainMapUpdate() (map-only) are the funnels. This RATCHET freezes the
  // direct-call count at today's baseline so the debt can't REGROW: route new
  // repaints through the funnels. Migrating an existing site LOWERS the count —
  // when you do, drop BASELINE to match (a green ratchet only moves down).
  (function () {
    var BASELINE = 152; // total drawTripMode(/drawDestMode(/updateMainMap( in root *.js,*.html (T3.2: 154→152, 2 exec-mode day-selector repaints migrated to _scheduleMainMapUpdate)
    var files = fs.readdirSync(ROOT).filter(function (f) { return /\.(js|html)$/.test(f); });
    var total = 0;
    files.forEach(function (f) {
      var src = fs.readFileSync(path.join(ROOT, f), "utf8");
      ["drawTripMode(", "drawDestMode(", "updateMainMap("].forEach(function (p) {
        total += src.split(p).length - 1;
      });
    });
    return total <= BASELINE;
  })(),
  "a new direct drawTripMode/drawDestMode/updateMainMap call was added (count exceeded the T3.2 ratchet) — route the repaint through requestTripRepaint() / _scheduleMainMapUpdate() instead");

// ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
