# Max — End-to-End Architecture Audit
**Date:** June 6, 2026
**Scope:** Trip state & persistence · URL routing & screen state · Event/render pipeline
**Method:** Three parallel deep audits over the full codebase (index.html ~62k lines, engine-*.js, tripstore.js, db.js, sync.js, trip-ui.js), cross-checked against architecture.md, architecture-rewrite.md, STATE.md, PD-audit-2026-06-03.md.

---

## Executive summary

The recurring breakage is not bad luck and it is not one bug. It is one **disease** expressed in three domains:

> **Too many writers, no single owner.**

- **Trip state** lives in SIX places at once (global `trip`, `_tb`, TripStore, MaxDB localStorage+IDB, the server via MaxSync, `_tripsIndex`/`_currentTripId`) — and code in every layer writes to several of them directly.
- **Screen state** (which screen the user is on) has **18 distinct code sites that write the URL** and at least 8 that toggle panel visibility outside the route dispatcher.
- **Rendering** has both an event bus (tripChange → listener → render) AND **~49 surviving direct `drawTripMode()`/`drawDestMode()` calls**, so most mutations render twice and some renders fire against state that changed mid-flight.

Every bug of the past days maps to this: the trip saved under a key that disagreed with `trip.id` (two id holders), the GC deleting a brand-new trip (deletion heuristic consulted one holder, the trip lived in another), refresh losing Discovery (renderers writing the URL), Home button "dead" (visibility toggled outside the dispatcher), enhance results invisible (`.slice()` copies breaking the by-reference bridge).

The good news: the migration you've been running (TripStore, MaxRoute, MaxBuild, engine split) is the **correct** architecture and is ~70% done. The brittleness is concentrated in the unmigrated 30% — and that 30% is enumerable. This document enumerates it.

---

## 0. THE ACTIVE BUG — reload in Discovery still lands on trip view

**Root cause (high confidence): the app has TWO Discovery surfaces and only one is routed.**

| Surface | Overlay | Stamps URL on open? | Restored by `_dispatchRoute`? |
|---|---|---|---|
| Activity picker (`renderActivityPicker`) | `#trip-brief-overlay` | ✅ yes (PD.331) | ✅ yes (DISCOVERY branch) |
| **Candidate explorer (`showCandidateExplorer`, line ~35311 / `reopenCandidateExplorer` ~34218)** | `#candidate-explorer-overlay` | ❌ **never** | ❌ **no branch exists** |

`showCandidateExplorer` hides the brief overlay, shows its own overlay, and never touches MaxRoute. A Discovery session in the candidate explorer runs with the URL still at `#/trip/<id>` — so reload renders the trip view, *correctly*, per a URL that was never told you were in Discovery. The route dispatcher's DISCOVERY branch also only knows how to restore `renderActivityPicker`, so even a hand-edited `/discovery` URL cannot restore a candidate-explorer session.

**Verify in 5 seconds:** open Discovery, look at the address bar. If it does *not* end in `/discovery`, you are in the unrouted surface.

**Fix (part of Workstream B below):**
1. `showCandidateExplorer`/`reopenCandidateExplorer` stamp `#/trip/<id>/discovery` (replace) on open.
2. `_dispatchRoute`'s DISCOVERY branch picks the right surface to restore — e.g. by what the trip has (`placeActivities` → activity picker; candidates-only → candidate explorer), or a sub-route (`/discovery/explorer`).

---

## 1. Trip state & persistence

### The six holders

| Holder | Written by | Risk |
|---|---|---|
| global `trip` | publishTrip, TripStore mutators, sync pull, dozens of legacy sites | HIGH — direct mutation everywhere |
| `_tb` (picker scratch) | picker UI, MaxBuild phases, reconcile passes, enhance | CRITICAL — no owner at all |
| `TripStore._trip` | TripStore mutators (correct path) | MED — legacy code bypasses it, then the two `trip` references diverge |
| MaxDB (localStorage + IDB mirror) | writeRaw, sync pull, localSave | MED — IDB mirror updates async; quota-overflow path can read stale |
| Server (MaxSync) | debounced scheduleSave; pullAll overwrites whole bodies | SEVERE — last-write-wins on timestamp only, no merge, clock-skew sensitive |
| `_tripsIndex` + `_currentTripId` | loadTripsIndex, selectTrip, mint | MED — `_currentTripId` can disagree with `trip.id` |

### Findings (severity-ordered)

1. **(CRITICAL — data loss) Storage key vs `trip.id` can disagree.** publishTrip historically rebuilt `trip` with `id:null` while writing the envelope under a freshly minted key (partially fixed Jun 6 — `tripId` now resolves to `trip.id`). Remaining: no validation anywhere that *the key being written equals the id inside the body*. One assert in `MaxDB.trip.writeRaw` closes this class forever.
2. **(HIGH — data loss) GC heuristics consult the wrong holder.** `cleanupOrphanedTrips` + the IDB orphan sweep delete anything not in `_tripsIndex` and any "empty shell." Fixed Jun 6: URL-referenced trip protected, 7-day age floor. Remaining: a trip can be index-orphaned by an index write failure and then reaped even though the server has it; the sweep should never delete bodies that exist server-side for a signed-in user (tombstone instead).
3. **(HIGH — divergence) The PD.303 by-reference bridge is unenforced.** `_tb.placeActivities === trip.placeActivities` is required for enhance/reconcile mutations to be visible, but `.slice()` copies are taken at re-hydration (`_dispatchRoute` DISCOVERY branch does `trip.candidates.slice()`!) and in several picker paths. Any of these silently severs the bridge → "my changes don't show until refresh." Needs a runtime assert, not comments.
4. **(MED) Sync pull doesn't validate body id against slot id** (`sync.js` pullAll) — offline-created trips can land duplicated under two slots.
5. **(MED) Mint is not atomic from the UI's perspective.** `_initialTripSave` batches correctly, but `_currentTripId` and `_tripsIndex` update outside the batch; a reload in that window strands the trip.
6. **(MED) TripStore vs global `trip` aliasing.** Any `trip = {...}` reassignment (publishTrip does this on fresh builds) leaves TripStore pointing at the old object unless `replace()` is called — the exact "cannot mutate — no trip loaded" failure fixed this week. Other sites may do the same; all `trip =` reassignments need auditing.

