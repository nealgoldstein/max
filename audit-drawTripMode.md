# Audit — drawTripMode + drawDestMode fold (path-to-10 Item E / design-notes 16)

**TM.1 — May 2026.** Mandatory prerequisite per path-to-10. Maps every
inline call site of `drawTripMode` and `drawDestMode`, what each
function renders, what state they read/mutate, and identifies the
natural seams for incremental folding (TM.2+).

This document is the **specification for the fold**, not the work
itself. Don't move code until each section's "target home" is agreed.

---

## Headline numbers

- **`drawTripMode`** at `index.html:19186` — ~480 lines
- **`drawDestMode`** at `index.html:21730` — ~1200 lines
- **Call-site counts:** 40 calls to `drawTripMode()`, 50 calls to
  `drawDestMode(destId)`, plus 5 in `trip-ui.js`
- **Combined inline LOC under fold:** ~1700

The two functions exist because the picker → trip handoff produces a
"trip" but the current UI splits the user into two modes: an overview
("trip mode") and a detail per destination ("dest mode"). The plan
calls "Item 16" / "Item E" the elimination of that split.

---

## What `drawTripMode` renders

Order matters — each block is a separate concern that may move
independently.

| # | Section | Source lines | Reads | Mutates DOM at |
|---|---------|--------------|-------|----------------|
| 1 | Resets `_leftMode = "trip"`, clears `#lp-content`, hides map style btn, calls `_pushHeroMapUpdate` | 19187–19204 | `_leftMode`, hero-map state | `#lp-content`, `#map-style-btn` |
| 2 | **Dates strip** (date range + total days/nights/dest count + under-budget annotation) | 19209–19257 | `trip.destinations[*].dateFrom/dateTo/nights`, `trip.brief.duration` | inside `c` (lp-content) |
| 3 | **SCAFFOLD-5 Today banner** (during phase only) | 19259–19318 | `currentTripStatus(trip)` | inside `c` |
| 4 | **SCAFFOLD-4 Pre-arrival banner** (before phase only) | 19319–19400 | `preArrivalActions(trip)` | inside `c` |
| 5 | **SCAFFOLD-3 Decisions-deferred panel** | ~19401–19500 | `summarizeDecisionsDeferred(trip)` | inside `c` |
| 6 | **Over-budget action banner** (extend / split / shorten) | scattered | trip duration vs. budget | inside `c` |
| 7 | **Destinations list** — per-destination card via inline `renderCard` (different from picker `renderCard`!) | bulk of body | `trip.destinations[*]` | inside `c` |
| 8 | **Add destination row** + reverse-order button + edit-destinations button | end of body | `trip.candidates`, `trip.mdcItems` | inside `c` |

**Key observation:** items 2–6 are HORIZONTAL strips. They don't
depend on per-destination context — they describe the trip as a whole.
Item 7 is a PER-DESTINATION list. The natural fold splits trip-level
strips from destination cards.

---

## What `drawDestMode(destId)` renders

| # | Section | Reads | Notes |
|---|---------|-------|-------|
| A | Header — back button, "+ Destination", title, dates, edit-dates | `dest.place`, `dest.dateFrom/dateTo`, `dest.nights` | Top of dest panel |
| B | Attached events row | `dest.attachedEvents` | Must-do routes/conditions for this dest |
| C | **Tab bar** — Itinerary / Explore / Stay / Routing / Info / Tracking | `_activeDmSection` | The whole rest is gated by which tab is active |
| D | **Itinerary tab** — auto-injected arrival chip on day 1, then `mkDay(day, destId)` per day, day-trip cards, departure chip on last day | `dest.days[*]`, `dest.dayTrips`, `trip.legs` | Routes through `MaxTripUI.renderDay` / `mkItinItem` |
| E | **Explore tab** — sights section (banner + already-on-days + optional picks), restaurants section, day-trips section | `dest.suggestions`, `dest.restaurantSuggestions`, `dest.dayTrips` | Heavy LLM-driven content |
| F | **Stay tab** — districts + hotels per district + booking forms | `dest.generatedDistricts`, `dest.hotelBookings` | The HX.14-extracted picker `_renderTripDetailsStrip` is a sibling, not the same |
| G | **Routing tab** — arrival + departure transport chips + routing options + bookings | `getLeg`, `getRouting`, `dest.generalBookings` | Most complex tab |
| H | **On the ground tab** — practical info (currency, tipping, emergency) + essentials (atms, groceries, etc.) | `dest.generatedPracticalInfo`, `dest.suggestions` filtered to essentials | Steady-state info |
| I | **Tracking tab** — booked/see/visited buckets per dest | `dest.trackerItems`, `dest.trackerCat` | Lightweight check-list view |

**Key observation:** drawDestMode is fundamentally a **tab container**
where each tab is a separate rendering concern. The fold could move
each tab to a peer surface in the unified Places page, OR keep them as
panels inside a destination row in the trip view.

