# Architecture: two engines + a trip database

**Goal:** restructure Max into three layers — a **picker engine** that
generates trip possibilities, a **trip engine** that owns the live
trip and its mutations, and a **trip database** that is the single
source of truth they both read and write. Two UIs (desktop, mobile)
consume the engines through the same database.

The engines do not call each other. The picker engine publishes a
trip to the database; the trip engine loads it from the database.
The handoff is data, not code coupling.

This document is the plan, not the implementation.

---

## Why now

- No live users, so backwards-compatible refactoring isn't a constraint.
- Mobile is the next major effort. Mobile only needs the trip engine
  (execution), not the picker. The current monolith forces the
  mobile build to drag the picker along or duplicate trip logic —
  both bad.
- The codebase is ~24kloc in a single file. New features now cost
  more friction than they should. Cleaner separation pays off in
  feature-development speed too.

---

## The three layers

```
   ┌─────────────────────┐         ┌─────────────────────┐
   │   Picker engine     │         │    Trip engine      │
   │                     │         │                     │
   │ - brief in flight   │         │ - active trip       │
   │ - candidates        │         │ - mutations         │
   │ - keep/reject       │         │ - day-trip schedule │
   │ - generate / expand │         │ - buffer / reverse  │
   │ - publishTrip()     │         │ - move / remove     │
   └──────────┬──────────┘         └──────────┬──────────┘
              │ writes                         │ reads + writes
              ▼                                 ▼
        ┌────────────────────────────────────────────┐
        │           Trip database                    │
        │                                            │
        │ - trips (full state per trip)              │
        │ - candidate sets (per trip, picker output) │
        │ - drafts (picker in-flight, optional)      │
        │ - index (for home screen)                  │
        │                                            │
        │ Today: localStorage + IDB                  │
        │ Tomorrow: Supabase                          │
        └────────────────────────────────────────────┘
              ▲                                 ▲
              │ subscribes                       │ subscribes
   ┌──────────┴──────────┐         ┌──────────┴──────────┐
   │   Picker UI         │         │    Trip UI          │
   │ (desktop only)      │         │ (desktop + mobile)  │
   └─────────────────────┘         └─────────────────────┘
```

The picker engine and the trip engine never call each other. They
share a schema, not a function table.

---

## Trip database (first cut)

The DB is its own layer with a thin API. Today it wraps localStorage
+ IDB; tomorrow it wraps Supabase. The engines never reach past the
DB API into storage internals.

### Schema sketch

```
trip {
  id                : string         // uuid or slug
  createdAt         : timestamp
  updatedAt         : timestamp
  brief             : { destination, party, dates, duration, ... }
  destinations      : Destination[]
  legs              : { [fromId-toId]: Leg }
  candidates        : Candidate[]    // last published picker output
  pendingActions    : PendingAction[]
  absorbedStash     : Place[]        // FZ.6 stash
  geoAffordance     : { verdict, transitInfo, ... }
}

draft {
  tripId            : string         // null if new trip in flight
  brief             : partial brief
  tbState           : full _tb snapshot
  updatedAt         : timestamp
}

index {
  trips: [{ id, name, dateFrom, dateTo, status }]
}
```

The `candidates` field on a trip is the picker's output, persisted
with the trip. Reopening the picker for an existing trip loads
these candidates back. (Today this is the `_tb` rehydration glue,
which becomes explicit DB shape.)

### DB API

```
DB.trip.create(brief)              → trip
DB.trip.read(id)                   → trip
DB.trip.update(id, mutator)        → trip
DB.trip.delete(id)                 → void
DB.trip.list()                     → [{id, name, ...}]   // home screen

DB.draft.read(tripId | null)       → draft
DB.draft.write(tripId | null, d)   → void
DB.draft.delete(tripId | null)     → void

DB.cache.llm.get(key)              → response | null
DB.cache.llm.set(key, response)    → void
DB.cache.geocode.get(name)         → [lat,lng] | null
DB.cache.geocode.set(name, coords) → void

DB.on('tripWritten', cb)           // both engines listen
DB.on('tripDeleted', cb)
DB.on('draftWritten', cb)
```

`tripWritten` is the cross-engine signal: when the picker publishes,
the trip engine wakes up. The engines stay decoupled but stay in sync.

---

## Picker engine

