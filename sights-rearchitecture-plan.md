# Sights rearchitecture — plan

## What's broken

The picker has two models that aren't synchronized:

- **Activity-centric model** (legacy): everything is a "place" with `_keep`, `_isDayTrip`, etc. All places flow through `runCandidateSearch` → `_tb.candidates` → `kept` filter → `orderKeptCandidates` → `trip.destinations`.
- **Classification model** (new, PD.206+): the classifier says sight vs. destination per place. Sights belong on a parent's See-and-Do, not in `trip.destinations`.

The classification model was bolted on top of the activity-centric model without changing the underlying flow. So even when the classifier says "Harpa is a within-sight of Reykjavík," the activity-centric reconciliation re-adds it as a candidate, and it becomes a destination.

This has been the root cause of every "Harpa is still a destination" bug since piece 1. Every patch I added (PD.222, PD.223, PD.225, PD.229, PD.232) tried to plug one path. The next path always undid the work.

## The new architecture

Two new state containers, populated **once** at classifier time, **consulted by every downstream path**:

- `_tb.destinationsClassified` — `Set<normKey>` of places that should become destinations.
- `_tb.sightsClassified` — `Map<normKey, { parentKey, parentRelation, displayName, country }>` of places that should become sights under a parent destination.

Both are mirrored to `trip.brief` for persistence (same pattern as `_userListedNames`).

### The rule

> If a place's normalized key is in `_tb.sightsClassified`, it is a **sight** — never a destination. All downstream paths respect this.

A place not in either container is unclassified (LLM-discovered, no user input) and flows through the legacy path as a destination, as before.

### Which paths consume what

| Path | Consumes | Behavior |
|------|----------|----------|
| `publishTrip` kept-filter | `_tb.sightsClassified` | Exclude any candidate whose key is in `sightsClassified` |
| Reconciliation pass (engine-picker.js ~1950) | `_tb.sightsClassified` | Skip synthesis if place is in `sightsClassified` |
| PD.223 (sight attach) | `_tb.sightsClassified` directly | Iterate the map, attach each entry to its parent destination's `suggestions[]` |
| PD.225 (orphan/from augment) | `_tb.sightsClassified` directly | Iterate entries where `parentRelation === "from"` or no parent in destinations; create 0-night destinations |
| `_reconcileUserListedKeeps` | Both | Rehydrate from trip.brief if `_tb` cache is empty |
| `buildBrief` | Both | Include them in the new brief so publish doesn't wipe them |

### What stays unchanged

- The classifier itself (engine-classify.js)
- The parser (parsePlacesList)
- The "Sights you listed" synthetic section (PD.221) — already reads from `_userListedNames`, no change needed
- The trip view rendering
- All other PDs (#1 picker filter PD.222, #2 modal PD.224, etc.) that don't touch the destinations pipeline

## Execution plan

### Step 1 — Build the containers

In `_buildPickerFromPastedList`, after the classifier runs (PD.206 splice already exists), populate `_tb.destinationsClassified` and `_tb.sightsClassified` from the classifier output. Mirror to trip.brief.

Logic per entry, based on `_classification`:

- `city` or `region` → `destinationsClassified.add(key)`
- `poi`:
  - if `_promotedToDestination` (Geysir-alone case) → `destinationsClassified.add(key)`
  - else → `sightsClassified.set(key, { parentKey, parentRelation, ... })`
- `activity` or `role-tag` → neither (they're not Places)
- unset / heuristic-defaulted → `destinationsClassified.add(key)` (preserve legacy behavior)

### Step 2 — Rehydrate

In `_reconcileUserListedKeeps`, mirror the PD.107 pattern: if `_tb` containers are empty, restore from `trip.brief.destinationsClassified` / `trip.brief.sightsClassified`.

### Step 3 — Make buildBrief carry them

Add `destinationsClassified` and `sightsClassified` to the new brief in `MaxEnginePicker.buildBrief`. Serialize Sets/Maps as arrays/object-of-entries.

### Step 4 — Wire publishTrip's kept-filter to use them

Replace the complex PD.229 logic (`role === "see"` + classifier-map lookup + fallback) with a single rule: if `key` is in `sightsClassified`, exclude. Done.

### Step 5 — Make the reconciliation pass respect them

The reconciliation pass at line ~1950 walks `placeActivities` and synthesizes candidates for kept places with no matching candidate. Add: if `key` is in `sightsClassified`, skip synthesis.

### Step 6 — Refactor PD.223 + PD.225 to read from the containers directly

Both currently iterate `_tb._classificationByPlace`. Switch them to iterating `_tb.sightsClassified` (cleaner — the container already has exactly what they need; no filtering by `classification === "poi"` etc.).

### Step 7 — Remove no-longer-needed code

- The PD.232 user-listed fallback in PD.229 (now redundant).
- The PD.232 fallback parent attach in PD.223 (now redundant).
- PD.229's complex map-lookup logic (replaced by single Set lookup).

`_tb._classificationByPlace` stays — it's still consumed by PD.227 (Things to do preview) and the modal (PD.224) and is fine for diagnostic / metadata reads. We just stop using it as the authority for the kept-filter.

## Test strategy

1. Unit tests in `engine-classify.js` already cover the classifier output.
2. Add manual verification:
   - Fresh import → check `_tb.destinationsClassified.size` matches city+region+promoted count
   - Fresh import → check `_tb.sightsClassified.size` matches within+from POI count
   - Choreograph → check `trip.destinations` does NOT contain any name from `sightsClassified`
   - Choreograph → check each `sightsClassified` entry with parent in destinations → appears in that destination's `suggestions[]`

## Files touched

- `index.html` — `_buildPickerFromPastedList` (populate containers), `_reconcileUserListedKeeps` (rehydrate)
- `engine-picker.js` — `buildBrief` (persistence), `publishTrip` kept-filter (use sightsClassified), reconciliation pass (skip sights), PD.223 (iterate sightsClassified), PD.225 (iterate sightsClassified)
- `tests/engine-tests.js` — add tests if there's a pure-function piece I can extract (likely not — most of this is integration with the picker state)

## What this is NOT

- Not a refactor of the activity-centric model (placeActivities, candidates). Those keep working as-is.
- Not a refactor of the trip view, picker render, modal, etc.
- Not a redesign of the spec — the data model (within/from, parent, etc.) stays as designed.

This is a **plumbing change** that wires the classifier's output to the right pipeline steps. The conceptual model is the same as PD.206+. The execution is what's broken.

## Risk

The reconciliation pass at line ~1950 has been a source of bugs throughout this rollout. Skipping synthesis for sights is the right call but could break some other flow that relied on the synthesis. Watch the console for warnings during the next publish.