---

## 2. URL routing & screen state

### The numbers
- **18 sites** write the URL (full table in audit working notes). After this week's fixes, renderers (`drawTripMode`/`drawDestMode`) are guarded — but the guards are *opt-in flags* (`noUrlStamp`), which means every **new** caller is wrong by default.
- **8+ sites** toggle `#home-screen` / `#app` / overlay visibility outside `_dispatchRoute` (`showCandidateExplorer`, the `published` subscriber, `setLeftMode`, `showHome`, boot, share flows…).

### Findings

1. **(CRITICAL — the active bug) Candidate explorer is unrouted.** See §0.
2. **(HIGH) `published` subscriber navigates with a bare push** (~line 42941) — fires the route listener whose TRIP branch closes picker overlays. Correct after Choreograph, catastrophic from any other context. Should be the *only* picker-exit navigation, and should be explicit about it.
3. **(HIGH) Renderer URL stamps are default-on.** `drawTripMode`/`drawDestMode` still contain navigate calls, suppressed per-call by `noUrlStamp` and overlay checks. Inverted defaults: the 49 direct render callers each get to "accidentally navigate." The stamp should be *removed from renderers entirely*; user-action handlers (`setLeftMode`, card clicks, dest open) navigate, the dispatcher renders.
4. **(MED) `enterApp`/`selectTrip` normalization guards only check `tripId`,** not screen — correct today, but a malformed/late-loading trip ref degrades to the bare trip route silently (suspected contributor to past "wrong window" reports).
5. **(MED) Two browsers, two builds, one data set.** The service worker means Chrome and Safari can run different code versions against the same synced trips indefinitely until a hard reload. A visible build stamp in the UI (Settings or footer: `v=<deploy stamp>`) would have saved days of "Chrome and Safari have different versions" confusion. The SW already posts a `reload` message; surface it as a banner: "Max was updated — reload."

---

## 3. Event & render pipeline

### Findings

1. **(HIGH) ~49 direct `drawTripMode()`/`drawDestMode()` calls** coexist with the tripChange listener → double renders, scroll thrash, and renders that capture mid-build state. Each is either redundant (delete) or a hidden navigation (route it).
2. **(HIGH) Stale guards.** The tripChange listener computes `_uiOnTripView` once at entry; async work inside means the render can land after the user navigated. Guards must be query *functions* evaluated at render time.
3. **(HIGH) Mid-build re-render clobber.** Mint (phase 3) emits tripChange → the picker re-renders **before reconcile (phase 4) runs** → user sees pre-reconcile data, then a visual jump at enhance-done; and the dispatcher's DISCOVERY hydration (`_tb.candidates = trip.candidates.slice()`) can overwrite live build state if a route event fires mid-build. MaxBuild should suppress (or queue) re-renders between `build:start` and `build:done`.
4. **(MED) `_syncPickerToTrip` is a hidden feedback loop** — mutates `_tb` inside the emit path; picker renders can see their own mutations echoed back.
5. **(MED) `updateMainMap()` runs on every tripChange** regardless of visibility.
6. **(MED) Deferred renders (`setTimeout(... drawDestMode(activeDest), 100)`)** assume `activeDest`/dest existence still holds at fire time.
7. **(LOW) `_mdcItems` duplicates `_tb.placeActivities[*].requiredPlaces`;** `_leftMode` duplicates the URL; `picker-active` class duplicates overlay visibility. Three globals that are each a second copy of truth owned elsewhere.

---

## 4. The fix plan

### Three rules that make the bug classes impossible (enforce mechanically)

1. **Renderers never write.** No renderer touches the URL, panel visibility, or state. Only user-action handlers call `MaxRoute.navigate`; only `_dispatchRoute` toggles panels. *Enforcement:* delete the navigate blocks from `drawTripMode`/`drawDestMode`; grep-test in CI that `MaxRoute.navigate` appears only in an allowlisted set of functions.
2. **One id, one key, asserted.** `MaxDB.trip.writeRaw(id, body)` asserts `JSON.parse(body).trip.id === id` (throw in dev, log loudly in prod). TripStore is the only holder of `currentTripId`; `_currentTripId` becomes a getter.
3. **State mutations only through named mutators.** No `trip.X =`, `trip = {...}`, or `_tb.X =` outside TripStore / MaxEnginePicker / MaxBuild-normalize. *Enforcement:* lint grep in `tests/run.sh`; runtime assert `trip === TripStore.trip` and `_tb.placeActivities === trip.placeActivities` after every batch.

### Ordered workstreams

**A. Stop the bleeding (hours) — do before anything else**
1. Route the candidate explorer (§0) — fixes the active reload bug.
2. Add the writeRaw id/key assert (rule 2).
3. GC: never delete bodies that exist server-side; tombstone instead.