Owns the workflow that produces a trip. Its terminal action writes
to the database and clears its working state.

### State (engine-internal)

- in-flight brief fields (destination, party, dates, duration)
- `_tb.candidates[]` — places under consideration
- `_tb.placeName`, `_tb.placeContext` — current place + region
- `_tb.entry`, `_tb.tbExit` — gateway / departure cities
- `_tb.requiredPlaces` — must-do anchors
- `_mdcItems[]` — must-do items list
- `category` cursor — which category is being browsed
- session flags — disclaimer dismissed, etc.

### API

```
Picker.start(name)                          // begin a fresh draft
Picker.reopenForTrip(tripId)                // load candidates from DB

Picker.setBrief(field, value)
Picker.generateCandidates()                 // async; LLM
Picker.setCandidateStatus(id, status)       // keep | reject | clear
Picker.adjustNights(id, delta)
Picker.expandSection(category)              // "+ more like this"
Picker.removeFromTrip(id)                   // un-keep

Picker.publishTrip()         → tripId       // writes to DB; clears state
Picker.cancel()                             // discards draft

Picker.state                                // read-only snapshot
Picker.on('candidatesChange', cb)
Picker.on('briefChange', cb)
Picker.on('published', cb)                  // fires after DB write
```

`publishTrip()` is the boundary: until called, no trip exists. Once
called, a trip row is in the DB and the picker is done. The trip
engine takes over.

---

## Trip engine

Owns everything that happens to a trip after it exists. Loads from
DB, mutates, writes back. Auto-saves debounced.

### State (engine-internal)

- `activeTrip` — the loaded trip object
- `activeDestId` — UI focus
- `verdictMemo`, `transitInfoMemo` — geographic-affordance caches

### API

```
Trip.load(tripId)
Trip.unload()
Trip.state.trip                             // read-only snapshot
Trip.state.activeDestId

// Mutations (each emits 'tripChange', auto-saves)
Trip.scheduleDayTrip(hubId, targetId, dayIdx)
Trip.cancelDayTrip(hubId, place)
Trip.removeDayTripFromDay(hubId, place, dayIdx)
Trip.addBufferNight(side, city)             // 'arrival' | 'departure'
Trip.reverseOrder()
Trip.moveDestination(fromIdx, toIdx)
Trip.removeDestination(destId)
Trip.editDestinationDates(destId, from, to)
Trip.editDestinationLabel(destId, label)
Trip.adjustNights(destId, delta)
Trip.makeDayTrip(hubDestId, srcDestId)
Trip.ungroupDayTrip(hubDestId, chipIdx)
Trip.setActive(destId)

// Queries (read-only)
Trip.peerDayTripCandidates(hubId, thresholdHours)
Trip.verdict()
Trip.totalNights() / totalDays()
Trip.dayTripDayIdx(hubId, place)
Trip.canTakeDayTripFrom(hubId, targetId)
Trip.transitInfo(placeA, placeB)            // async

Trip.on('tripChange', cb)
Trip.on('mapDataChange', cb)
Trip.on('absorbedChange', cb)
```

The trip engine never reads the picker's working state. If the user
re-edits the trip via the picker, the picker republishes and the
trip engine's `tripWritten` listener calls `Trip.load(tripId)`.

---

## UI layer

Pure rendering + event handling. Two surfaces:

**Picker UI** (desktop only): `renderCandidateCards`, brief forms,
place picker map, category nav, disclaimer modal. Subscribes to
`Picker.on('candidatesChange' | 'briefChange')`. Calls
`Picker.xxx()` on user actions.

**Trip UI** (desktop + mobile): `drawTripMode`, `drawDestMode`,
`buildExplorePane`, hero map, main map, itinerary builders, banners,
toasts. Subscribes to `Trip.on('tripChange' | 'mapDataChange')`.
Calls `Trip.xxx()` on user actions.

**Home screen**: lists trips via `DB.trip.list()`. Subscribes to
`DB.on('tripWritten' | 'tripDeleted')`.

UI never reaches into engine internals. UI never calls the DB
directly for trip data — it goes through the engine. (UI can call
`DB.trip.list()` for the home screen because no engine owns the
list.)

---

## Function classification (current code)

Tagged as:

- **PE** — picker engine
- **TE** — trip engine
- **DB** — database layer
- **U** — UI
- **PE\*** / **TE\*** — engine logic with `drawXxx()` at tail; needs split
- **M** — mixed; needs decomposition

### Picker engine

| Function | Class | Notes |
|---|---|---|
| `runCandidateSearch` | PE | Async; LLM. |
| `expandMustDos` | PE | LLM. |
| `findCandidates` | PE | LLM. |
| `orderKeptCandidates` | PE | Pure ordering. |
| `_findMatchingRequired` | PE | Pure. |
| `geocodeMissingCandidates` | PE | Async. |
| `parseStartDateFromBrief` | PE | Pure. |
| `parseNightsFromRange` | PE | Pure. |
| `_normPlaceName` | PE | Pure. |
| `_titleCaseCity` | PE | Pure. |
| `renderCandidateCards` | U | DOM. |
| `_renderPickerCategoryNav` | U | DOM. |
| `mkExploreSuggestion` | U | DOM. |
| `showCandidateDisclaimer` | U | DOM/sessionStorage. |
| `_renderTripDetailsStrip` | U | DOM. |
| `renderTripBrief` | U | DOM. |
| `renderTripStep1Place` | U | DOM. |
| `_renderPlacePickerMap` | U | Leaflet. |
| `buildFromCandidates` | M | Splits: `Picker.publishTrip()` (writes to DB) + `Trip.load()` (engine listens for `tripWritten`) + UI bridge transition. |

### Trip engine

| Function | Class | Notes |
|---|---|---|
| `_ftHaversineKm` | TE | Pure math. |
| `_ftPairKey` | TE | Pure. |
| `_ftFastestPractical` | TE | Pure. |
| `_ftComputeVerdict` | TE | Async (LLM). |
| `_fqVerdictForPlaces` | TE | Memo wrapper. |
| `_fqBannerInnerHtml` | U | Returns HTML string. |
| `_ftRecomputeTripDates` | TE | Pure mutation. |
| `_ftResizeDestDays` | TE | Pure mutation. |
| `_mergeAdjacentSamePlaceDests` | TE | Pure mutation. |
| `_ftSchedulePeerDayTrip` | TE\* | Currently calls `drawDestMode` + `updateMainMap`. |
| `_ftReverseNightTransfer` | TE | Pure mutation. |
| `_ftPeerDayTripCandidates` | TE | Read-only query. |
| `addDayTripToDay` | TE\* | Calls `drawDestMode`. |
| `removeDayTripFromDay` | TE\* | Calls `drawDestMode`. |
| `removeDayTripFromDayItem` | TE\* | Calls `drawDestMode`. |
| `makeDayTrip` | TE\* | Calls `drawDestMode`. |
| `ungroupDayTrip` | TE\* | Calls `drawTripMode`. |
| `addBufferNight` | TE\* | Calls `drawTripMode` + `updateMainMap`. |
| `reverseTripOrder` | TE\* | Calls `drawTripMode` + `updateMainMap`. |
| `executeMoveDest` | TE\* | Calls `drawTripMode` + `updateMainMap`. |
| `delDest` | TE\* | Calls `drawTripMode`. |
| `_reconcileDestinations` | TE | Complex but no DOM. |
| `_reEvaluateOverBudget` | TE | Pure recompute. |
| `applyDateChange` | TE\* | Calls `drawTripMode`. |

### Database layer

| Function | Class | Notes |
|---|---|---|
| `callMax` | service | Wrap behind `DB.cache.llm` plus a network client. |
| `_maxCacheLoad` / `_maxCacheSave` | DB | Cache layer. |
| `_maxIdbGet` / `_maxIdbSet` | DB | IDB primitives. |
| `geocodeMissingCoords` | service | Engine calls this. |
| `ensureCoarseGeocode` | service | Engine calls this. |
| `autoSave` / `localSave` | DB | Trip persistence. |
| `loadTrip` / `cleanupOrphanedTrips` | DB | Trip persistence. |

### UI

Everything in `drawTripMode`, `drawDestMode`, `buildExplorePane`,
`mkItinItem`, `mkSight`, `mkHotelRecord`, `mkGeneralRecord`, all
banners, toasts, popups, the picker UI, all map renderers.

---

## Migration path

### Phase 0 — Define the DB API and schema (1 day)

