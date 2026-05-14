# Max — Data Model

The shape of a trip and everything attached to it. This document is the single source of truth for what a "trip" *is*, what belongs to it, and what's computed from it.

When in doubt, this doc wins. Code that disagrees with it should change.

---

## Naming

- **Destination Selector** — the surface formerly known as the *picker*. "Picker" is acceptable as an alias in code and casual reference; user-facing copy and new code should prefer "Destination Selector."
- **Brief** — the screen titled *"Tell Max about your trip"*; captures user intent before the Destination Selector opens.
- **Choreograph** — the act of committing the selected destinations into a built trip.

---

## Top-level shape

```
Trip
├── brief                    user intent (dates, party, pace, transport, …)
├── status                   planned | in-progress | done
├── places{}                 dictionary of POIs, keyed by placeId
├── destinations[]           overnight stops, in trip order
│   ├── placeId              ref → trip.places[placeId]
│   ├── nights
│   ├── dateFrom, dateTo
│   ├── pois[]               placeIds of POIs visited from this destination
│   └── days[]               one per calendar day at this destination
│       └── planItems[]      what happens on this day
├── routes[]                 transit between consecutive destinations
│   ├── fromDestId, toDestId
│   ├── modeOptions[]        train | car | flight | bus | ferry | walk
│   ├── modeChosen
│   └── transitDays[]        calendar days while moving
├── pendingActions[]         Max's nudges to the user
├── candidates[]             picker carry-forward (working set)
└── notes                    freeform trip-level notes
```

The **Calendar** is *not* in this tree. It's a **computed view** over `destinations[].days[].planItems[]` and `routes[].transitDays[]`, sliced by date instead of by destination. There is no separate Calendar storage.

---

## Entities

### Trip

The container. One trip = one journey the user is planning or has taken.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable, generated at creation |
| `name` | string | User-supplied or derived ("Iceland — May") |
| `status` | enum | `planned` / `in-progress` / `done` — drives UI affordances |
| `brief` | object | See *Brief* below |
| `places` | dict | `{ placeId: Place }` — see *Places dictionary* below |
| `destinations` | array | See *Destination* |
| `routes` | array | See *Route* |
| `pendingActions` | array | See *PendingAction* |
| `candidates` | array | Picker carry-forward set |
| `notes` | string | Freeform |
| `share` | object | Token, revokedAt, etc. |
| `createdAt`, `updatedAt` | ISO date | |

### Brief

The user's stated intent for the trip. Captured in the brief flow ("Tell Max about your trip"). Read by the LLM at candidate-generation time, by the realism check, and by anything that needs trip context.

| Field | Type | Notes |
|---|---|---|
| `placeName` | string | Region / country / city user typed |
| `placeContext` | string | "Why this place" — drives bucketing |
| `startDate`, `endDate` | ISO date | Optional; if absent, anchored by `duration` |
| `duration` | string | "10 days", "2 weeks" — parsed by `_parseTripDuration` |
| `entry`, `tbExit` | string | Arrival / departure cities |
| `entryDetails`, `exitDetails` | object | Flight/train/etc., carrier, time, confirmation |
| `travelersCount` | number | Party size |
| `withKids` | boolean | |
| `physicalAbility` | enum | `fit` / `moderate` / `limited` / `elderly` / `mobility` / `other` |
| `abilityNote` | string | Free text |
| `paceMode` | enum | `loose` (relaxed) / `enough` (balanced) / `notmuch` (intense) |
| `dayTripHours` | number | Threshold for day-trip vs overnight |
| `transport` | string | "Train and walking", "Rental car", etc. |
| `accommodation` | string | Preferred lodging style |
| `avoidDefaults` | object | `{ altitude, crowds, heat, cold, longDrives }` |
| `avoidOtherDefaults` | string | Free text avoidances |

The brief is editable mid-trip via the picker's **✎ Brief** button. Changes propagate to subsequent LLM calls and the realism check; they don't retroactively reshape committed plans.

### Places dictionary

A flat dictionary `trip.places[placeId] = Place`. Every reference elsewhere (destinations, planItems, routes) is by `placeId`. Avoids duplicating place data across the trip.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable; generated when first added |
| `name` | string | "Hallgrímskirkja", "Reykjavík" |
| `country` | string | |
| `type` | enum | `city` / `town` / `sight` / `restaurant` / `hotel` / `landmark` / `other` |
| `lat`, `lng` | number | |
| `wiki` | object | Cached Wikipedia summary (description, extract, thumbUrl, attribution) — *or* lives in MaxDB.cache.wiki keyed by name; either is fine, this is a perf detail |
| `notes` | string | User-supplied notes about this place |
| `tags` | string[] | "iconic", "kid-friendly", "rainy-day-OK", etc. |

A Place can appear in multiple parts of the trip: as a destination's `placeId`, as a POI under destinations, as the `place` field on a PlanItem, as a Route endpoint.

### Destination

