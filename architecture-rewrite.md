# Architecture rewrite — state consolidation

Status: Design (Phase 0), code in progress (Phase 1)

## The bug class we are eliminating

Every bug we hit in the destination-loss / stale-banner / fold-not-persisting saga is the same shape: state lives in many places, no single mutator owns each transition, renders capture stale snapshots, parallel arrays drift out of sync. There is no canonical "current trip" — there are 4-5 partial copies and a handful of caches.

This rewrite establishes:
1. **One trip object** as the canonical in-memory state.
2. **Named mutators** as the only way to change that state. Each emits `tripChange` and auto-persists atomically.
3. **Subscribed renders** that re-run on `tripChange` against current state.
4. **Schema versioning** with explicit migrations on load.

After the rewrite, the bug classes we fought become impossible by construction.

## The new architecture

```
┌──────────────────────────────────────────────────┐
│  Storage layer (MaxDB + MaxSync)                 │
│  - Envelope: { trip, _schemaVersion, __saved__ } │
│  - Migrations on load                            │
│  - Atomic writes only                            │
└──────────────────────────────────────────────────┘
                  ↑↓ load(id) / persist()
┌──────────────────────────────────────────────────┐
│  TripStore — the only thing that owns trip state │
│                                                  │
│  Reads:                                          │
│    TripStore.trip                                │
│                                                  │
│  Mutators (every state change):                  │
│    TripStore.setDestinations(newDests)           │
│    TripStore.replaceDestination(id, dest)        │
│    TripStore.setPlaceActivities(...)             │
│    TripStore.setBrief(brief)                     │
│    TripStore.setName(name)                       │
│    TripStore.publish(buildOutput)                │
│    TripStore.load(id)                            │
│    TripStore.mint(initialBrief)                  │
│    ... (one per legitimate transition)           │
│                                                  │
│  Each mutator:                                   │
│    1. Mutates _trip                              │
│    2. Bumps _trip._version                       │
│    3. Calls _persist() (writes to MaxDB)         │
│    4. Emits tripChange                           │
│                                                  │
│  Subscriptions:                                  │
│    TripStore.on('tripChange', cb)                │
└──────────────────────────────────────────────────┘
                  ↑↓ subscribe / mutate
┌────────────────┬────────────────┬────────────────┐
│  Picker        │  Trip view     │  Map/Dest view │
│  Subscribed.   │  Subscribed.   │  Subscribed.   │
│  Reads trip.   │  Reads trip.   │  Reads trip.   │
│  Calls         │  Calls         │  Calls         │
│  mutators.     │  mutators.     │  mutators.     │
│  No own state. │  No own state. │  No own state. │
└────────────────┴────────────────┴────────────────┘
                       ↑ user actions
┌──────────────────────────────────────────────────┐
│  LLM, Sync, Paste import                         │
│  Call mutators only. Never touch trip directly.  │
└──────────────────────────────────────────────────┘
```

## State shape (Schema v1)

```js
trip = {
  // Identity
  id: "trip-<timestamp>",          // storage key, backfilled on load
  _schemaVersion: 1,
  _version: 0,                      // bumped on every mutation, for reactivity
  __saved__: <epoch_ms>,            // last persist timestamp

  // Identity / display
  name: "Iceland 2026",
  _lastScreen: "trip" | "discovery" | "brief" | null,

  // The plan
  destinations: [
    {
      id: "d1",
      place: "Reykjavík",
      country: "Iceland",
      nights: 3,
      lat, lng,
      days: [...],
      suggestions: [...],
      // ... per-destination fields
    },
    ...
  ],
  routes: [...],
  places: { [placeId]: { id, name, country, lat, lng } },

  // The picker / Discovery state (was _tb + trip.placeActivities + trip.mdcItems)
  placeActivities: [...],           // the sections
  candidates: [...],                // LLM-suggested candidates
  picker: {                         // was _tb's miscellaneous scratch
    entry: "",
    tbExit: "",
    region: "",
    sentence: "",
  },

  // The original user input (preserved)
  brief: {
    region, entry, tbExit, when, duration, intent,
    _userListedNames,               // what the user typed (PD.287-clean)
    _userListedDisplay,
    _classificationByPlace,
    _sightsClassified,
    tripMeta: { notes: <paste>, links: [] },
  },

  // Per-place / per-dest annotations (was module-scope parallel arrays)
  destNotes: { [destId]: { text, hidden, seen, createdAt } },
  destStories: { [destId]: { prompt, text } },
  sightStories: { [sightId]: { prompt, text } },
  ffHistories: { [destId]: [...flightHistory] },

  // Logistics / bookings / notes
  notes: { text: "", links: [] },
  pendingActions: [],
  trackSpending: false,
  legs: {},
}
```