Write `db.js` with a thin API matching the schema sketch above.
Initially it just wraps the current `localStorage` + IDB calls
under a clean surface. No engine work yet.

This forces the schema decision early. The schema is the contract
between the two engines; getting it right is the whole point.

### Phase 1 — Pure helpers to engine modules (1-2 days)

Create `engine-trip.js` and `engine-picker.js`. Move all **TE** /
**PE** functions classified as pure into them. No behavior change;
the inline script still references them by the same names.

Wins: validates the file-split mechanism, catches accidental DOM
dependencies you didn't know about.

### Phase 2 — Trip engine event system (3-5 days)

Add `Trip.state`, `Trip.on/off`, and emit `tripChange` from each
trip mutator. Keep the global `trip` variable as an alias
(`window.trip = Trip.state.trip`) so legacy code keeps working.

Refactor each `TE*` mutator to:
1. Do the mutation.
2. Emit `tripChange` (and `mapDataChange` if relevant).
3. **Stop calling** `drawTripMode` / `drawDestMode` / `updateMainMap`.

Wire UI subscription:
```
Trip.on('tripChange', () => {
  if (_leftMode === 'trip') drawTripMode();
  else if (_leftMode === 'dest') drawDestMode(activeDest);
});
Trip.on('mapDataChange', () => updateMainMap());
```

This is the highest-risk step. Each `drawXxx` call needs to be
evaluated: does the central subscription handle it, or does the UI
need something more specific (scroll, focus, etc.)?

### Phase 3 — Picker engine + DB-mediated handoff (3-5 days)

Same pattern, applied to the picker. Add `Picker.state`,
`Picker.on/off`. The big change: replace `buildFromCandidates`'s
direct mutation of `trip` with `Picker.publishTrip()` → DB write
→ `tripWritten` event → `Trip.load()` → `tripChange` event → UI
shows trip view.

The hairy 600-line function decomposes into three named, separately-
testable steps. The "hairy integration point" disappears.

### Phase 4 — Mobile UI as second consumer (open-ended)

Mobile loads `db.js` + `engine-trip.js` + a thin mobile UI. Does
not load `engine-picker.js` (decision: picker stays desktop-only).
Subscribes to `Trip.on('tripChange')`, calls trip engine for
actions, syncs through DB to Supabase. Same domain as desktop,
same `sw.js`, served from a `/mobile` subdir.

---

## Decisions to make

1. **DB schema fidelity.** Should the DB store a "fully baked" trip
   (current shape: destinations with computed dates, days, items)
   or a "source-of-truth" trip (just the brief + candidates +
   user mutations as a log) and recompute the baked form on load?
   **My read:** store baked. Simpler, matches current behavior,
   re-derivation is a separate concern.

2. **Where does `_tb` rehydration live?** Today, "Edit
   constraints" / "Edit destinations" rehydrate `_tb` from `trip`
   to relaunch the picker. Under the new model, that's
   `Picker.reopenForTrip(tripId)` reading the trip's persisted
   `candidates` array. Cleaner, but means trip MUST persist a full
   candidate set, not just the kept ones. **Decision:** persist
   all candidates (kept + rejected + cleared) on the trip row.

3. **State immutability.** `Trip.state.trip` as frozen snapshot or
   live-mutable? **My read:** start live-mutable, freeze later if
   bugs surface. Frozen is the right end state.

4. **Event granularity.** `tripChange` for everything, or fine-grained
   (`destinationsChange`, `briefChange`, etc.)? **My read:** start
   coarse, add finer events when a UI surface needs to react to a
   specific kind of change without re-rendering everything.

5. **Persistence timing.** Auto-save on every mutation (debounced
   internally) — keep current behavior.

6. **Module system.** Plain `<script>` with namespace globals or ES
   modules with `<script type="module">`? **My read:** ES modules.
   Universal browser support, cleaner imports, scales to mobile build.

7. **LLM mocking for tests.** `DB.cache.llm` is one chokepoint;
   `Picker` and `Trip` can also expose `injectService('llm', mockFn)`.
   **My read:** mock at the network client layer (one level below
   the cache), so tests exercise the real cache path too.

---

## Risks I see