**B. Single-owner screen state (1–2 days)**
4. Remove navigate from renderers entirely; move stamps to `setLeftMode`, dest-card click, picker open/close handlers.
5. `_dispatchRoute` becomes the only panel toggler; `showCandidateExplorer`, `published` subscriber, `setLeftMode`, `showHome` call it (or a shared `setPanels(screen)` it owns).
6. Visible build stamp + "Max was updated — reload" banner.

**C. Single-owner trip state (2–4 days)**
7. Audit every `trip =` reassignment → `TripStore.replace()`.
8. Kill `.slice()` copies on the `_tb` bridge; add the runtime invariant assert.
9. `_currentTripId` → TripStore getter; `_tripsIndex` updates move inside the mint batch.

**D. Render pipeline cleanup (2–3 days, incremental)**
10. Delete the 49 direct draw calls (each is a 5-minute check: "does a tripChange fire on this path?").
11. Guards become query functions.
12. MaxBuild suppresses picker re-renders between build:start and build:done (single re-render at done).

**E. Test the contracts, not just the features**
13. Playwright: reload-restores-screen test for BOTH Discovery surfaces (one exists for the activity picker as of Jun 6); save→reload→same-trip-same-id round-trip; GC-never-eats-the-open-trip.
14. Node: the three rule-asserts above run in `tests/run.sh` so a violation fails the deploy gate — the same gate that already saved you twice this week.

---

## 5. Honest assessment

The strangler-fig migration is working — engine-trip.js is clean, TripStore is right, MaxRoute is right, MaxBuild is right. What's biting you is that **every half-migrated seam is a place where old code and new code both think they own something.** The PD log shows the same lesson being learned repeatedly at different seams (PD.303, PD.330, PD.331, this week's fixes): each was "two owners disagreed."

The plan above is deliberately not a rewrite. It finishes the migration you already designed, in dependency order, with mechanical enforcement so a seam can't silently reopen. Workstream A is hours and removes today's pain; B–D are about a week of focused work total; E is what makes it stick.

---

## 6. Addendum — June 7: the parallel-store debt is paid (PD.356/PD.357)

The three workstreams flagged as "identified but not built" in §5 shipped:

**Phase 1 — canonical at write (PD.356).** `TripStore.setPlaceActivities`
is the one door for the Discovery set. The PD.349 canonicalizer runs
INSIDE the mutator, so non-canonical data can never be persisted. The
render-time canonicalizer remains only as a self-heal for legacy saves.
Writing identical state is a silent no-op (PD.356a) — element-identity
compare, no emit, no persist. This is what makes the next phase safe.

**Phase 2 — `_tb` is no longer a store (PD.356).** `_tb.placeActivities`
is an accessor: reads return the trip's array once a trip is loaded;
writes route through `TripStore.setPlaceActivities`. Installed by
`_tbInstall` at every `_tb` creation site and in `MaxEnginePicker.resetState`.
Pre-mint, a local buffer holds the draft; `_initialTripSave` snapshots
it BEFORE `mint()` flips the getter's source. The PD.303 "by-reference
bridge" stops being a convention and becomes a structural fact. The
picker auto-fire is deleted outright — renderers never trigger builds;
an empty picker shows an explicit "Find places for this trip →" button.
(The PD.348 hydration-race guard became dead code and went with it.)
Field note: the no-op guard was discovered the honest way — without it,
the render chokepoint's reassignment emitted tripChange → re-render →
reassign → emit, a feedback loop that starved the page. Idempotence
terminates it by construction.

**Phase 3 — one place identity (PD.357).** New module `place-key.js`:
`norm` / `resolve` / `same` / `learn`, plus an append-only one-hop alias
registry. The PD.339 token-overlap fuzz now lives in exactly one place.
Every fuzzy hit in `_resolveListedInfo` is a LEARNING EVENT — the alias
is recorded, so the lookup is exact forever after, and the canonicalizer's
`_normKey` resolves through the same registry (a renamed place dedupes
identically everywhere). Aliases persist on `trip.brief._placeAliases`
via the PD.334 curation save and hydrate on trip load.

**Enforcement.** Contract checks grew Rules 6a–6f and 7a–7d (28 total);
`tests/place-key-tests.js` (18 assertions) joined the deploy gate.
Full sweep at ship time: 28 contract + 8 canonical + 18 place-key +
581 engine assertions, 30/31 Playwright (the one failure is the known
sandbox-only Leaflet CDN block).

**Still open (smaller, non-structural now):** `_mdcItems` remains a
mirrored copy (aliasing it risked post-mint wipes from legacy `= []`
clears; revisit once those clears are audited); the four-section-list
collapse (§B4) is half-done — write-through stays until then; sync
conflict UX (keep-mine/take-theirs) unbuilt.

---

## 7. Addendum — June 7 (second pass): the confession list is closed

The six "still open" items from the §6 addendum, resolved (except the
last, which is a long-term track, not a session):

**`_mdcItems` unified (PD.358).** No longer a store — it is the same
routed view as `_tb.placeActivities` (window accessor; pre-mint drafts
live in ONE shared buffer, `_PA_BUF`, so the two views cannot diverge
even before a trip exists). The PD.300 four-copies write-through was
deleted outright — under one array it was structurally dead code. The
audit fear (the fold-filter at the old write-through site deleting
considered items) turned out to be unfounded: that filter was a SYNC
derived from the canonical list, which the unification makes a no-op.
New: `TripStore.touch(name)` — explicit version-bump + persist for
flows that mutate items in place, since the PD.356a no-op guard makes
same-ref reassignment silent by design.

