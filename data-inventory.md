# Max data inventory — user-owned vs computed

> Purpose: when we change the schema, the build pipeline, or any
> mutator, this doc is the contract that says "this field is the
> user's; don't drop it." Every entry has a canonical home (where it
> lives), a write surface (which mutators set it), a read surface
> (which renderers consume it), and an erasure surface (which lifecycle
> events can destroy it). Failing-test contracts in
> `tests/data-preservation-tests.js` are derived from this doc; they
> are the gate that catches regressions.

## Categories

- **U** — User-owned. The user typed it, picked it, paid for it, or
  noted it. Loss is a data-loss bug. Tests required.
- **C** — Computed. Build/LLM produces it. Loss is recoverable by
  rebuild — no test required, but DO test that user-owned fields
  *attached* to a computed field survive when the computed field is
  rebuilt.
- **M** — Mixed. The base is computed (e.g. LLM suggests a sight) but
  user state attaches to it (e.g. user flags `_considered`,
  `_rejected`, or adds a `reservation`). When the base is regenerated,
  user state must merge through `mergeUserStateIntoRegenerated`.
- **S** — System. Bookkeeping (`_version`, `__saved__`). Not the
  user's, not exactly "computed" either. Migrations handle these.

## Top-level trip fields

| Field | Cat | Notes |
|---|---|---|
| `id` | S | Storage key. Schema migration backfills if missing. |
| `_schemaVersion` | S | Migration framework. |
| `_version` | S | Mutation counter for tripChange listeners. |
| `__saved__` | S | Last-saved timestamp. Sync uses for last-write-wins. |
| `name` | U | Trip title. Edited via `TripStore.setName`. |
| `_lastScreen` | U | Restore-on-load state. Survives rebuild. |
| `destinations[]` | M | LLM produces the base; user adds reservations, notes, day items per dest. See per-destination table. |
| `placeActivities[]` | M | LLM produces sections; user toggles `_keep` per requiredPlace, `checked` per section, `_rejected` for taste signal. PD.303 invariant: shared reference with `_tb.placeActivities`. |
| `candidates[]` | M | LLM-generated; user sets `status: keep \| reject`, `tripRole`, `_roleTouched`. |
| `routes[]` | M | LLM-generated; user can reorder planItems, edit `notes`, `duration`, `priority` per stop, add/drop waysides. |
| `places{}` | M | LLM-geocoded; user can add custom places with `notes`. |
| `pendingActions[]` | U | Offline mutation queue (PD.250+). Drains on next sync. |
| `brief{}` | U | The trip-brief — every user input. See per-brief table. |
| `picker{}` | U | Picker UI preferences (search input, focus, scroll). |
| `destNotes{destId: note}` | U | Per-destination free-text notes. |
| `destStories{destId: story}` | U | Per-destination narrative. |
| `sightStories{sightId: story}` | U | Per-sight narrative. |
| `ffHistories{}` | U | Find-and-fix histories per surface. |
| `notes{text, links}` | U | Trip-level notes (also seeded from paste). |
| `legs{}` | C | Cached driving-distance / haversine between dests. Rebuildable. |
| `trackSpending` | U | User preference (bool). |
| `createdAt` | S | Set on publish. Read-only after. |
| `_gapNudgeDismissed` | U | "Don't show me the What's-missing nudge again" — per-trip flag. |
| `_enhanceHintDismissed` | U | "Don't show me the Enhance hint banner again." |
| `mdcItems` | (gone) | LEGACY. Stripped by `_migrateV0ToV1`. PD.307b/PD.318 fixed renderers that still read it. New renderers MUST go through the accessor layer (PD.319-3). |

## Per-destination fields

| Field | Cat | Notes |
|---|---|---|
| `id` | S | Stable across rebuilds (PD.310 rebuild mode preserves). |
| `place`, `country` | M | Initial from LLM; user can `updateDestination` to fix typos. |
| `nights` | M | LLM-suggested; user-editable via per-dest pace adjust. |
| `arrival`, `departure` | U | User-set arrival/departure date+time. |
| `suggestions[]` | M | LLM-generated. Per-suggestion user state: `_considered` (PD.269), `_rejected`, `notes`. PD.318: the considered-pin renderer reads these. |
| `dayItems[]` | M | LLM seeds a daily plan; user reorders, edits notes, swaps in considered sights. |
| `dayTrips[]` | M | LLM proposes; user can add custom or drop. |
| `reservations[]` | U | Hotel/airbnb bookings. Fields: `name`, `confirmation`, `address`, `dateFrom`, `dateTo`, `cancellationPolicy`, etc. **HIGHEST DATA-LOSS COST** — losing these is the worst-case user bug. |
| `bookings[]` | U | Activity bookings (museum tickets, tours). Similar shape to reservations. |
| `notes` | U | Per-destination free-text. |
| `_isDayTrip`, `_dayTripHub` | U | Role decisions made via the trip-stop popover. |
| `_pinned` | U | User pinned this dest. |
| `attachedEvents` | U | Custom event marker (concert, conference). |
| `_userReassigned` | U | User changed the role from what LLM proposed. |
| `_sightSources` | C | PD.241 sources model bookkeeping. |
| `discoveryCands` | C | LLM candidate snapshot. |
| `discoveredItems` | C | Picker-time discovery items snapshot. |

## Per-route / per-planItem fields