An overnight stop on the trip. Ordered in the trip.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable |
| `placeId` | string | ref → `trip.places[placeId]` |
| `nights` | number | How many nights here |
| `dateFrom`, `dateTo` | ISO date | Inclusive |
| `pois` | string[] | placeIds of POIs the user might visit |
| `days` | array | One per calendar day in `[dateFrom, dateTo]`, see *Day* |
| `intent` | string | Optional: "drive the south coast", carry-over from brief |
| `accommodation` | object | Booked hotel: `{ placeId, confirmation?, checkIn, checkOut }` |
| `weather` | object | Cached weather forecast |
| `execMode` | object | Day-of-trip state: tracker items, etc. |

POIs vs PlanItems: the `pois[]` list is the *menu* of places Max thinks are worth visiting from this destination. PlanItems are the *commitments* — which of those POIs (plus any others) end up on a specific day.

### Day

A calendar day at a destination. Created when the destination is created and its dates are set.

| Field | Type | Notes |
|---|---|---|
| `date` | ISO date | |
| `planItems` | array | See *PlanItem* |

Days are also created on **Routes** (`route.transitDays[]`) for days where the user is moving between destinations — see *Route* below.

### PlanItem

A single thing happening on a Day. Unified type with a state machine. Replaces the older split between "Booking / Suggestion / Scheduled Place".

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable |
| `state` | enum | `suggestion` / `scheduled` / `booked` — state machine below |
| `placeId` | string | ref → `trip.places[placeId]` |
| `type` | enum | `sight` / `meal` / `transit` / `hotel-checkin` / `hotel-checkout` / `dayTrip` / `event` / `freeTime` / `other` |
| `startTime` | time | Optional; absent for state=suggestion |
| `endTime` | time | Optional |
| `duration` | number | Minutes; optional, derived if start+end set |
| `booking` | object | Present when state=booked: `{ confirmation, vendor, price, modifyUrl, cancelUrl }` |
| `notes` | string | User notes |
| `source` | enum | `llm-suggestion` / `user-added` / `imported` |

**State machine:**

```
   suggestion ──promote──▶ scheduled ──reserve──▶ booked
        ▲                       │                    │
        │                       │                    │
        └──demote───────────────┘                    │
        ◀──────────────────cancel────────────────────┘
```

- `suggestion` — Max proposed it; not on any day's schedule yet.
- `scheduled` — placed on a specific day, optionally with time; no reservation.
- `booked` — confirmed reservation with payment / commitment.

Demotion paths (`scheduled → suggestion`, `booked → scheduled` after cancel) handle the "I changed my mind" case.

A `dayTrip` is a PlanItem of `type: dayTrip` that takes most/all of a Day on the **hub destination**. Don't make it a separate Destination. Don't keep a separate `dest.dayTrips[]` chip list — the PlanItem (in `suggestion` state until scheduled) is the single source of truth.

The legacy `dest.dayTrips[]` storage is being migrated out. Until the migration completes, both representations may coexist; code that reads day trips should prefer PlanItems with `type: dayTrip` and fall back to `dest.dayTrips[]` only for un-migrated trips.

**Time ownership.** PlanItems own their times absolutely — `startTime` and `endTime` are clock times on a 24-hour day, not offsets from the Day. There is no Day-level "start time" field. This keeps the model simple: a booked flight at 08:00 is 08:00, period, regardless of how the rest of the day shakes out.

To smooth the "I haven't typed times for any of these yet" case, the UI offers an **auto-stack** affordance: pick a starting hour, and Max fills in `startTime` / `endTime` on all untimed items in order using each item's `duration`. The data model stays Model A (times are absolute) while the input ergonomics get the Model B benefit. Bookings are skipped — their times are already correct.

Untimed items (no `startTime`) sort to a "loose" section at the top or bottom of the Day until they're timed or auto-stacked.

**Ordering.** Time IS the order. There is no separate `order` field on timed PlanItems — they sort by `startTime` ascending. Drag-and-drop a timed item to a new position edits its `startTime`, not a separate ordering field. This guarantees visual order matches temporal order (you never see "lunch at 1pm" listed before "morning hike at 9am" because someone manually reordered).

Ties on `startTime` fall back to insertion order — rare edge case.

Untimed PlanItems are the exception: they need their own ordering within the "loose" section since they have no time to sort by. An `order` field (or just array index) handles that. The moment an untimed item gets a `startTime`, it joins the timed sequence and its `order` becomes irrelevant.

**Multi-place tours and routes.** A walking tour through five sights, a wine route, a pub crawl — anything that visits multiple Places under one user-facing identity. Default model: **one PlanItem per stop, linked by `groupId`**. Each stop carries its own time, place, notes, and can be edited / dropped independently. The shared `groupId` lets the UI render them as a unit (shared color, "tour name" header, "remove whole tour" affordance).

The exception: a **single PlanItem with `placeIds[]`** when the operator binds the stops as one inseparable unit (Hop-On Hop-Off bus with a fixed loop, guided coach tour with a fixed schedule, multi-stop ferry pass where the route is predetermined). The user can't edit individual stops without canceling the whole thing, so the data should match.

| Field on PlanItem | Notes |
|---|---|
| `groupId` | Optional; non-null marks this item as part of a multi-stop tour |
| `placeIds[]` | Used instead of `placeId` for single-PlanItem multi-stop bookings |