Notes:
- `_tb` is **gone**. Its real fields move onto `trip.picker.*` and `trip.brief.*`.
- `_mdcItems` is **gone**. Its content lives on `trip.placeActivities` only.
- `_destNotes` / `_destStories` / `_sightStories` / `_ffHistories` become fields on trip.
- `_coarseGeocode` and `_generatedCityData` stay as session caches (they're not per-trip state; they're network-cost-amortization). They keep their own localStorage keys.
- `id` is now mandatory on trip and gets backfilled from the storage key during migration (fixes the `trip.id: undefined` bug for legacy trips).

## Mutator API (Phase 1 surface)

Every mutation has a named function. Each is one call, one event emit, one persist.

### Lifecycle
- `TripStore.mint(initialBrief)` → creates a new trip, assigns id, emits.
- `TripStore.load(id)` → reads from storage, runs migrations, replaces `_trip`, emits.
- `TripStore.replace(trip)` → replaces wholesale (used by sync pulls, with conflict policy applied).
- `TripStore.unload()` → clears in-memory state (home screen).

### Trip-level
- `TripStore.setName(name)`
- `TripStore.setLastScreen(screen)`
- `TripStore.setBrief(brief)` / `TripStore.updateBrief(partial)`
- `TripStore.setNotes(notes)`

### Destinations
- `TripStore.setDestinations(newDests)`
- `TripStore.addDestination(dest, atIndex?)`
- `TripStore.removeDestination(destId)`
- `TripStore.updateDestination(destId, partial)`
- `TripStore.reorderDestinations(newOrder)`

### Picker
- `TripStore.setPlaceActivities(items)`
- `TripStore.updatePlaceActivity(id, partial)`
- `TripStore.removePlaceActivity(id)`
- `TripStore.setCandidates(items)`
- `TripStore.updatePicker(partial)` (entry, exit, etc.)

### Publish (the kept-candidates → destinations transition)
- `TripStore.publish(buildOutput)` — atomic: replaces destinations + routes + places.

### Annotations
- `TripStore.setDestNote(destId, note)`
- `TripStore.setDestStory(destId, story)`
- `TripStore.setSightStory(sightId, story)`

### Subscribe
- `TripStore.on('tripChange', fn)` → fn receives `{ trip, mutator, payload }`
- `TripStore.off('tripChange', fn)`

## Migration plan (load-time)

```js
function migrateTrip(envelope, storageKey) {
  var trip = envelope.trip || {};
  var v = trip._schemaVersion || 0;

  if (v < 1) v0_to_v1(trip, storageKey);
  // future: if (v < 2) v1_to_v2(trip);

  trip._schemaVersion = SCHEMA_VERSION;
  return trip;
}

function v0_to_v1(trip, storageKey) {
  // 1. Backfill id from storage key (fixes trip.id: undefined for every legacy trip)
  if (!trip.id) trip.id = storageKey;

  // 2. Fold _tb-shaped fields into trip.picker
  trip.picker = trip.picker || {};
  trip.picker.entry = trip.picker.entry || trip.brief?.entry || "";
  trip.picker.tbExit = trip.picker.tbExit || trip.brief?.tbExit || "";
  // ...

  // 3. Drop _mdcItems if present (data lives on trip.placeActivities)
  delete trip.mdcItems;

  // 4. Backfill annotation maps from old module-scope envelope keys
  trip.destNotes = trip.destNotes || envelope.destNotes || {};
  trip.destStories = trip.destStories || envelope.destStories || {};
  // ...

  // 5. Remove auto-created phantoms from _userListedNames (PD.287 retroactive)
  if (trip.brief?._userListedNames) {
    // need oracle: which keys are phantoms?
    // PD.287 only filtered at write — for legacy trips we'd need to
    // re-parse trip.brief.tripMeta.notes and intersect.
  }
}
```