| Field | Cat | Notes |
|---|---|---|
| `planItems[].id` | S | Stable. Re-resolve target by id (PD.280). |
| `planItems[].type` | C | `stop` / `transit` / `dayTrip`. |
| `planItems[].placeId` | C | Joins to `trip.places{}`. |
| `planItems[].duration` | M | LLM-suggested; user-editable. |
| `planItems[].priority` | M | `iconic` / `optional` from LLM; user-editable. |
| `planItems[].notes` | M | LLM-seeded; user can edit. |
| `planItems[].source` | S | Provenance (`llm-wayside-v1`, `user-manual`, etc.). |
| `planItems[].order` | U | User-reordered stops. |

## Brief fields (all U)

`region`, `sentence`, `intent`, `anchors`, `chips[]`, `interests[]`,
`drivers[]`, `gradient`, `duration`, `when`, `startDate`, `endDate`,
`entry`, `tbExit`, `entryMode`, `exitMode`, `transport`,
`accommodation`, `pace`, `compromises`, `hardlimits`, `flexibility-
Notes[]`, `physicalAbility`, `abilityNote`, `partyMembers[]`,
`avoidances[]`, `loyaltyPrograms`, `emergencyContactName`,
`emergencyContactPhone`, `familiarity`, `tripMeta.notes`,
`tripMeta.links[]`, `_initialWispsRaw[]` (the literal user input
captured before LLM rewrites it — PD.A.4), `_userListedNames{}`,
`_userListedDisplay{}`, `_classificationByPlace{}`,
`_sightsClassified{}`, `mustDo`, `tags[]`, `vibe`, `weather*`,
`safety*`, `kidsAllowed`, `_userIntent` (sight/stay declared per
paste-list entry).

## Lifecycle events that can erase user state

| Event | Risk | Mitigation |
|---|---|---|
| **Rebuild** (saveActivityPickerEdits → MaxBuild rebuild mode) | HIGH — regenerates destinations. Identity preserved by id (PD.310), but per-dest user state (reservations, notes, day items) must be merged forward. | `mergeUserStateIntoRegenerated` — PD.319-4. |
| **Sync pull** (server → local) | MEDIUM — overwrites trip wholesale. ARCH Phase 5 made it push-only, so this only fires on explicit "Restore from cloud." Still needs a confirm prompt. | Already push-only. Document in inventory. |
| **Schema migration** (`_migrateV0ToV1`) | HIGH — strips fields silently. mdcItems was the precedent. | PD.319-6: snapshot pre-migration trip into `_preMigrationBackup` for one version. |
| **Initial trip save** | LOW — mints from `_tb`, doesn't read pre-existing trip. Safe because `_currentTripId` should be null when minting. | PD.297 already enforces. |
| **Paste-list replace** | MEDIUM — clears `_currentTripId` and mints fresh. Old trip's reservations etc. are NOT migrated. | Intentional: paste-list creates a NEW trip; user accepts loss of unrelated old trip's state. |
| **Direct field reassignment** (`_tb.placeActivities = items`) | HIGH — PD.303 invariant: must share reference with `trip.placeActivities`. A stray `.slice()` re-opens the bug class. | PD.319-3 accessor layer + PD.319-7 single-flight. |
| **Reconcile / fold / backstop** | LOW — these mutate in place, preserving references. | PD.319-2 tests pin this. |

## Read surfaces that need accessor migration

Renderers currently read raw `trip.X`. Each one is a future bug
when a field gets renamed or stripped. PD.319-3 introduces
`MaxData.getX(trip)` which handles legacy fallbacks. Migration
priority (riskiest first):

1. **`_collectWhatsHere`** (index.html:49254) — PD.307b already routed
   to placeActivities, but should go through accessor.
2. **`_renderConsideredPins`** (index.html:45207) — PD.318 now reads
   `trip.destinations[].suggestions[]` filtered by `_considered:true`.
   Should go through accessor.
3. **`_paintConsideredBtn`** (index.html:43120) — already reads
   suggestions[]._considered:true. Move to accessor.
4. **Per-destination day-plan render** — reads `dest.dayItems`,
   `dest.suggestions`, `dest.reservations`. Each through accessor.
5. **Trip-overview map** — reads `trip.destinations`,
   `trip.routes`, `trip.places`. Through accessor.
6. **Day-plan picker** — reads `dest.suggestions` filtered by
   `_considered`. Through accessor.
7. **Picker render** (`_renderPlaceActivityItems`) — reads
   `_tb.placeActivities` (the bridge to `trip.placeActivities`).
   Through accessor with PD.303 invariant.

After PD.319-3 ships, **no new renderer reads raw `trip.X` directly**
— enforced by code review + a lint rule we can add later.

## Failure modes this inventory protects against

1. **Schema rename drops user data.** mdcItems → placeActivities did
   this twice today. Accessor layer fixes by construction.
2. **Rebuild drops attached user state.** Reservations on a survived
   destination should NOT disappear because we regenerated the dest
   from candidates. `mergeUserStateIntoRegenerated` enforces.
3. **Concurrent writers clobber each other.** PD.315 mutex protects
   one function; PD.319-7 generalizes to all TripStore mutators.
4. **Silent migrations.** PD.319-6 snapshot makes one version
   recoverable; fixtures make the migration itself testable.
5. **Field renames in storage.** Schema migration is the official
   path; accessors handle the read side; preservation tests gate the
   write side.
