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
│           ├── {type:"sight" | "meal" | "stop" | …, placeId}      → trip.places
│           └── {type:"route", routeId}                            → trip.routes
├── routes[]                 first-class container objects, peer to Destinations
│   ├── id, kind             "transit" | "dayTrip" (loop, from === to)
│   ├── fromDestId, toDestId
│   ├── modeOptions[]        train | car | flight | bus | ferry | walk
│   ├── modeChosen
│   ├── durationHours, distKm, character, fuelStops[]
│   ├── transitDays[]        day IDs this route spans (back-ref to destinations[].days[].id)
│   └── planItems[]          stops on this route (waysides for transit; the
│                            destination of the loop for dayTrip)
│       └── {type:"stop", placeId, note, recommendedMin, priority}
├── pendingActions[]         Max's nudges to the user
├── candidates[]             picker carry-forward (working set)
└── notes                    freeform trip-level notes
```

The **Calendar** is *not* in this tree. It's a **computed view** over `destinations[].days[].planItems[]` and `routes[].transitDays[]`, sliced by date instead of by destination. There is no separate Calendar storage.

The **graph** is intentional. Place is always the leaf. PlanItems are the universal joining type — sights, meals, stops, AND route references all share the same shape. Days contain PlanItems; Routes contain PlanItems; both are time-bound containers, differing only in what they *are* (a sleeping stop vs. a moving segment).

The **Day ↔ Route relationship is bidirectional**:
- A day's `planItems[]` can contain `{type:"route", routeId}` — the drive appears on that day's plan as a real item.
- The route's `transitDays[]` lists the day IDs it spans (a multi-day drive lists multiple days).

Both sides hold the same fact. Writers that add/remove/reorder a drive must update both — there's a `attachRouteToDays(route, dayIds)` / `detachRouteFromDays(route)` helper pair to maintain consistency, and a consistency check on save.

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

A single thing happening on a Day or along a Route. Unified type with a state machine. Replaces the older split between "Booking / Suggestion / Scheduled Place" and now also serves as the type that joins Days to Routes (`type:"route"`) and as the wayside / day-trip-target stop type on routes (`type:"stop"`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable |
| `state` | enum | `suggestion` / `scheduled` / `booked` — state machine below |
| `placeId` | string | ref → `trip.places[placeId]` — required for place-anchored types (`sight`, `meal`, `stop`, `hotel-checkin`/`out`, `event`) |
| `routeId` | string | ref → `trip.routes[routeId]` — required for `type:"route"` and forbidden on other types |
| `type` | enum | `sight` / `meal` / `transit` / `hotel-checkin` / `hotel-checkout` / `stop` / `route` / `event` / `freeTime` / `other` |
| `startTime` | time | Optional; absent for state=suggestion |
| `endTime` | time | Optional |
| `duration` | number | Minutes; optional, derived if start+end set |
| `recommendedMin` | number | For `type:"stop"` — Max's suggested stop duration (different from `duration`, which is the user's chosen time-allocation if any) |
| `priority` | enum | For `type:"stop"` — `iconic` (must / strongly recommended) / `if-time` (worth stopping if time allows) / `optional` (placeholder) |
| `booking` | object | Present when state=booked: `{ confirmation, vendor, price, modifyUrl, cancelUrl }` |
| `notes` | string | User notes |
| `source` | enum | `llm-suggestion` / `user-added` / `imported` |

**Type semantics (when each is used):**
- `sight` / `meal` / `event` / `freeTime` — placed on a Day's `planItems[]`. Anchored to a Place.
- `stop` — placed on a Route's `planItems[]`. Anchored to a Place. The wayside POI on a transit route, or the destination of a day-trip loop. `priority` distinguishes "stop if time" from "iconic / the point of this trip."
- `route` — placed on a Day's `planItems[]`. References a route. Lets the drive itself appear as a real item in the day plan.
- `transit` — legacy; specific transit-leg items (a train segment, a flight) inside a route's transit-day plan. May get folded into `stop` or stay as its own type — TBD.
- `hotel-checkin` / `hotel-checkout` — placed on Day boundary days; tied to a Destination's accommodation.

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

**A day-trip is a Route, not a PlanItem.** A trip from Reykjavik to the Blue Lagoon and back is a `Route` with `kind:"dayTrip"`, `fromDestId === toDestId === Reykjavik`, `transitDays:["d3"]` (the day the loop happens on), and the day-trip's destination (Blue Lagoon) as a `{type:"stop", priority:"iconic"}` PlanItem in the route's `planItems[]`. The hub destination's day plan references it: `hubDest.days[someDayIdx].planItems = [..., {type:"route", routeId}, ...]`.

This is the same data shape as a transit route (Reykjavik → Vík with waysides along the way); only the `kind` field and `from === to` distinguish them. Unifying the two means the picker, the trip-view map, the day plan, and the LLM all reason about one concept (Route-with-Stops) instead of two.

The earlier representations — `dest.dayTrips[]` chips, then `{type:"dayTrip", placeId}` PlanItems on the hub's `day[0]` — are both legacy. The schema-version migration walks every trip on read, lifts those PlanItems out into `trip.routes[]` entries with `kind:"dayTrip"`, and replaces them with `{type:"route", routeId}` references on the same day.

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

A **first-class container**, peer to Destination. Holds the geography and semantics of a single transit segment OR a day-trip loop, owns its transit days, owns its own ordered PlanItems (stops along the way).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable; derived from endpoints (`r-${fromDestId}-${toDestId}` for transit, `r-dt-${hubDestId}-${stopPlaceId}` for day-trips). Regenerates naturally when destinations reorder. |
| `kind` | enum | `transit` (point-to-point, `from !== to`) / `dayTrip` (loop, `from === to`) |
| `fromDestId`, `toDestId` | string | refs → `trip.destinations[].id`. Same value for day-trip loops. |
| `modeOptions` | array | `['train', 'car', 'flight', 'bus', 'ferry', 'walk']` — populated by LLM in the Destination Selector |
| `modeChosen` | enum | Single mode the user committed to — set in the trip view |
| `transitDays` | array | Day IDs this route spans. Bidirectional with `day.planItems[{type:"route", routeId}]` — keep in sync. |
| `durationHours` | number | Total movement time (drive / train / flight). Drives the "is this an easy or exhausting day?" math. |
| `distKm` | number | Distance, useful for day-trip-radius and for the realism check |
| `character` | enum | `transit` / `scenic` / `ferry-leg` / `urban` — surfaces "is the drive itself worth time?" on the map |
| `fuelStops` | array | Place IDs of suggested gas/charging stops (self-drive routes only) |
| `planItems` | array | Stops along the route — see *PlanItem* (`type:"stop"`). For a transit route, these are waysides; for a day-trip route, they include the destination-of-the-loop with `priority:"iconic"`. |
| `bookings` | array | Multi-leg booking refs (train ticket numbers, ferry reservations) |
| `notes` | string | |

**Two kinds of route, same shape.**
- `kind:"transit"` — Reykjavik → Vík. `planItems[]` holds waysides (Seljalandsfoss as a 20-min stop, Skógafoss as a 30-min stop, …).
- `kind:"dayTrip"` — Reykjavik → Blue Lagoon → back to Reykjavik. `from === to`, `planItems[]` holds at minimum the destination of the loop (Blue Lagoon as a `priority:"iconic"` stop), plus any side-trip waysides on the way.

The picker surfaces `planItems[]` candidates per route. The map renders the polyline AND the stops as beaded dots along it. The trip-view day plan references the whole route via a `{type:"route", routeId}` PlanItem on the day it occurs.

**The Day's day plan vs the Route's stops list.** Two different orderings:
- `day.planItems[]` — what happens on this calendar day, by time of day. Includes things at the destination AND a route-reference for any drive on this day.
- `route.planItems[]` — stops on this route, in geographic order along the path (driving direction). Doesn't carry time-of-day; the time falls out of `durationHours` + start-of-drive + the user's pace.

**When `modeChosen` gets set.** The Destination Selector gathers `modeOptions[]` per route but doesn't commit a mode. The trip view is where the user picks — each Route card shows the options as a chip group, pre-selected to the trip's default transport (carried from the brief). One click swaps. Time / booking / drive-time math reads `modeChosen` only. Picking a mode doesn't re-build the trip — it retunes that one route's transit days, drive-time math, and any predicted waysides whose categories depend on mode (gas stops only when driving, etc.).

**Wayside source.** The LLM populates `route.planItems[]` with `type:"stop"` candidates on Choreograph, given the from / to / mode / character. The picker presents them grouped by route ("Reykjavik → Vík · 3.5 h drive · 4 stops suggested") for keep/reject. Same `_keep`-ish semantics as destinations.

**Bidirectional sync with Day.** `route.transitDays[]` and `day.planItems[{type:"route", routeId}]` are two indexes of the same fact (which days this route occupies). Writers that attach / detach / reorder a drive must update both. Helpers: `attachRouteToDays(route, dayIds)` and `detachRouteFromDays(route)`. Consistency check on save flags any drift.

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
- **Day-trip representation:** Day-trips are **Routes**, not PlanItems. A `kind:"dayTrip"` route with `from === to`, the destination of the loop carried as a `{type:"stop", priority:"iconic"}` PlanItem in the route's `planItems[]`. Day plan references via `{type:"route", routeId}`. Legacy `{type:"dayTrip"}` PlanItems and earlier `dest.dayTrips[]` chips are both migrated out on read. See *Route → Two kinds of route* above.
- **Routes as first-class containers:** Routes peer to Destinations. Both hold ordered `planItems[]`. Routes own their own transit days, mode, character, distance. The picker selects waysides on routes alongside destinations to sleep in. See *Route* above.
- **Day ↔ Route bidirectional reference:** A day's `planItems[]` can contain `{type:"route", routeId}`; the route's `transitDays[]` lists day IDs. Two indexes of the same fact, maintained by `attachRouteToDays` / `detachRouteFromDays`. Verified by a consistency check on save.
- **Wayside source:** LLM populates route `planItems[]` on Choreograph from the (from, to, mode, character) tuple. User keeps / rejects in the picker. No manual-only path required (though `source:"user-added"` stays available).
- **Wayside priority:** Three levels: `iconic` (don't skip — the point of the route's character / the destination of a day-trip loop) / `if-time` (stop if time allows; default for waysides on transit routes) / `optional` (placeholder). All waysides are inherently optional in execution; `priority` ranks them.

---

*Living doc. Update when the model evolves.*
