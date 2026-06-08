# Max — The Save & Load Model
**Date:** June 6, 2026 · companion to ARCHITECTURE-AUDIT-2026-06-06.md
**Why this document exists:** "In 3 days you haven't delivered a simple process of saving a trip, or a Discovery page, and its data, and loading from where you saved." Correct. This document models both pipelines end-to-end from the actual code, names the two holes that made saving unreliable, and records the contract that now holds.

---

## The one-sentence diagnosis

**Trip-view edits were always saved; Discovery curation was never saved; and the last 1.5 seconds before closing a tab were always lost.** Everything else (refresh, routing, GC) was noise around those two facts.

---

## 1. SAVE — what happens when you change something

### 1a. Trip-view edits (add destination, reorder, dates, bookings…)
Every trip mutator ends in `_emitTripMutation()` → `autoSave()`:

```
autoSave()                                     index.html ~6155
 ├─ localSave()                — SYNCHRONOUS write
 │   ├─ guards: skipped if _inIframe, no _currentTripId, or read-only share
 │   ├─ serializeTrip() → envelope {trip, activeDest, destCtr, sidCtr, bkCtr}
 │   ├─ envelope.__saved__ = Date.now()        ← the conflict-resolution clock
 │   └─ MaxDB.trip.writeRaw(_currentTripId, json)
 │       ├─ ASSERTS envelope.trip.id === storage key (PD.333 — heals/flags)
 │       ├─ localStorage 'max-trip-<id>'       ← synchronous, durable
 │       └─ overflow → IndexedDB (quota exceeded)
 ├─ TripStore.notifyChange()  — event bridge
 └─ MaxSync.scheduleSave()    — server PUT, DEBOUNCED 1.5s
```

TripStore-routed mutations do the same via `TripStore.batch → _persist()` (one atomic write per batch).

**Status: this path was always solid.** Local data is written synchronously on every edit.

### 1b. Discovery curation (keep/reject, stay/see, day-trip, roles) — THE HOLE
Before today:

```
setCS(id, 'reject')                            index.html ~37289
 ├─ _tb.candidates[i].status = 'reject'        ← in-memory only
 ├─ re-render cards
 └─ (nothing else — NO SAVE OF ANY KIND)
```

The flip reached storage only if something *else* later persisted the trip — an LLM completion running `_initialTripSave`, or Choreograph. Close the tab first and the curation was gone. **This was the bug you've been living in for three days.** It looked like "close and reload doesn't work" because reload faithfully restored the last *saved* state — which didn't include your curation.

**Now (PD.334):** every curation writer — `setCS`, `_pmSetPlaceRole`, `_pmTogglePlaceStay`, `_pmSetPlaceDayTrip`, `_pmSetStayOverride` — ends with `_persistDiscoveryState()`: a 600 ms-debounced write-through (`TripStore.batch(setCandidates + setPlaceActivities)` → synchronous local write → `scheduleSave()` to the server). Post-mint, `_tb.candidates` *is* `trip.candidates` (the PD.303 by-reference bridge, now also enforced in the route dispatcher), so the flip is already on the trip object — the missing step was only ever the write.

### 1c. The close-the-tab contract — THE SECOND HOLE
Before today: `MaxSync.scheduleSave` armed a 1.5 s timer and **nothing flushed it on close** — `visibilitychange` only paused *polling*. Any edit in the last 1.5 s never reached the server; any pending curation debounce died with the tab.

**Now (PD.334):** `visibilitychange(hidden)` + `pagehide` run `_saveOnLeave()`:

1. pending curation debounce → written through immediately,
2. `localSave()` — synchronous, so local storage is current no matter what,
3. `MaxSync.flushNow()` — cancels the debounce and issues the PUT **with `keepalive`**, so the request survives the tab teardown.

### 1d. When is a trip first saved at all? (the mint)
A brand-new trip exists only in memory until `_initialTripSave` runs at the first LLM completion (it requires substance — candidates or activities). Filling out the brief and closing before generation completes loses the brief. That's a deliberate design choice (don't mint empty shells), now survivable because the mint stamps the Discovery URL and everything after it saves continuously.