**Mint at build start (PD.359).** The trip exists BEFORE any LLM call,
in both flows: the paste flow mints right after construct-then-decorate
(the user's list lands on trip.brief immediately), and the brief flow
force-mints at generation entry. The PD.335 localStorage stash and the
PD.335a one-hour-freshness restore are DELETED — mid-build recovery now
re-derives the user's list from trip.brief, the actual durable record.

**Writers own reconciliation (PD.360).** The place-set passes run at
write milestones (`build:done`, `build:enhance-done`, via
`_runPlaceSetPasses`); routed writes and curation mark the set dirty;
the render-site call is demoted to a silent self-heal that only runs
when something actually wrote since the last pass. Render is no longer
the primary write site — it's the backstop.

**Aliases are correctable (PD.361).** `PlaceKey.forget()` +
`MaxAliases.list()` / `MaxAliases.forget("name")` in the console. A bad
fuzzy learn is no longer a permanent wrong identity; forgets persist
through the normal curation save.

**Conflicts ask the user (PD.362).** A real rev conflict (rev mismatch,
not clock skew) now raises a modal: "Keep this device's version" /
"Use the other version". Theirs → server copy adopted through
MaxDB.writeRaw (UI reloads via selectTrip). No chooser registered
(tests, headless) → v1 force-local behavior, so nothing blocks.

**Enforcement.** Contract Rules 8a–8h (36 checks total); place-key
suite at 21. Sweep: 36 contract + 8 canonical + 21 place-key + 581
engine assertions; 30/31 Playwright (the 1 is the sandbox Leaflet CDN
block, environmental).

**The one that remains — and it's the big one.** index.html is ~62k
lines of inline script. Everything above is scaffolding that makes that
fact survivable. The long-term track is continuing the strangler-fig
extraction (picker internals → engine-picker, render pipeline →
trip-ui) — weeks of incremental work, gated by the same contract
checks, not a session.

---

## 8. Addendum — June 7 (third pass): one binding, and a safety net

**The harness (PD.368).** `tests/playwright/build-harness.spec.js` drives
the REAL paste→classify→construct→mint→generate→merge→publish→return
loop with canned LLM responses (classifier verdicts, the activity
generation, the completeness check; everything else rejects and falls
back — same as a flaky network). It asserts the user-list contract
(all 8 places present and checked), place identity (one sight slot per
place), the one-array invariant (store == _tb == _mdcItems), mint at
build start, banner-gone-when-done, all three CTA states, and that the
receipt count equals the PD.269 considered count. It found a real bug
on its first run (below). Runs in ~1.5s inside the deploy gate.

**The trip global is dead (PD.369).** `window.trip` is an accessor:
reads resolve to TripStore.trip when loaded; assigning a fresh object
holds it as the pending binding until the store adopts it (every legacy
write site already calls TripStore.replace); `trip = null` routes to
TripStore.unload(). The CTA-staleness class — any path that forgot the
`trip = TripStore.trip` resync — is structurally closed.

**Candidates unified (PD.370).** `_tb.candidates` is a routed view
(shared pre-mint buffer `_CAND_BUF`, writes through
TripStore.setCandidates with the PD.356a no-op guard). The harness +
existing suite immediately exposed the consequence: publishTrip's
fresh-stub branch replaced the trip with a stub that LACKED
candidates/placeActivities, voiding the routed views mid-publish —
rebuilt trips lost their candidate flips. The stub now carries the live
arrays across the swap. (This bug existed in latent form before
unification; the views made it visible and testable.)

**Brief rides the save (PD.371).** Changed picker brief fields land on
trip.brief with every curation save via TripStore.updateBrief — diffed,
clone-on-write, and empty/false picker values never clobber existing
brief values.

**Enforcement.** Contract Rules 9a–9d (40 checks total). Sweep: 40
contract + 8 canonical + 21 place-key + 581 engine; 32/33 Playwright
(the 1 is the sandbox-only Leaflet CDN block).

**What remains (unchanged):** the inline-script extraction — the long
game. The data layer now has one store, one array per collection, one
place identity, one trip binding, and a harness that walks the user's
own loop on every deploy.

---

## 9. Addendum — June 7 (fourth pass): section + provenance models

The recurring "wrong section / wrong check-state" bugs (hubs arriving
checked, iconic auto-check, the two-stay-section split) all traced to
two missing models. Both now exist.

**SectionKind (PD.381) — section identity in one place.** `section-kind.js`
owns the six canonical section names and every "what kind is this?"
predicate: `isStay`, `isCommittedStay`, `isStayConsider`, `isCatchall`,
`catchallRank`, `catchallPrecedence`, `isSynthetic`. The ~30 scattered
string-matches — the fold's `SYNTHETIC_NAMES`, the canonicalizer's
`_CATCHALL_PRECEDENCE`, `_isStaySection`, `_pd291IsStaySection`, the
noun map — now route through it. `index.html` and `max-data.js` both
delegate (with inline fallbacks so the Node suites stay self-contained).
12-assertion suite in the deploy gate.

**Provenance (PD.382) — _origin is a stored field, not a derivation.**
Every requiredPlace carries `_origin` set ONCE at creation: `"user"`
(the traveler listed it — checked), `"max-hub"` (a base Max synthesized
for the user's sights — unchecked), `"max"` (an LLM/enhance suggestion —
unchecked). `_placeOrigin(p)` reads the field with a legacy-inference
fallback; `_defaultKeepForOrigin(o)` is the check-state rule in one
place. Tagged at all creation sites (constructor, backstop hub/stub,
LLM merge, the synthetic-stays owner); survives the reopen clone; the
audit derives provenance from it. "Max never checks anything," "the
user-listed contract," and "two stay sections by provenance" stop being
conventions enforced in N places and become derivations from one field.

**Enforcement.** Contract Rules 13a–c + 14a–d (56 checks total); the
harness asserts the invariant directly — every checked place has
`_origin === "user"`, hubs are `"max-hub"` unchecked, LLM places are
`"max"` unchecked. Sweep: 56 contract + 8 canonical + 21 place-key + 12
section-kind + 581 engine; 32/33 Playwright (the 1 is the sandbox
Leaflet block).

**What's left of the original debt list:** only the inline-script
extraction — the multi-week, incremental track. The data layer now has
one store, one array per collection, one place identity, one section
identity, one provenance field, and one trip binding — each enforced by
a deploy-gating check and exercised by a harness that walks the user's
own loop.

---

## 10. Addendum — June 8: the re-architecture (PD.399/400)

### The regression that triggered it
Containment matching ("X" ⊂ "X Y") was used to DELETE catchall
duplicates. It over-matched: "Reykjavik Old Harbour" was deleted as a
dup of "Reykjavik". In a real Iceland trip dozens of Max sights start
with a city name → mass deletion → "no Max recommendations." Fixed
(PD.399) by COORDINATE-GATING containment: a containment match deletes
only when the two places are also within ~0.6 km. True variants
(Þingvellir ≈ Þingvellir National Park, same point) still merge;
distinct places inside a city survive. Two regression tests pin it.

### The root, named plainly
Discovery's data was the emergent result of ~7 imperative mutation
passes over a shared array (construct, backstop, reconcile,
canonicalize, the stays owner, the catchall invariant, the umbrella
router). No single owner of "where does this place go." Every count
surface re-derived the truth differently; the passes interacted to
spawn a new edge case each round. Patching one symptom reliably created
the next. This is THE architectural failure behind the whole bug class.

### The new architecture (OO / SOA) — `discovery-model.js`
- **Place** — an entity with stable, coordinate-aware identity and a
  few orthogonal attributes: `origin` (user|max-hub|max), `role`
  (stay|sight), `decision` (checked|unchecked|rejected), `themeFit`.
- **DiscoveryModel** — the SINGLE SOURCE OF TRUTH (a keyed ledger) and
  the SINGLE WRITER (`upsert`, `setDecision`, `setRole`). Nobody edits
  the array; everyone goes through a method. `upsert` is identity-
  merging, so re-ingestion can't ratchet and variants can't duplicate.
- **PlacementPolicy.sectionFor(place)** — ONE PURE FUNCTION. A place's
  section is DERIVED from its attributes, never stored, never mutated
  by a pass. This single function replaces the entire pass chain's
  placement logic. Change an attribute → the section follows.
- **Pure queries** — `sections()`, `considered()`, `consideredBySection()`,
  `committed()`, `coverage()`. Every count comes from here, so they
  cannot disagree — the chip == the receipt == the pill by construction,
  not by a matching test.

The whole bug class is now expressed as properties the model holds BY
CONSTRUCTION (14 unit tests): a checked sight can never be in a
to-consider catchall; chip == considered; user stays never merge with
Max hubs; a distinct place inside a destination is never deleted; a
one-word listed place is found in its qualified form.

### Migration (strangler-fig, not big-bang)
The model is pure, standalone, and on the deploy gate now. The picker is
migrated onto it incrementally — replacing the pass chain one consumer
at a time (read surfaces first: counts/coverage, then the section
grouping, then ingestion), so the app keeps working throughout. The
end state: the build pipeline `upsert`s places into the model (one
writer); `renderActivityPicker` reads `model.sections()` (one
derivation); the 7 passes are deleted. That deletion is the win — fewer
moving parts, not more.

### PD.401 — the model is now WIRED as the final placement authority
The first and decisive migration step is live. At the reconcile
chokepoint (`_reconcileUserListedKeeps`), `_applyDiscoveryModelToSights()`
now runs LAST: it ingests every sight the pass-chain produced into a
fresh `DiscoveryModel`, dedupes by coordinate-aware identity, and
**re-derives every sight section from `PlacementPolicy.sectionFor`** —
then rewrites `_tb.placeActivities` from `model.sections()` (cloning each
item's editorial fields, overriding only placement). Stay/route/condition
sections pass through unchanged.

Consequences, by construction rather than by patch:
- A checked sight CANNOT remain in a to-consider catchall — its section
  is a pure function of `decision`. (The old `_ensureCatchallsUnchecked`
  invariant is subsumed; Rule 25b now asserts the model owns the
  chokepoint.)
- Cross-section duplicates collapse — one `upsert` ledger, one entity
  per place; the chip == receipt == pill because all three read the same
  derivation.
- "Sights near places you listed" vs "More places to consider" is
  preserved via the `nearListed` attribute; "From your list" via
  `origin: user`.

The pass-chain still GENERATES the raw places (construct/backstop/
enhance/stays-owner/umbrella-router); the model is the single LAST WORD
on where each sight lands. Deleting the now-redundant placement passes is
the next step — the model already overrides them, so they can come out
one at a time behind a green suite.

### PD.401c — ONE considered derivation (no more two owners)
The 63-vs-56 banner bug (and the older discovery-preview-vs-trip-pill
drift) had the same cause: "what's considered, and where" was computed in
several places, each with its own dedup. The render came from the model
(coordinate-aware identity); `MaxData.consideredPlaceKeys` used name-key
dedup; the banner read one, the chips read the other → drift.

Now there is ONE ingestion and ONE derivation:
`DiscoveryModel.fromPlaceActivities(items, opts)` is the single function
that turns placeActivities into the model — skipping stays, routes,
hubs, and destinations, applying the one coordinate-aware identity. Every
surface builds through it:
- the **render** (`_applyDiscoveryModelToSights`) — placement;
- the **receipt banner** (`_discoveryConsideredCounts`) — the headline
  and the catchall split;
- **`MaxData.consideredPlaceKeys`** — which now DELEGATES to
  `model.consideredKeyedSet()`, so everything built on it (the trip pill
  `countConsideredSights`, the overview pins `getConsideredSights`, the
  section chips `consideredBySection`, the `_maxPlaceSetAudit` receipt)
  is the identical set.

Because the pill, the audit, the chips, the banner, and the render are
now literally the same derivation over the same ingestion, they cannot
disagree by construction. Contract Rule 27 pins this: any future edit
that forks a second considered-derivation fails the gate.

### PD.401d — deleting the redundant pass (and what is NOT redundant)
`_ensureCatchallsUnchecked` is DELETED. It imperatively enforced "a to-
consider catchall holds only unchecked sights; a checked sight moves to
'Sights you're keeping'; no dests/hubs." Every clause of that is now a
pure consequence of `PlacementPolicy.sectionFor` plus the ingestion
skipping dests/hubs — there is nothing left to "ensure." (Rules 25a and
26d were repointed at the model; the suite stays green.)

Being honest about the rest of the "7 passes," because not all of them
were placement owners competing with the model — most are the PIPELINE
that PRODUCES the model's inputs, and deleting them would starve it:

- **construct / backstop / enhance** — GENERATE places (the user's list,
  dropped-place recovery, LLM suggestions). The model derives placement
  *from* these; it does not replace them.
- **`_reconcileUserListedKeeps`** — canonicalization at the chokepoint +
  rehydration of `_userListedNames` / `_classificationByPlace` / origin.
  This is the data prep that gives each place its `_origin` and `_keep`;
  the model READS those. It ends by calling the model (the last word on
  placement), but its body is inputs, not a competing owner.
- **stays-owner** — places the stay sections (passthrough; the model
  deliberately does not own stays).
- **umbrella-router** — assigns the scenic-routes theme, which the model
  consumes as `themeFit`. An input, not an override.

So the architecture is now a clean pipeline: *generate → prepare →
DiscoveryModel derives the single placement + the single considered set →
everything reads that one derivation*. The only thing that was a genuine
second owner of placement (the catchall pass) is gone.

### PD.401e — folding the umbrella-router into the model
`_routeUmbrellasToScenicRoutes` is DELETED too. It was the last *input*
pass that made a placement decision outside the model: it recognized that
a place whose name is itself a named driving route ("Golden Circle",
"Ring Road", a scenic loop) belongs in "Drive scenic routes," not in
"From your list." That recognition is now the model's:

- `MaxDiscovery.isRouteUmbrella(name)` — the pure predicate (the old
  regex, now owned by the model).
- `PlacementPolicy.sectionFor` routes an umbrella (with no more-specific
  theme) to `SECTION.SCENIC`, and `considered()`/`committed()` exclude
  it — a route reference is not a considerable sight, so it never pads
  the count.
- The adapter does the only thing that isn't a pure decision: it merges
  the model's scenic places into the existing `type:"route"` container
  (which carries route semantics — endpoints, transit chips — the model
  deliberately doesn't own). The *what* is the model's; the adapter is
  just *where it lives*.

That closes the loop the user asked for: even this input is now a model
concern. The picker's placement is the model, the counts are the model,
and the only thing left that "decides" anything about a sight's home —
route-umbrella-ness — is a pure, unit-tested function inside it. Contract
Rule 26e is repointed to pin the fold (the pre-pass cannot return).

## 11. Operational hardening (PD.401f–g)

Three weaknesses were named in a candid re-evaluation: the monolith, a
history of persistence races, and an environment-dependent test failure.
Two are now addressed.

### PD.401f — Leaflet vendored (no third-party CDN)
The map library was loaded from cdnjs/unpkg at runtime — a supply-chain
and uptime dependency, and the reason one Playwright test failed whenever
the network was blocked. Leaflet 1.9.4 is now vendored under
`vendor/leaflet/` (js, css, marker images) and every CDN reference
repointed to it. The full suite is green for the first time (35/35
Playwright, no environment-dependent failure), and `deploy.sh` passes its
gate without `--skip-tests`. Contract Rule 28 keeps a CDN reference from
returning.

### PD.401g — continuing the strangler-fig (shrinking the monolith)
The Discovery placement adapter (`_discoveryOpts`,
`_discoveryConsideredCounts`, `_applyDiscoveryModelToSights`) was
extracted verbatim from index.html into `discovery-adapter.js` — a
cohesive ~157-line unit with a clear seam to the pure model. This is the
chosen approach: incremental extraction behind the existing script-tag
pattern, no build step, full suite green after each move. index.html is
~62.2k inline-script lines; 21 modules now hold ~27.8k. The contract
checks that grepped the inline code were repointed to a `placementSrc`
that spans "wherever the adapter lives," so the rules don't care which
file holds the code — only that the invariant holds.

### PD.401h — the render was still a second owner (the real "deeper issue")
A live build still showed `Sights near (38) + More (9)` while the banner
said `51`. The unification (PD.401c) had reached the *count* surfaces but
NOT the *rendered sections*. Two compounding causes:

1. **The section renderer never applied the model.**
   `_applyDiscoveryModelToSights` ran only inside `_reconcileUserListedKeeps`,
   which fires at write *milestones* — not on render. So a returned/
   hydrated trip painted whatever placement the last milestone left, while
   the receipt banner built a *fresh* model live. The render showed stale
   placement; the banner showed the model. The gap was exactly the places
   the model would re-home.
2. **The render trusted a discipline flag.** The one re-derivation hook it
   did have was gated by `window._placeSetClean` — a flag every writer had
   to remember to reset. A writer that mutated `placeActivities` and left
   the flag `true` made the render skip re-derivation silently. That is the
   same "enforced by discipline, not structure" fragility the safety
   re-evaluation called out — and here it produced a visible wrong number.

Fix: `_renderPlaceActivityItems` now applies the model UNCONDITIONALLY
before it groups sections (PD.401h). The adapter is a pure O(n)
re-derivation and an identical result is a silent no-op write, so this
neither loops nor churns; it's skipped only mid-build. Now the painted
section chips == the model == the banner == the trip pill, by
construction — no flag to get wrong.

This was caught only because the test suite was extended to read the
RENDERED DOM: the harness previously asserted the model and the array
agreed, but never that the *painted* section chips matched the banner.
The new test injects a mis-placed sight with `_placeSetClean` left true
and asserts the rendered catchall chips equal the model — it fails
without the fix (chips 0, model 1) and passes with it. Contract Rule 29
pins that the renderer applies the model before grouping and isn't
re-gated behind the flag.

Honest note: this is the third time "single source of truth" had to be
extended to another surface (write door → counts → render). The lesson is
that in a render-heavy app, *every* surface that displays a number must
read the one derivation at the moment it paints; a cached/flagged copy is
a latent second owner. The remaining count surfaces should be audited for
the same pattern.

### PD.401i — audit: kill the duplicate count derivations
A sweep for "second paths" that independently group/count places found
THREE separate per-section counters, each deduping by its own
`place.toLowerCase()` key — none using the model's identity:

1. the **TOC** count (`Object.keys(seenPlaces).length`),
2. the **by-section header** count (`destOrder.length`, from `byDest`),
3. the **by-place ("All places") header** count (from `byPlace`).

After PD.401h these *happened* to agree (all read the model-synced array),
but three copies of "count a section" are three chances to drift on an
accented variant, an alias, or a coordinate-merge — exactly the kind of
latent second owner that produces the next wrong number.

Fix: the adapter now stashes `window._discoverySectionCounts` — the
model's per-section place count — and `_pmModelSectionCount(sec)` is the
one accessor. The TOC and the section header both read it (falling back to
local counting only for sections the model doesn't own: routes/stays). One
number, the model's, for every displayed section count. The harness now
asserts, in the rendered DOM, that the TOC entry and the section header
show the SAME number per catchall; contract Rule 30 pins that both read
the one source and Rule 25c that the chip never re-acquires a bespoke
counter.

Still on the list (honest): the by-place "All places" consolidated view
(`byPlace`, header at the stay/visit split) is a structurally different
aggregation across sections and was NOT migrated this pass; and the map
pins build their own `allPlaces` set. Neither currently shows a
section-count that contradicts the model, but both are second groupings of
the same data and should be routed through the model next, by the same
principle. The rule of thumb going forward: any surface that displays a
place or a count reads `model.sections()` / the model accessors at paint
time — no surface re-groups or re-counts.

### PD.401j — finishing the second-path sweep
A full sweep for surfaces that independently derive place membership:

- **`MaxData.getCommittedSights`** (the overview's green teardrops) WAS a
  genuine second derivation — its own checked-filter and `_normKey` dedup,
  not the model. Now routed through `model.committed()` (membership) with
  coordinate resolution kept as presentation. Contract Rule 27e pins it.
  So the considered set, the committed set, section placement, and section
  counts ALL now derive from the one model.

- **The by-place "All places" view** and **the Leaflet map pins** are NOT
  independent derivations of membership. Both iterate the *model-synced*
  `placeActivities`, so their place SET already equals the model. The only
  difference is the identity *function* used for the final presentation
  dedup: raw `place.toLowerCase()` vs the model's `PlaceKey.resolve`. These
  two keyings provably cannot yield different sets on the synced array —
  the model has already merged anything `resolve` treats as equal, so no
  surviving pair differs only by case/accent/alias. And that raw key is
  coupled to the TOC scroll anchors (`tb-place-place-row-KEY`) and the
  marker dictionary (`state.markers[key]`) with many lookup sites.
  Rewriting it is plumbing risk for zero behavioral change, so it is
  deliberately left — consistent with the safety principle of not making
  risky changes without payoff. If a single identity function is wanted
  everywhere as a purity measure, it is a coordinated rename of three
  coupling groups (by-place + TOC anchors; the marker dictionary) that
  changes no numbers; scoped, not urgent.

Bottom line: there is now ONE source of truth for every place COUNT and
every membership SET a user sees (placement, considered, committed,
section counts, TOC, banner, pill, overview pins). The remaining
lowercase dedups are non-divergent presentation keys, not second owners
of the data.

## 12. The real correction: identity once, interning, no read-time dedup

The reviewer's point stands and reframes the target: **needing a dedup is
the architecture admitting it let a duplicate in.** Dedup is a symptom of
identity being established LATE (recomputed at each read) instead of at
the moment a place enters. And **one identity function everywhere is
correctness, not a "purity measure."** The correct design:

- `PlaceKey` is the sole identity owner.
- Identity is computed ONCE, at the write door, and stamped on the place
  (`_key`). No reader ever recomputes it.
- The canonical store INTERNS: a place that resolves to an existing `_key`
  merges into it. Duplicates are structurally impossible.
- Every reader groups by `_key`. No reader dedups, because there is
  nothing to dedup.

Current debt: there were TWO interning implementations
(`canonicalizePlaceActivities` at the write door, `DiscoveryModel`'s
ingestion at read) and identity was recomputed at every read site
(`place.toLowerCase()` in the map/by-place/TOC; `PlaceKey.resolve` in the
model and counts). That is the root the read-time dedups were papering
over.

### Staged migration (correctness, not big-bang)
- **PD.401k — STEP 1 (done):** the write door (`canonicalizePlaceActivities`)
  now stamps `_key` on every place once, after merging; the
  `DiscoveryModel` reads `_key` instead of recomputing. Behavior-identical
  and verified (full gate green) — `_key` equals what the model already
  computed, so nothing moves yet. This is the foundation: identity now
  *flows from* the write door.
- **STEP 2 (next):** route every identity consumer to `p._key` — the
  Leaflet marker dictionary, `byDest`, `byPlace`, the TOC — deleting every
  `place.toLowerCase()` / per-site `PlaceKey.resolve(place)`. One identity,
  read everywhere. (This removes the inconsistent lowercase keying.)
- **STEP 3:** collapse the two interns into one — the write door adopts
  the model's coordinate-aware identity (or the model becomes the store),
  so there is a single interning algorithm.
- **STEP 4:** delete read-time dedup entirely — readers `group by _key`;
  no `seen{}` / `byDest` dedup loops, because the write door guarantees one
  place per `_key`.

End state: identity once, interned at the write door, read everywhere;
zero dedup at read. The dedups disappear because duplicates can no longer
exist — which is the reviewer's point made structural.

### PD.401k-collapse — one interning author (done)
`canonicalizePlaceActivities` had THREE identity notions inside it
(`_normKey` name dedup, the `_isAlreadyThemed`/`relatedTo`+coordinate-gate
fuzzy matcher, and the `_internKey`/`sameEntity` stamp). They are now ONE:
the canonicalizer interns every place at the TOP via `sameEntity` (the
model's single coordinate-aware identity), stamps `_key`, and every
subsequent pass (entry dedupe, themed-vs-catchall, best-rank, claimed,
stay precedence) groups by `_key`. The whole fuzzy apparatus
(`_isAlreadyThemed`, `_sameOrContains`, the local `_coordsClose`) is
DELETED — it existed only to compensate for non-canonical keys. `_key`
now has exactly one author, shared with the model. Verified: the
canonical-placeset coordinate-gating guards still pass (distinct place not
deleted; same-coords variant collapses), and the test now loads
discovery-model.js to mirror production's script order. Contract Rules
17a/17b/26b were repointed from the deleted implementation to the one
identity.

### What shipped (PD.401k, verified green at each step)
- **Identity once, coordinate-canonical (Steps 1+3).** The write door
  (`canonicalizePlaceActivities`) stamps `_key` on every place using the
  ONE identity — the model's `sameEntity` — so coordinate-duplicates get
  the SAME key. Identity is established at the door; nothing downstream
  recomputes it. The `DiscoveryModel` reads `_key`.
- **One accessor, read everywhere in the data/render path (Step 2).**
  `window._pmKey(placeOrName)` returns the canonical `_key` (fallback
  `PlaceKey.resolve`). Routed through it: `byDest`, `byPlace`, the
  place-TOC, the day-trip eligibility map, the model ingestion, and (via
  the model) every count, the considered set, the committed set, and the
  section placement. No `place.toLowerCase()` identity remains in the
  picker renderer.
- **No read-time dedup (Step 4).** Readers now GROUP by the one `_key`
  rather than running their own `seen{}`/lowercase dedup. The write door
  interns; the model's coordinate match is now a dormant fallback that
  only fires for un-stamped input (tests / in-memory pre-write). Contract
  Rule 31 pins all of this.

### The Leaflet marker subsystem (PD.401k-markers)
Done, behind a safety-net test. The picker-map marker dictionary
(`allPlaces` build), the popup snapshot, the day-trip hub lookup, and the
primary marker lookup are all keyed by the ONE identity (`_pmKey`) — the
raw `place.toLowerCase()` keys are gone. A new Playwright test renders the
picker map with an ACCENTED place (so raw-lower ≠ canonical) and asserts
every marker key is the canonical `_pmKey` and the accented marker is
found by it; it renders the real Leaflet map (vendored), so it is
non-vacuous. Contract Rule 31d pins the keying.

A deep finding worth recording: the map's three-way FUZZY lookup
(`keyLower` → `keyNorm` → word-containment search) was itself a SYMPTOM of
non-canonical keying — with canonical keys the exact hit suffices. It is
**deliberately retained** as a fallback, and this is not a second identity
scheme: coordinate-canonical identity cannot be recomputed from a bare
place name (a name carries no coordinates), and several callers pass only
a name. Fully deleting the fallback would require threading `_key` through
every lookup CALLER — a separate, larger effort. The fallback now fires
only for the rare coordinate-merged / variant-name case; the common path
is one exact canonical hit.

Two narrower items remain, both non-divergent: (1) the inline-generated
popup-map `<script>` strings build a self-contained marker dict with
their own `place.toLowerCase()` — internally consistent, so correct, but
a second identity for purity; aligning them means embedding `_key` in the
serialized place data. (2) `_pmMetaKey`/`placeMeta` (per-place notes /
overrides) is keyed by `_normPlaceName`; re-keying it to `_pmKey` is a
data migration (existing stored keys), so it is intentionally left for a
dedicated pass. Neither produces a wrong number; both are tracked.

### Persistence (the third item) — status
Not a missing-protection problem: revision tracking (server-owned
monotonic `rev`), real 409-conflict handling with a keep-mine/take-theirs
path, and GC guards (protect the URL trip, never reap server truth, age
floor) all exist. The open work is to *pin those invariants with tests*
so a future edit can't silently undo them — a contained next step, not a
rebuild.
