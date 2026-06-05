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