---

## 2. LOAD — what happens when you open the app

```
window 'load'                                  index.html ~39346
 ├─ share/?disc/?clip early exits
 ├─ loadTripsIndex()
 │   └─ cleanupOrphanedTrips()    ← GC. Signed-in: deletes ONLY unparseable
 │                                   junk (PD.333). Signed-out: orphans +
 │                                   empty shells >7 days, never the URL's trip.
 ├─ renderHomeScreen()            ← trip list + build stamp
 ├─ URL boot dispatch: MaxRoute.parse()
 │   ├─ no hash → home screen (correct: URL is the screen)
 │   └─ #/trip/<id>/… → selectTrip(id)
 │       ├─ localLoad(id) → restoreTrip → TripStore.replace  (anchors store)
 │       │   └─ miss → server fetch (signed in) → writeRaw → retry
 │       └─ enterApp() → deferred: map, baseline render, _dispatchRoute()
 │           └─ dispatcher picks the screen FROM THE URL, incl. both
 │              Discovery surfaces (activity picker / candidate explorer)
 └─ [parallel] MaxSync._bootPull() → pullAll()
```

### The pull-vs-local conflict rule
For each server trip, `pullAll` compares `server.updatedAt` vs local `__saved__`:

- **server older or equal → local wins, body untouched** (your unsynced work survives)
- **server newer → body pulled**, written via `writeRaw` → the `tripWritten` subscriber adopts it into memory **only if** it's the active trip **and** the incoming `__saved__` is strictly newer than the in-memory one (ties go to local).

~~Residual risk: the comparison trusts wall clocks.~~ **Closed (PD.334, same day):** the server now owns a monotonic `rev` per trip, bumped on every write and never set by clients. Pushes send `baseRev` (the revision the edit was based on); a mismatch is a *real* conflict regardless of any clock, returned as 409 with the server row. Pulls fetch a body only when the server's rev is ahead of the locally recorded one — device clocks play no part. Wall-clock comparison survives only as the fallback for pre-rev rows/clients. Requires one server migration: `cd server && npx tsx scripts/apply-migration-0010.ts` (idempotent), then `bash deploy.sh --server`.

**Why this rule + the old holes = your exact experience:** your curation was never in `__saved__`-stamped storage at all, so there was nothing for "local wins" to win *with*. The save holes made the load logic look broken; the load logic was mostly fine.

---

## 3. The contract, stated plainly

1. **Every user action that changes data is durably saved locally within at most 600 ms, and immediately on tab-hide.** No action class is exempt; Discovery curation included.
2. **Local storage is the boot source of truth; the server only overwrites it with strictly newer data, and ties go to local.**
3. **The storage key and the id inside the envelope are the same string, asserted at the single write chokepoint.**
4. **The URL names the screen; reload/close+reopen lands where you were (both Discovery surfaces included).**

Contract 1 is new today (PD.334). Contracts 2–4 were completed across PD.330–333. All four are enforced: 13 source-level contract checks run first in `tests/run.sh`, and the Playwright suite now includes "curate → reload inside the debounce window → curation intact," which fails the deploy gate if anyone reopens the hole.

---

## 4. Test inventory for this model

| Scenario | Test |
|---|---|
| Curate → immediate close/reload → curation intact | picker-flow: "Discovery curation survives immediate close/reload" |
| Refresh in Discovery (activity picker, published trip) | picker-flow: "hard refresh in Discovery lands back in Discovery" |
| Refresh in Discovery (new trip, no destinations) | picker-flow: "new trip (no destinations): refresh restores Discovery" |
| Refresh in Discovery (candidate explorer) | picker-flow: "candidate explorer: refresh restores the explorer" |
| Build → trip view with correct id/key | picker-flow Switzerland/Iceland/rebuild trio |
| id/key mismatch can't ship silently | contract-checks Rule 2 + writeRaw assert |
| GC can't eat fresh/open/synced trips | contract-checks GC 1–3 |
