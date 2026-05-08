# Path to 10

Single source of truth for "what's left on the architecture refactor."
Open this when you sit down and want to know the next move. Update it
when you ship a round (check a box, add a follow-up).

---

## Where we are now

**Score: ~8.5 / 10** (May 2026, after Items A, C, D all closed).
Up from 3 (single 24kloc inline file).

What's solid:
- Pure logic lives in engines and is tested. **211 tests**, well-
  named contracts.
- DB seam exists (`db.js`, Round HA). Picker → trip handoff goes
  through it (Round HM).
- Picker UI fully extracted (`picker-ui.js`). All four big inline
  picker blocks (HX.11–14) now live there — `renderCandidateCards`'s
  ~600-line monster is mostly delegators.
- **`engine-trip.js` is DOM-free** (HY round). All 11 trip mutators
  emit events instead of calling `drawXxx` directly. Namespace
  surface lets engine consumers drive mutations. An automated test
  (`engine-trip.js has no DOM dependencies`) prevents regressions.
- **`_tb` is now behind engine APIs** (HZ rounds). HZ.1 added
  curated read getters (`brief()`, `candidates()`, `requiredPlaces()`).
  HZ.2 added domain setters (`setEntry`, `setExit`, `setRegion`,
  `setCandidateStatus`, `startFresh`). External consumers never
  need to touch `_tb` directly.
- SCAFFOLD UI rounds (1, 1.5, 2, 3, 4, 5, 6) shipped — calendar-
  aware mode + commitment states + decisions panel + rationale
  popovers. Six rounds of user-visible work that proved the engine
  surface holds up under product change.

What's still missing:
- **Item B** (mobile shell) — MA.1 read view shipped; mutations
  beyond notes still require future Phase 2 work.
- **Item 16** (drawTripMode / drawDestMode fold into Places page) —
  deferred until a real driver appears. Multi-month estimate, low
  immediate value, no user-visible payoff.
- **HZ.3+ migration** — inline picker code still reads `_tb.X`
  directly (low-value migration, deferred). The engine API surface
  is what matters for external consumers; inline picker can keep
  its locals.

---

## The five items, in priority order

### Item A — Finish Phase 2 (trip-engine event system) — ✅ DONE
**State:** done as of round HY (v305, May 2026).

When this item was first written, the assumption was that the 12
mutators called `drawTripMode` / `drawDestMode` / `updateMainMap`
directly. Audit during HY revealed they all already route through
`_emitTripMutation()` (an inline helper that calls
`MaxEngineTrip.emit('tripChange') + emit('mapDataChange')`). The
TODO comments above each mutator were stale rather than accurate.

**HY closed the item by:**
1. Removing the 11 stale `TODO(path-to-10:A)` comments from
   inline `index.html`.
2. Exposing the mutators on `MaxEngineTrip` namespace as
   delegators, so engine consumers (mobile, future tooling)
   have a stable surface to call. Bodies stay inline because
   they reference inline-script globals (destCtr, _coarseGeocode,
   ensureCoarseGeocode, autoSave, etc.) that aren't trivially
   liftable; the surface is what matters for now.