The PD.287 retroactive piece is interesting — we can re-parse the original paste from `tripMeta.notes` and intersect to identify which keys were phantoms. That's a clean migration.

## Phase plan

| Phase | What | Done when |
|---|---|---|
| 0 | This doc, audit | ✓ |
| 1 | TripStore module + schema v1 + migration + tests | tests pass round-trip |
| 2 | Migrate picker (delete `_tb`, `_mdcItems`) | picker renders identically, all interactions work |
| 3 | Migrate trip view, dest view, map | views subscribe to tripChange, no ad-hoc redraws |
| 4 | Migrate sync, LLM, paste import | all call mutators only, no direct `trip.*` writes |
| 5 | Round-trip integration tests + dead code cleanup | tests cover every bug class we hit |

Phase 1 ships today (this session). Phases 2–5 are subsequent sessions.

## Sync conflict policy (decision point)

Today: server clobbers local sometimes, local clobbers server other times. Race-y.

Proposed for v1: **local always wins**. MaxSync becomes push-only: it uploads local trips to the server as a backup, never pulls down to overwrite local. If the user wants to "sync from server" they explicitly invoke a "restore from cloud" action that loads the server trip as a new trip.

Why: we don't have a real conflict UI. Last-write-wins on timestamps is unreliable across clocks. Locking is overkill. Push-only removes the entire class of "sync ate my work" bugs and matches user expectation ("my device is the source of truth").

Cost: cross-device editing is broken until we build a real conflict UI. Acceptable for now.

If you (Neal) want a different policy, flag now — it's a one-line change in `TripStore.replace` to gate sync-pulls.

---

# Phase 7 — `findCandidates` orchestrator (PD.309)

Status: Design (this section), code in progress.

## The bug class we are eliminating

PD.306 + PD.308 are the worked example: the "build a trip" operation has three entry points (sentence, place-picker, paste-list) that each separately call `_initialTripSave`, separately call `enhanceDiscovery`, separately update loading copy, separately handle errors. Adding a single feature ("auto-Enhance during build") required two inline patches in two different functions. The next feature ("Max learns from your choices") would require three. Every entry point reads ~12 fields off the implicit `_tb` argument bag, so the "interface" between callers and the build pipeline is the union of every property anyone ever wrote on `_tb`.