---

## What "Places page time lens" actually means

The original picker/Places merge intended the candidate explorer's
**time lens** (`_ceLens === "time"`) to be the canonical trip view —
not a separate `drawTripMode`. After the picker, the user was meant to
stay on the Places page with the lens switched to "time order," and
the "trip" would just be the curated set of kept candidates rendered
in sequence.

Today, that's not what happens. After the picker, control transfers
to `drawTripMode`, a separate function with its own DOM target
(`#lp-content`) and its own card rendering. The Places page is gone
once the trip is built.

**The fold's premise:** put the trip view back inside the Places page,
with the time lens enriched to show what `drawTripMode` shows today
(per-destination cards with the same affordances). Eliminate
`drawTripMode` and `drawDestMode`; rewire callers to re-render the
Places page time lens.

---

## Call-site categorization

`drawTripMode()` — 40 calls in `index.html`. Categories:

| Category | Count | Examples |
|---|---|---|
| **Mode switches** (trip ↔ dest) | ~6 | `_leftMode="trip"; drawTripMode()` after dest delete, after reverse, after picker close |
| **Post-mutation re-renders** | ~22 | After `addBufferNight`, `applyDateChange`, `_mergeAdjacentSamePlaceDests`, etc. (most of these now go through `_emitTripMutation`'s tripChange listener) |
| **Initial mount** | ~3 | `enterApp()`, `selectTrip()`, `localLoad()` paths |
| **Conditional re-render** | ~5 | `if (_leftMode === "trip") drawTripMode(); else drawDestMode(activeDest)` |
| **Defensive try/catch** | ~4 | `try { drawTripMode(); } catch(_){}` after async data lands |

`drawDestMode(destId)` — 50 calls in `index.html` + 5 in `trip-ui.js`.
Categories:

| Category | Count | Examples |
|---|---|---|
| **Mode switches** | ~3 | `selectDest(id)` → drawDestMode |
| **Post-mutation re-renders** | ~35 | After every dest-level mutation: hotel book, sight done, daytrip add, note edit, etc. Each lives inline next to its mutator. |
| **Conditional re-render** | ~10 | Used pervasively by sub-renderers that don't know if user is on this dest |
| **Lifted in trip-ui.js** | 5 | `renderItinItemFull` calls back into `global.drawDestMode` for re-render after time-edit, done-toggle, etc. |
| **Async-completion re-render** | ~3 | `ensureCoarseGeocode` callback, `generateCityData` success |

**Key observation:** the post-mutation re-render category (~22 + ~35
= 57 calls) is the **biggest sink**. Every mutation imperatively asks
the right view to redraw itself. The HY round (Item A, Phase 2 events)
moved trip mutators onto an event bus, but most call sites still
inline the redraw rather than relying on the listener.

If TM.x ships an event-driven Places-page renderer that subscribes to
`tripChange`, **all 57 of those call sites can be deleted** — the
listener fires once, the Places page re-renders.

---

## Natural seams (recommended fold sequence)

### TM.2 — Move the trip-level strips out of `drawTripMode` — ✅ DONE (v316)

The dates strip, Today banner, pre-arrival banner, and decisions
panel lifted into `trip-ui.js` as `MaxTripUI.renderTripDatesStrip`,
`renderTodayBanner`, `renderPreArrivalBanner`,
`renderDecisionsDeferredPanel` plus the
`renderTripOverviewStrips(trip, container)` coordinator. drawTripMode
now calls the coordinator once instead of running four IIFEs. ~290
lines became 1 line; same visual output.

The over-budget action banner stays inline for now — it's scattered
across drawTripMode rather than a single IIFE, and it depends on
fix-it actions that need their own engine surface (extend trip,
shorten, split). Will be picked up in a later round when those
actions get formalized.

After TM.2, `drawTripMode` is mostly "render destination cards" —
much smaller surface for the bigger TM.3 move (per-card expansion).

### TM.3 — Lift remaining drawTripMode pieces, then per-card expansion

**TM.3a (v317, May 2026) — DONE.** FQ geographic-affordance banner
lifted into `MaxTripUI.renderGeoAffordanceBanner`, added to the
overview-strips coordinator.

**TM.3b (v318, May 2026) — DONE.** Destinations-list header
(label + total line + Reverse Order + Edit Destinations buttons)
lifted into `MaxTripUI.renderDestinationsListHeader`. Returns
the populated tm-section div; drawTripMode continues to append
destination cards to it.

**TM.3c (v319, May 2026) — DONE.** Two dead `if (false)` IIFEs
for buffer-night banners deleted. Round GA.1 had retired the
auto-create that populated them; ~150 lines of unreachable code
removed.

**TM.3d (v320, May 2026) — DONE.** Arrival/Departure logistics
panel (~165 lines) lifted into
`MaxTripUI.renderArrivalDeparturePanel`. The Apply button still
triggers a trip rebuild via `buildFromCandidates`; logistics
expand/collapse, auto-fill departure-from-arrival, and titlecase
on blur all preserved.

**TM.3e (v321, May 2026) — DONE.** The 408-line per-destination
card render body extracted into an inline helper
`_renderTmDestCard(dest, idx)` defined inside drawTripMode. The
forEach loop calls the helper. Same closure scope — no global
prefixing needed yet — but the structural seam exists for
TM.3f to lift the body into trip-ui.js cleanly when that round
runs.

**TM.3f — ✅ DONE.** `MaxTripUI.renderTripDestinationCard` lives
at `trip-ui.js:3740` and is exposed on the namespace at
`trip-ui.js:9089`. Inline `index.html:45247` is a thin delegator.
The prefix-substitution work happened in this round. Verified
against code May 31 2026.

**TM.3g (later) — Per-card expansion UX.** After TM.3f lands, the
natural follow-up is to expand the card in place instead of
swapping to drawDestMode. Each destination card grows to show its
tab content when "open" and collapses when not. This eliminates
the trip-vs-dest mode switch. Needs a UX sketch first.

### TM.4 — Subscribe the unified renderer to `tripChange`

Once steps 2 and 3 are done, the unified renderer becomes the single
listener for `tripChange`. Delete the 57 inline `drawTripMode()` /
`drawDestMode()` post-mutation calls.

### TM.5 — Remove `drawTripMode` and `drawDestMode`

By this point both functions are reachable only by initial-mount
paths (mode-switch isn't a thing anymore). Replace with a single
`renderTripPage()` and delete the originals.

### TM.6 — Audit + delete dead code

After the fold, hunt down anything that branched on `_leftMode`. The
flag itself can probably go.

---

## Risks

1. **Tab state.** `_activeDmSection` (which tab is open per dest) is
   a single global flag — if multiple cards can be expanded, it
   becomes per-dest state. Easy refactor but a real change.
2. **Map state.** The right-panel map knows the difference between
   "trip mode" (show all dest pins) and "dest mode" (zoom to one
   dest's sights). With per-card expansion, the map needs new
   semantics: maybe "show whichever dest is currently expanded, or
   all if none."
3. **Scroll position preservation.** drawDestMode has elaborate
   re-render scroll preservation (lines 21731–21753). The new
   in-place expansion must preserve scroll too — different mechanism
   but same requirement.
4. **Lazy sub-renderers.** Some sections (city-data fetch,
   restaurant suggestions, hotel district fetch) are async and
   trigger re-renders on completion. Each fires `drawDestMode`
   today; they'd need to fire the unified renderer instead, or
   render to their slot directly without a full redraw.

---

## Estimate

- TM.2 (trip-level strips lift): **2–3 sessions**. Each strip is
  contained.
- TM.3 (per-card expansion): **3–5 sessions**. The biggest UX
  change. Tab content moves into expanded card body. Risk #1, #2,
  #3 land here.
- TM.4 (event-bus subscription): **1 session** if the listener is
  clean.
- TM.5 (delete legacy): **1 session**.
- TM.6 (cleanup): **1 session**.

**Total: 8–11 sessions, depending on how cleanly TM.3 lands.**

This matches the design-notes "multi-month" estimate when measured
in calendar time.

---

## What this audit does NOT decide

- Whether per-card expansion is the right UX (vs. another
  affordance, e.g. modal panel, split-pane). TM.3 needs a UI sketch
  before code.
- Whether the picker's candidate explorer should also unify with the
  same Places page. The current scope is "trip view, post-build."
  Folding the picker too is a separate later question.
- Mobile's role. Mobile renders its own way and isn't affected by
  any TM round directly.

---

## Sign-off (for future-me)

This audit is good enough to **start** TM.2. Don't do TM.3 without a
UX sketch first. The 57 inline `drawTripMode/drawDestMode` calls are
the biggest tax-debt under the fold; eliminating them via TM.4 is the
single biggest win, achievable only after TM.2 and TM.3 are stable.

---

## Status reconciliation — May 31 2026 (v360.4)

Verified against code. TM.1 through TM.3f all shipped. The skeleton
of TM.5 also exists in code: `MaxTripUI.renderTripPage(trip, opts)`
at `trip-ui.js:7441` is the would-be unified renderer — but when
`opts.expandedDestId` is set it just calls `global.drawDestMode(id)`
(line 7458), so the legacy functions are still doing the work. Call
counts now: `drawTripMode()` 47 sites, `drawDestMode(...)` 33 sites
(picker + per-card lift moved some redraws to listeners; new product
features added others).

**Live next round is still TM.3g** — per-card expansion UX. The
sketch is the gating artifact, not a code change.
