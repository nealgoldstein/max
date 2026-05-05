# Path to 10

Single source of truth for "what's left on the architecture refactor."
Open this when you sit down and want to know the next move. Update it
when you ship a round (check a box, add a follow-up).

---

## Where we are now

**Score: ~6.5 / 10.** Up from a 3 (single 24kloc inline file) but
short of where the original engine/UI split plan
(`architecture-engine-ui-split.md`) was headed.

What's solid:
- Pure logic lives in engines and is tested. 136 tests, well-named
  contracts.
- DB seam exists (`db.js`, Round HA). Picker → trip handoff goes
  through it (Round HM).
- Picker has a UI module (`picker-ui.js`); the cleanest standalone
  DOM blocks have moved.

What's missing keeps coming back to one thing: **`engine-trip.js`
isn't actually DOM-free yet** (Phase 2 of the plan is half-done) —
which means mobile, the abstraction's whole reason to exist, can't
consume it. Until mobile is real, the architecture is asserted, not
proven.

---

## The five items, in priority order

### Item A — Finish Phase 2 (trip-engine event system)
**State:** ~30% done.
`replaceTrip` emits `tripChange`. ~12 other trip mutators still call
`drawTripMode` / `drawDestMode` / `updateMainMap` directly. Each is
~30–60 minutes of work: state mutation, emit event, drop the inline
DOM call, add a unit test that asserts the emit.

**The 12 mutators (search by name to find them):**
- [ ] `_ftSchedulePeerDayTrip`
- [ ] `addDayTripToDay`
- [ ] `removeDayTripFromDay`
- [ ] `removeDayTripFromDayItem`
- [ ] `makeDayTrip`
- [ ] `ungroupDayTrip`
- [ ] `addBufferNight`
- [ ] `reverseTripOrder`
- [ ] `executeMoveDest`
- [ ] `delDest`
- [ ] `applyDateChange`
- [ ] `_ftReverseNightTransfer` (already pure — verify it doesn't drift)

**First concrete round (HY.1):** convert `addBufferNight`. Smallest
clean target. Add `MaxEngineTrip.addBufferNight` if not present, emit
`tripChange` + `mapDataChange`, drop the inline `drawTripMode +
updateMainMap` calls, and add an engine test that asserts both events
fire with the right payload. After HY.1 lands, repeat the pattern for
the next mutator (HY.2, HY.3, …).

**Done when:** all 12 mutators emit; no TE* function in
`renderTripMode`'s call tree references DOM helpers; `engine-trip.js`
has zero references to `document`, `drawXxx`, or `g(...)`.

**Why this is item A:** every other item depends on this. Mobile
needs it. State encapsulation needs it. drawTripMode removal needs
it.

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

### Item C — Big DOM blocks still inline in renderCandidateCards
**State:** open.

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
- [ ] **HX.11:** `_renderMustDoSection` (~120 lines). Per-must-do
  section: header, drop button, route arrow, endpoint highlights,
  empty-state hint, cards. Calls `renderCard`, `_addCandidateMarker`,
  `_dropActivity`. Reads `_ceSectionExpanded`. Most internal state is
  local to the function.
- [ ] **HX.12:** `renderCard` (~200 lines). Per-candidate card
  renderer. Compact + expanded modes. Multi-state badges, keep/reject
  buttons, alsoHere chip, comparison. The biggest single block.
- [ ] **HX.13:** Time-lens draft-itinerary rendering (~80 lines).
  Travel legs inferred between adjacent stops, route-pair lookup
  table, day-numbered headers when dates are set.
- [ ] **HX.14:** `_renderTripDetailsStrip` (~150 lines). Entry/exit
  form + transportation pill row. The blur-to-pan logic from the
  v283 patch lives here.

**Done when:** `renderCandidateCards` is < 200 lines and reads as
"call engine derivations, dispatch to picker-ui renderers."

**Why item C:** these blocks are where the next inline-only feature
creeps in. Until the seam is drawn, "just add it inline" remains
the path of least resistance.

### Item D — State encapsulation behind engine / picker-ui APIs
**State:** open.

The picker's globals are a flock: `_tb`, `_ceMap`, `_ceMarkers`,
`_ceLens`, `_ceCardExpanded`, `_mdcItems`, `_epCache`, `_edMarkers`,
`_edActivePopupId`, `_tbEntryPointsVisible`, `_initBounds`,
`_initCenter`, `_initZoom`, `_ceSelectedCandId`, `_ceMarkerById`,
`_ceRejectedExpanded`, `_tripDetailsExpanded`. Shared mutable state
across `index.html`, `engine-picker.js`, `picker-ui.js`.

**First concrete round (HX.15 or after items A/B/C):**
- [ ] Push picker draft state behind `MaxEnginePicker.set/getField`.
  Already partly true — `MaxEnginePicker.state` is a getter; tighten
  by making the inline script use the API instead of touching `_tb`
  directly.
- [ ] Push picker UI state (`_ceMap`, `_ceMarkers`, `_ceLens`, …)
  behind `MaxPickerUI.mapState` / `MaxPickerUI.viewState`.
- [ ] Push entry-point cache (`_epCache`, `_edMarkers`,
  `_edActivePopupId`) behind `MaxPickerUI.entryPoints`.

**Done when:** `grep -n "_ceMap\|_tb\b\|_mdcItems" index.html`
returns near-zero hits (only the engine API surface).

**Why item D:** module boundaries don't mean much when every module
can reach into another module's globals. Encapsulation is the
"is the engine layer real?" test.

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