After this phase:
- One canonical `findCandidates({mode, ...input})` orchestrates every build.
- The input is an **explicit, enumerated contract** — not `_tb`.
- Build is a unidirectional pipeline of named phases that **emit events** (`build:phase-start`, `build:phase-done`, `build:done`).
- Loading UI subscribes to phase events instead of having each entry point write `innerHTML` inline.
- `_initialTripSave` collapses from 4 call sites to 1 (owned by the orchestrator's `mint` phase).
- `enhanceDiscovery`'s internal core becomes the `enhance` phase. The standalone "✦ More like this" button calls `MaxBuild.rerunEnhance()` — the only by-name re-invocation in the codebase.

## Input contract

```js
findCandidates({
  mode,           // "candidate-first" | "activity-first" | "rebuild"
  region,         // required
  sentence,       // candidate-first
  anchors,        // candidate-first
  listedPlaces,   // activity-first (paste-list) — array of { place, country, nights, ... }
  placeName,      // activity-first (place-mode) — single place
  placeContext,   // activity-first (place-mode) — context string
  tripMode,       // "sentence" | "place" | "paste" — historical, kept for routing
  isRebuild,      // boolean — true preserves destinations + skips mint
  // ... none of: every other _tb field. Period.
})
```

The orchestrator **never reads `_tb` for input**. It writes to `_tb` only because legacy phases still read from it; the orchestrator's first phase is `normalize` which copies the explicit input into `_tb`. Phase implementations are unchanged in this round; the contract enforcement happens at the boundary. Phase 7b will refactor phases to take explicit args. Phase 7a (this round) just makes the boundary explicit so callers can't sneak `_tb.foo = x` into the contract.

## Modes

| Mode | Trigger | Primary phase | Mint? | Notes |
|---|---|---|---|---|
| `candidate-first` | Sentence/Discovery brief | `runCandidateSearch` body | Yes | The 5 callers of `runCandidateSearch` (10897, 10905, 11058, 11063, 11657) collapse to 1 caller of `findCandidates({mode:"candidate-first", ...})`. |
| `activity-first` | Paste-list, place-mode | `generateActivitiesForPlace` body | Yes | Callers at 8031 (paste modal) and 30185 (retry) collapse. |
| `rebuild` | `saveActivityPickerEdits` | `runCandidateSearch` body **(no mint)** | **No** | Must preserve destination identity + the existing wisp stream. Goes through publishTrip on the other side. |

Place-mode and paste-list are NOT separate modes; both are `activity-first`. The distinction (single place vs many) is an input variant, not a mode.

## Phases

```
findCandidates(input)
  emit("build:start", { mode })
  ├── normalize       — copy input → _tb (legacy bridge; deletes ad-hoc fields)
  ├── primary         — mode-dispatched LLM (candidate or activity); legacy body
  │   emit("build:primary-done", { count })
  ├── mint            — TripStore.mint via _initialTripSave (skipped if rebuild)
  │   emit("build:mint-done")
  ├── enhance         — enhanceDiscovery core (always; best-effort)
  │   emit("build:enhance-done", { added })
  ├── reconcile       — backstop / fold / sight reconciliation (legacy passes)
  │   emit("build:reconcile-done")
  └── handoff         — show picker OR fast-path to buildFromCandidates
      emit("build:done")
  on throw: emit("build:error", { error })
```

## Event shape

```js
MaxBuild.on("build:start",         fn({ mode }))
MaxBuild.on("build:primary-done",  fn({ count }))
MaxBuild.on("build:mint-done",     fn())
MaxBuild.on("build:enhance-done",  fn({ added }))
MaxBuild.on("build:reconcile-done",fn())
MaxBuild.on("build:done",          fn({ tripId }))
MaxBuild.on("build:error",         fn({ error }))
```

The candidate-explorer loading overlay subscribes to `primary-done` and `enhance-done` to update its phase copy. The paste-list picker subscribes to `enhance-done` to drop a "✦ Max added N nearby places — review and reject" toast. Inline `getElementById("ce-loading-detail").innerHTML = ...` writes inside `runCandidateSearch` are deleted; the overlay is the subscriber.

## What we are NOT doing in PD.309

- **`publishTrip` refactor.** It has 8 architectural patches in one function. Per reviewer's advice, treated as an opaque phase. Future Phase 8.
- **Phase implementations taking explicit args.** Round 7a wraps legacy bodies. Round 7b argumentizes them.
- **Sync / restore / share-link import.** Not build paths; go through `TripStore.replace` cleanly.
- **Refactoring the wisp stream.** Rebuild mode preserves it unchanged.

## Migration

1. New module `engine-build.js` with `MaxBuild = { findCandidates, rerunEnhance, on }`.
2. Globally expose `findCandidates` so existing callers don't change shape — but they MUST pass the explicit input contract, not pass nothing.
3. Each of the 5 `runCandidateSearch` callers, the 2 `generateActivitiesForPlace` callers, and `saveActivityPickerEdits` are converted in this order: paste-list → sentence → place-mode → rebuild. Tests verify each migration.
4. After migration: `runCandidateSearch` and `generateActivitiesForPlace` become *phase implementations* — exported only to `MaxBuild`, not callable globally. The `_initialTripSave` call inside them is removed (orchestrator owns mint).
5. Standalone `enhanceDiscovery(btn)` button at index.html:19261 calls `MaxBuild.rerunEnhance()`.

## PD.303 invariant

`_tb.placeActivities === trip.placeActivities` (same array by reference). No phase in `engine-build.js` may `.slice()` either side. Any new pass that wants to filter must rebuild in place. Write this in the module header.

## Done when

- 5 `runCandidateSearch` callers reduced to 0 (replaced by `findCandidates`).
- 2 `generateActivitiesForPlace` callers reduced to 0.
- `_initialTripSave` callable from 1 site (the orchestrator's mint phase).
- New `engine-build-tests.js` covers: mode dispatch, phase ordering, event emission, rebuild-skips-mint, enhance-failure-is-best-effort, contract-rejects-unknown-fields.
- Existing 329 + 77 = 406 Node tests still green.
- 30 Playwright tests still green.