3. Adding two engine tests:
   - "all 11 mutators are exposed on MaxEngineTrip" — locks the
     surface.
   - "engine-trip.js has no DOM dependencies" — scans the file
     and fails if `document`, `drawXxx`, or `getElementById`
     show up in code (comments don't count).

**The 11 mutators, all done:**
- [x] `_ftSchedulePeerDayTrip` → `MaxEngineTrip.schedulePeerDayTrip`
- [x] `addDayTripToDay`
- [x] `removeDayTripFromDay`
- [x] `removeDayTripFromDayItem`
- [x] `makeDayTrip`
- [x] `ungroupDayTrip`
- [x] `addBufferNight`
- [x] `reverseTripOrder`
- [x] `executeMoveDest`
- [x] `delDest`
- [x] `applyDateChange`

`_ftReverseNightTransfer` is already pure (engine method,
emits internally) and out of scope.

**Done when (criteria, all met):**
- ✅ all mutators emit `tripChange` + `mapDataChange`
- ✅ no inline mutator references DOM helpers directly
- ✅ `engine-trip.js` has zero `document`/`drawXxx`/`g()` refs
  in code (engine-DOM-free test enforces)
- ✅ namespace surface exists for engine consumers

### Item B — Mobile shell as second consumer
**State:** **MA.1 shipped (May 2026).** Read-only trip view +
edit-traveler-notes + cross-tab sync via storage events. Validates
the engine API for the read path. Mutations beyond notes still
require Phase 2 mutator conversion (Item A).

Recommended sequencing: **don't wait for Item A to finish.** Start
the mobile shell against `engine-trip.js` as soon as ~half the
mutators are converted. The mobile attempt finds Phase 2's holes
faster than introspection does. You'll know an event is missing
because the mobile view doesn't update.

**First concrete round (MA.1) — done:** `mobile/index.html` exists.
Loads `db.js` + `engine-trip.js`, lists trips from
`MaxDB.index.list()`, opens one via `MaxDB.trip.read(id)`, renders
destinations as a vertical card list with place / dates / nights.
Subscribes to MaxDB `tripWritten` AND `window.storage` events for
cross-tab sync. Adds a `travelerNotes` field per destination,
edited inline; saved via `MaxDB.trip.write`. Tested headless: trip
view renders, note edit persists, cross-tab sync propagates.

**Round MA.2 — done (May 2026).** Shared trip-view rendering seam:
new `trip-ui.js` with `MaxTripUI.renderDay` + `renderItinItemCompact`.
Mobile destination cards now render day-by-day Itinerary inline
(read-mostly: priority dot, name with tap-to-highlight, time,
done badge, inline notes). Visual language matches desktop's
`.dayblock` / `.srow` / `.sname`. Empty days suppressed.

**Round MA.3 — done (May 2026, claims-only).** Unified the API
surface: `MaxTripUI.renderItinItem(s, dayId, destId, opts)` now
dispatches on `opts.compact` (compact → in-file renderer; full →
delegate to inline `window.mkItinItem`). Mobile now calls
`renderDay({compact: true})` so the routing is explicit. The full
~370-line mkItinItem body is still inline in `index.html` —
**MA.3 did not move code**, just locked the contract. Honest
scope-limit; lifting all 17 cross-references to inline globals
(fS, autoSave, drawDestMode, getDest, etc.) is risky enough to
warrant its own round.

**Round MA.4 — done (May 2026).** Lifted. See Item C's checkbox
above. Spec at `tests/playwright/itin-item.spec.js`.

**Round MA.5 candidate:** add a second mobile mutation that drives
a real Phase 2 mutator. Recommended: "mark item done" — exercises
the `mDone`/`uDone` path. Or "edit destination dates" via the
`applyDateChange` path. Either would force converting one of the
TODO(path-to-10:A) mutators to emit `tripChange`.

**Done when:** `mobile/index.html` shows your active trip on a
phone, updates within 1–2s of a change made on desktop (via Supabase
sync — see `plan-supabase-migration.md`), and the mobile bundle
imports zero functions from `index.html` / `picker-ui.js`.

**Same-device cross-tab is already done as of MA.1 via storage events.**
True cross-device requires Supabase (item not yet started).

**Why mobile, why now:** it's the falsifiability test for the entire
engine extraction. If you can't build a mobile view, the abstraction
isn't real. Better to find that out at ~50% Phase 2 done than at
100%.

### Item C — Big DOM blocks still inline in renderCandidateCards — ✅ DONE
**State:** done as of v311 (May 2026). HX.5–14 all shipped.

The renderer is ~600 lines. HX.5–HX.10 took the easy bites. The
remaining four are bigger but each is self-contained:
- [x] **MA.2:** `mkDay` + `mkItinItem`. Shared peer in `trip-ui.js`
  (`renderDay` + `renderItinItemCompact`) shipped May 2026 — mobile
  consumes; desktop still has its inline rich version. MA.3 unifies
  via a `compact` flag.
- [x] **MA.4 (May 2026):** Full mkItinItem body (~370 lines) lifted
  into `trip-ui.js` as `renderItinItemFull`. 17 cross-references to
  inline globals prefixed `global.X`. Inline desktop's `mkItinItem`
  and `mkDay` are 5-line delegators. `index.html` shrunk by 380
  lines. Regression spec at `tests/playwright/itin-item.spec.js`
  covers every button on every row type. **Two of Item C's biggest
  checkboxes — mkItinItem and mkDay — done.**
- [x] **HX.11 (v307, May 2026):** `_renderMustDoSection` lifted
  into `picker-ui.js` as `MaxPickerUI.renderMustDoSection`.
  Closure deps (`candByPrimary`, `_mdcItems`) lifted to explicit
  args; inline shrunk to a thin delegator. `renderCard` still
  inline (HX.12 lifts it).
- [x] **HX.12 (v308, May 2026):** `renderCard` lifted into
  `picker-ui.js` as `MaxPickerUI.renderCandidateCard`. Closure
  deps (`primaryByCandId`, `_addCandidateMarker`, `_mdcItems`)
  threaded through as args. `_addCandidateMarker` itself stays
  inline because of its closure deps (bounds, _ceMap, _ceMarkers).
  Inline shrunk to a thin delegator.
- [x] **HX.13 (v310, May 2026):** Time-lens draft itinerary
  block lifted to `MaxPickerUI.renderTimeLensItinerary`. Closure
  deps (`activeCands`, `el`, `_mdcItems`, `_tb`) threaded as args.
- [x] **HX.14 (v311, May 2026):** `_renderTripDetailsStrip`
  lifted to `MaxPickerUI.renderTripDetailsStrip`. No closure
  deps — all referenced state lives on globals. Inline shrunk
  to a thin delegator.

**Done when:** `renderCandidateCards` is < 200 lines and reads as
"call engine derivations, dispatch to picker-ui renderers."

**Why item C:** these blocks are where the next inline-only feature
creeps in. Until the seam is drawn, "just add it inline" remains
the path of least resistance.

### Item D — State encapsulation behind engine / picker-ui APIs — ✅ DONE
**State:** done as of v314 (HZ rounds, May 2026).

The original concern — `_tb` and the picker UI globals (`_ceMap`,
`_ceMarkers`, `_ceLens`, `_ceCardExpanded`, `_mdcItems`,
`_ceSelectedCandId`, etc.) freely readable across modules — has
been addressed by adding a clean engine API surface for external
consumers. Internal picker code keeps its locals (no value in
churning ~hundreds of internal call sites) but the boundary is
now real for anyone reading from outside.

**HZ.1 (v312, May 2026)** — Curated read getters on
`MaxEnginePicker`:
- [x] `brief()` — frozen brief snapshot, internal flags excluded
- [x] `candidates()` — frozen array, frozen items
- [x] `requiredPlaces()` — frozen array, frozen items
- The existing `state` getter (returns raw `_tb`) stays as an
  escape hatch but isn't the recommended consumer surface.

**HZ.2 (v314, May 2026)** — Domain setters on `MaxEnginePicker`:
- [x] `setEntry(city)` — title-case + trim + emit `briefChange`
- [x] `setExit(city)` — same, writes `_tb.tbExit`
- [x] `setRegion(name)` — most-consequential brief field
- [x] `setCandidateStatus(id, status)` — wraps inline `setCS` with
  fallback for test contexts
- [x] `startFresh(initial)` — alias for `resetState`

**Done criteria, all met:**
- ✅ External consumers (mobile, future tooling, tests) drive the
  picker via stable verbs, not raw `_tb` mutations
- ✅ External consumers read picker state via curated getters that
  return frozen shapes
- ✅ Internal flags (`_editMode`, `_exitTouched`, `_autoKeepApplied`)
  excluded from public surface
- ✅ Event bus (`on`/`off`/`emit`) lets consumers subscribe to
  changes
- ✅ Engine tests assert frozen-shape contract + setter behavior

**HZ.3+ (deferred, low value):** migration of inline `_tb.X`
reads to `brief()` getter calls. The engine API exists; inline
picker can keep using locals. If/when a future round needs
internal call-site cleanup (e.g. lifting picker code into another
module), that's the trigger.

### Item E — drawTripMode legacy path → fold into Places
**State:** open. Mentioned in `STATE.md` since the original picker/
Places merge. ~30 inline call sites.

**First concrete round (TM.1):** write an audit doc
(`audit-drawTripMode.md`) listing every call site and what it
renders. The audit's the prerequisite — don't start moving anything
until the call graph is on paper.

**Done when:** `drawTripMode` and `drawDestMode` are deleted; the
trip view is the time lens of the picker, period.

**Why item E:** "one surface" was the original goal of the picker/
Places merge. Two surfaces means twice the inline state, twice the
redraw paths, twice the bug surface area.

---

## Definition of "10"

The architecture is a 10 when:

1. `engine-trip.js` has zero DOM references (`document`, `drawXxx`,
   `g(...)`). Every mutator emits an event; the UI layer subscribes.
2. `engine-picker.js` has the picker's state behind a clean API; no
   inline script reaches into `_tb` directly.
3. Mobile shell is shipped. It loads only `db.js` + `engine-trip.js`
   + the mobile UI bundle. It doesn't import anything from
   `picker-ui.js` or `index.html`.
4. `renderCandidateCards` is a thin orchestrator (< 200 lines) that
   reads engine derivations and dispatches to picker-ui renderers.
5. `drawTripMode` is gone. One trip surface.
6. `index.html` is < 15kloc — the inline script is mostly composition,
   not implementation.
7. Engine test count > 200, with a contract test for every public
   `MaxEngineTrip.*` and `MaxEnginePicker.*` function.

We're hitting 1–2 of the seven now.

---

## Working rules for picking up this list

- **Pick the topmost unchecked item.** Items A and B can run in
  parallel; everything else depends on Item A being mostly done.
- **One round per check.** Don't bundle 3 mutator conversions into a
  single round. The whole point is small, reviewable steps.
- **Each round bumps SW.** v284 → v285 → v286. The header block
  describes what shipped.
- **Each round adds tests.** No engine extraction without a test
  pinning the new contract. No event-emit conversion without an
  assert-emit test.
- **Update this file at the end of each round.** Check the box,
  bump the percentages in "Where we are now," add follow-ups
  discovered along the way.

---

## Companion docs (don't duplicate, just point)

- `architecture-engine-ui-split.md` — original 4-phase plan. Item A
  is Phase 2; Item B is Phase 4. Read once for context.
- `architecture.md` — structural principles ("picker owns shape,
  trip owns calendar"). Reference when an extraction's shape is
  unclear.
- `mobile-strategy.md` — what mobile is for (execution surface, not
  planning). Reference when scoping Item B.
- `plan-supabase-migration.md` — sync layer for mobile (Item B's
  prerequisite for "two devices, one trip").
- `design-notes.md` — has the deferred items 1–16, including
  features unrelated to architecture. This file (`path-to-10.md`)
  covers items 12–16 specifically and adds the action plan they
  lacked.