- **Schema drift between today's trip object and the DB schema.**
  Current `trip` has accumulated fields over many rounds (e.g.,
  `_absorbedDayTripPlaces`, per-dest `_entryStop`/`_exitStop` flags,
  `pendingActions`, `mdcItems`). The schema needs to enumerate
  these explicitly so nothing's silently dropped on save/load.
  Mitigation: write a `validateTripShape()` in the DB layer that
  flags unknown fields.

- **Reconcile path is fragile.** Round DW comments document a
  multi-round saga. Refactoring it without a regression suite is
  risky. Best to write tests against current behavior FIRST, then
  refactor with the tests as a guard.

- **`_tb` is referenced everywhere.** It's the picker's working
  state AND the rehydration source for several trip-view rebuild
  paths (Edit destinations, Constraints edit, Apply arrival/departure).
  Untangling this is half the picker extraction's work, but the
  new model gives it a clear destination: `Picker.reopenForTrip`.

- **Map state is global.** `_mainMap`, `_ceMap`, `_tripHeroMapWindow`
  are module-level. UI owns these, but engines trigger re-renders
  via `mapDataChange`. The handshake needs to be clean — engines
  don't know map exists; UI translates events to map updates.

- **Race conditions on `tripWritten`.** Picker publishes →
  `tripWritten` fires → trip engine listens and calls `Trip.load()`
  → trip UI rerenders. If publish and load aren't atomic, UI can
  briefly show stale state. Mitigation: have `Picker.publishTrip()`
  await `Trip.load()` before resolving.

---

## What I'd actually do first

1. **Today:** write `db.js` with the schema and API. Wrap the
   current `localStorage` + IDB calls behind it. No engine work
   yet; this just gives us a clean storage surface to point at.

2. **Tomorrow:** create `engine-trip.js` and move pure trip helpers
   into it (Phase 1). Same for `engine-picker.js` (pure picker
   helpers).

3. **Then:** trip engine event system (Phase 2). One mutator at a
   time, validating each doesn't break the desktop UI.

4. **Then:** picker engine + DB-mediated handoff (Phase 3). The
   `buildFromCandidates` decomposition is the centerpiece.

5. **Mobile starts** when Phase 2 is done. Even if Phase 3 isn't,
   mobile can consume the trip engine; picker stays desktop-only
   initially.

6. **Tests come along for the ride.** Each engine method gets a
   unit test as it's extracted. Playwright runs against desktop UI
   for end-to-end. By the end, the engines have real coverage.

---

## Decisions (resolved with Neal)

- **Mobile picker:** never — desktop-only for the foreseeable future.
  Picker engine can stay slightly DOM-aware where convenient (e.g.,
  a category-nav helper that touches the DOM is acceptable). The
  trip engine, by contrast, must be DOM-free since mobile consumes it.

- **Service worker scope:** same `sw.js` for both UIs. Implies single
  domain.

- **Hosting:** open — Neal hasn't decided. My recommendation: single
  Netlify site with subdirs (`/desktop`, `/mobile`), each with its
  own `index.html` that loads the appropriate UI bundle. Both pull
  from the same `engine-trip.js`, `db.js`, and `sw.js`. One Supabase
  project. Same auth scope. Cheapest path; reverse later only if
  there's a concrete reason. Worth confirming before mobile work
  starts but doesn't block the engine refactor.

- **Server-side logic:** keep engines client-side. No stored
  procedures (too hard to manage). Supabase Row Level Security
  handles auth; edge functions only if multi-user sharing demands
  it later. The engine layer is the entire engine; the DB is a
  storage layer, not a logic layer.

- **Multi-trip workflow:** lazy-load. No in-UI trip switcher. User
  navigates back to home → home shows trip list (via `DB.trip.list()`)
  → clicking a trip calls `Trip.load(id)` → trip view renders.
  Single active trip at any time.

---

## What this document is and isn't

It IS:
- A real plan for a real refactor.
- Concrete enough to start work from.
- Honest about effort and risk.

It IS NOT:
- A specification — implementation will reveal things this doc
  missed.
- A schedule — calendar dates depend on whether refactoring
  happens between feature work or as a focused pass.
- A guarantee that the abstraction is right — we'll learn whether
  the engine APIs and DB schema work by trying to build mobile
  against them.

The first piece of feedback that says "this API is wrong" or "this
schema is wrong" should trigger a redesign, not a stretch. Better
to find out at Phase 0 than at Phase 4.