### Route

Connects two consecutive destinations. Owns the transit days.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable |
| `fromDestId`, `toDestId` | string | refs → `trip.destinations[].id` |
| `modeOptions` | array | `['train', 'car']` etc.; populated by the LLM in the Destination Selector |
| `modeChosen` | enum | Single mode the user committed to — set in the trip view, not the Destination Selector |
| `transitDays` | array | Calendar days while in transit; each has its own `planItems[]` (e.g., "train 8:00–11:30") |
| `bookings` | array | Multi-leg booking refs |
| `notes` | string | |

A Route's `transitDays` reuse the same Day shape as Destination days. The day "belongs" to the Route, not to either endpoint Destination — solves the awkwardness of "which destination does the travel day count against?"

**When `modeChosen` gets set.** The Destination Selector gathers `modeOptions[]` per route but doesn't commit a mode. The trip view is where the user actually picks — each Route card shows the options as a chip group, pre-selected to the trip's default transport (carried from the brief: "trains and walking" → `train` default). One click swaps. Time / booking / drive-time math reads `modeChosen` only.

Picking a mode in the trip view doesn't re-build the trip — it just retunes that one Route's transit days and any drive-time math.

### PendingAction

Max's inbox of nudges to the user.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `kind` | enum | `hotel-out-of-range` / `flight-conflicts` / `unbooked-segment` / etc. |
| `targetId` | string | What it's about (destinationId, planItemId, etc.) |
| `message` | string | Plain-English |
| `severity` | enum | `info` / `nudge` / `urgent` |
| `cleared` | boolean | |
| `createdAt` | ISO date | |

### Candidate

Picker carry-forward state. Survives Choreograph so the user can re-edit later.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `placeId` | string | |
| `status` | enum | `keep` / `reject` / null (undecided) |
| `intent` | enum | `stay` / `dayTrip` — user's role decision |
| `dayTripHub` | string | refs another candidate `id` when intent=dayTrip |
| `nights` | number | LLM's proposed length |
| `whyItFits` | string | LLM rationale |
| `_required` | boolean | Came from a must-do, not LLM discovery |

---

## Computed views

**Calendar.** A by-date slice of the trip. Walk all `destinations[].days[]` + `routes[].transitDays[]`, sort by date, flatten `planItems[]`. Group by day. That's the calendar. No separate storage; always derived.

**Unallocated places.** Filter all PlanItems where `state === "suggestion"` and not attached to any specific day. Also derived.

**Bookings list.** Filter PlanItems where `state === "booked"`. Useful for the "what's confirmed?" view.

**Drive time / total transit.** Sum over `routes[].transitDays[].planItems[]` where `type === "transit"`. Used by the realism check.

---

## Out of scope (cross-trip / app-level)

These exist *outside* the Trip and are referenced/shared:

- **User Preferences** (`MaxDB.prefs`) — defaults for pace, transport, units, etc. Apply to *all* future trips. Distinct from `trip.brief` which is per-trip.
- **Wikipedia / city data caches** (`MaxDB.cache.wiki`, `MaxDB.cache.cityData`) — global caches. Place-keyed. Survive across trips.
- **LLM cache** (`MaxDB.cache.llm`) — prompt → response. Cross-trip.
- **Trips index** (`MaxDB.index`) — slim summary list for the home screen. Generated from Trip on every write.

---

## Persistence

- **localStorage** primary for trip envelopes (`max-trip-{id}`), prefs, settings.
- **IndexedDB** fallback for trips when localStorage hits quota (v359.43). Also stores wiki + LLM caches.
- **Server** (Cloudflare Worker + Turso): trips, prefs, share tokens. Sync via `sync.js` on poll + on change.

The Trip object is the unit of persistence. When anything inside it changes, the entire envelope is rewritten — no partial updates.

---

## Open questions

*(All settled — see Resolved below. Add new questions here as they emerge during the trip-view refactor.)*

## Resolved

- **Time ownership (Day vs PlanItem):** PlanItems own absolute times. Day has no `startTime`. UI offers an auto-stack affordance for ergonomics. See *PlanItem → Time ownership* above.
- **PlanItem ordering:** Timed items sort by `startTime` — no separate `order` field. Drag-and-drop edits the time. Untimed items live in a separate "loose" section with their own ordering. See *PlanItem → Ordering* above.
- **Multi-place plan items:** Default is one PlanItem per stop, linked by `groupId`. Use a single PlanItem with `placeIds[]` only when the operator binds the stops as one inseparable unit. See *PlanItem → Multi-place tours and routes* above.
- **Route mode commitment:** Destination Selector gathers `modeOptions[]`; the trip view commits `modeChosen`. Default carries from the brief's `transport` field. See *Route → When `modeChosen` gets set* above.
- **Naming — Destination Selector vs Picker:** "Destination Selector" is the canonical name. "Picker" remains a valid code-level alias.
- **Day-trip representation:** PlanItem with `type: dayTrip` on the hub's day is the canonical form. Legacy `dest.dayTrips[]` chips are being migrated out. See *PlanItem → dayTrip* above.

---

*Living doc. Update when the model evolves.*
