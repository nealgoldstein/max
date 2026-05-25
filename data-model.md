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
Trip extends Segment             ← v3: the envelope IS itself a Segment
├── kind: "trip"
├── startsAt, endsAt              derived from dates (no explicit order field)
├── arrival                       routeId → trip.routes — receptacle holding inbound Route
├── departure                     routeId → trip.routes — receptacle holding outbound Route
├── stays[]                       Stay-segments, sorted by date
├── routes[]                      ALL Route-segments (arrival, departure, transits, dayTrips)
├── places{}                      canonical Place dictionary (leaf data)
├── brief                         user intent (dates, party, pace, transport, …)
│                                 — defaults; per-segment overrides win
├── pendingActions[]              Max's nudges to the user
├── candidates[]                  picker carry-forward (working set)
└── notes

Stay extends Segment              ← what v2 called Destination
├── kind: "stay"
├── placeId                       where you sleep
├── nights                        = duration in days
├── days[]                        Day-segments, one per calendar night
├── intent                        optional: "recovery", "anchor", "transit-buffer", …
└── (per-segment overrides)       pace, density, avoidances — fall back to brief

Route extends Segment             ← transit / dayTrip / arrival / departure
├── kind: "route"
├── subKind                       "transit" | "dayTrip" | "arrival" | "departure"
├── fromDestId, toDestId          stay ids; for dayTrip loops, from === to
│                                 for arrival, fromDestId may be null (from outside)
│                                 for departure, toDestId may be null
├── modeOptions[], modeChosen
├── durationHours, distKm, character, fuelStops[]
├── transitDays[]                 day IDs spanned (bidirectional with Day.refs[])
└── planItems[]                   stops along the route (waysides; dayTrip target)

Day extends Segment               ← a 24-hour slice within a Stay or a Route
├── kind: "day"
├── date
├── planItems[]                   atomic content placed on this day
└── refs[]                        References to overlapping segments (routes mostly)

PlanItem  (LEAF — not a Segment)
├── id
├── type                          "sight" | "meal" | "stop" | "transit" | "event" | "freeTime"
├── state                         "suggestion" | "scheduled" | "booked"
├── placeId                       ref → trip.places (required for all types)
├── startTime, endTime, duration
├── recommendedMin, priority      for type:"stop"
├── booking                       for state:"booked"
└── notes, source

Reference  (POINTER — not a Segment, not a PlanItem)
├── id
├── targetKind                    "route" | "stay" | "day" (currently mostly "route")
├── targetId                      id of the segment being referenced
├── startTime, endTime            optional — where in the day this segment occupies time
└── source                        "user-scheduled" | "migration" | …
```

The **Calendar** is not in this tree. It's a **computed view** over `stays[].days[].planItems[]`, `stays[].days[].refs[]`, and `routes[].planItems[]`, sliced by date instead of by stay. No separate calendar storage.

The **graph** is intentional. Three kinds of node:

1. **Segments** — containers with internal structure (Trip, Stay, Route, Day). All share a polymorphic base.
2. **PlanItems** — atomic content leaves placed inside Day or Route.
3. **References** — pointers from one Segment (typically a Day) to another (typically a Route). Capture "this day is part of this route" without copying data.

**Ordering is implicit, by date.** No explicit `order` field on Segments — they sort by `startsAt.date`. Position in `stays[]` / `routes[]` is convenient for iteration but not authoritative. Re-ordering happens by changing dates, not by swapping array positions. This makes the model robust to writes that change dates without touching position, or vice versa.

**Per-segment constraints.** Pace, density, avoidance defaults live on `trip.brief`. Each Segment can carry overrides. A Stay marked `intent:"recovery"` runs the realism check against a slower pace than the trip default. The engine reads `segment.<field> ?? trip.brief.<field>`.

**Day ↔ Route bidirectional reference.** A Day can be *content-bearing* (sights, meals) AND *transit-spanning* (a drive happens on it) at the same time. The drive Reykjavik → Vík lands you in Vík at 1pm; the afternoon and evening are spent in Vík. The Day owns its own `planItems[]` for what happens AT Vík, and its `refs[]` lists the Route(s) that ALSO occupy this day. The Route's `transitDays[]` lists the matching day IDs. Two indexes of the same fact, but both useful — the Day knows what's on it, the Route knows when it happens. Writers maintain consistency via `attachRouteToDays` / `detachRouteFromDays`.

**Arrival and departure are routes in trip.routes[], referenced from trip.arrival / trip.departure.** The receptacles are just pointers into the same routes array — no duplication. An arrival route can have its own `planItems[]` (a layover stop in Reykjavik before connecting onward) and `transitDays[]` (the day the user is flying in) just like any other route.

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
| `tripBookings` | array | See *Trip-level bookings* (v359.60.91). Flights and car rentals that don't anchor to a single destination. |
| `createdAt`, `updatedAt` | ISO date | |

### Trip-level bookings

`trip.tripBookings[]` is a flat top-level array introduced in v359.60.91 to hold bookings that span the trip rather than anchoring to a single destination — primarily **car rentals** (pickup and dropoff can be at different cities, vehicle is in your possession for the full rental window) and **multi-leg flights** (one PNR covering several physical legs, possibly with layovers).

Distinct from:
- `destination.hotelBookings[]` — one-place-one-night-or-more stays
- `trip.legs[fromId-toId].bookings[]` — transit tickets between two consecutive destinations
- `destination.generalBookings[]` — activities, restaurants, tours

Each entry has a `kind` discriminator (`flight` or `car`) plus the common booking fields (`confirmationNumber`, `pricePaid`, `currency`, `url`, `notes`, `status`, `source`, `cancelType`, `cancelDeadline`, `cancelDeadlineTime`).

**Car rental shape:**

```js
{
  id, kind: "car",
  vendor: "Hertz",
  pickup:  { location, date, time },   // "Keflavík Airport", "2026-06-02", "07:30"
  dropoff: { location, date, time },   // same location for round-trip rentals
  confirmationNumber, pricePaid, currency, url, notes, status, source,
  cancelType, cancelDeadline, cancelDeadlineTime
}
```

**Flight shape (multi-leg):**

```js
{
  id, kind: "flight",
  legs: [
    {
      from, to,             // "JFK", "KEF"
      depDate, depTime,
      arrDate, arrTime,
      carrier,              // "Icelandair"
      flightNumber,         // "FI614"
      cabin                 // optional
    },
    // …layover legs continue here
  ],
  confirmationNumber, pricePaid, currency, url, notes, status, source,
  cancelType, cancelDeadline, cancelDeadlineTime
}
```

Single-leg flights between consecutive destinations continue to use `trip.legs[fromId-toId].bookings[]` for backward compatibility — only multi-leg flights and standalone trip-level flights route here.

### Brief

The user's stated intent for the trip. Captured in the brief flow ("Tell Max about your trip"). Read by the LLM at candidate-generation time, by the realism check, and by anything that needs trip context.

| Field | Type | Notes |
|---|---|---|
| `placeName` | string | Region / country / city user typed |
| `placeContext` | string | "Why this place" — drives bucketing |
| `startDate`, `endDate` | ISO date | Optional; if absent, anchored by `duration` |
| `duration` | string | "10 days", "2 weeks" — parsed by `_parseTripDuration` |
| `entry`, `tbExit` | string | Arrival / departure cities |
| `entryMode`, `exitMode` | enum | `fly` / `train` / `drive` / `bus` / `boat` — how the user gets in / out. Drives label vocabulary on `entryDetails`/`exitDetails` ("Flight number" → "Train number" → "Vessel / route") and the glyph rendered on the collapsed Arrival/Departure summary. Defaults to `fly` on read when unset. |
| `entryDetails`, `exitDetails` | object | Logistics for the inbound/outbound leg — `{ carrier, number, date, time, confirmation, notes, url }`. Field labels in the UI flip by mode (above); field keys stay stable so persistence doesn't migrate. |
| `shape` | enum | Optional explicit override of trip shape: `round` / `open-jaw` / `multi-leg`. No UI sets this today — readers use `_getTripShape(brief)`, which falls back to inference (`entry === exit` ⇒ round, otherwise open-jaw; multi-leg reserved for a future slice with explicit UI). The field exists in the schema so a future "same city, different airports" override can write to it without code change downstream. |
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

### Segment (polymorphic base — v3)

Everything in `trip.stays[]`, `trip.routes[]`, and `stay.days[]` — plus the Trip envelope itself — extends Segment. Shared shape:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable |
| `kind` | enum | `trip` / `stay` / `route` / `day` |
| `startsAt` | object | `{ placeId?, date, time? }` — Date is required for ordering; placeId optional. |
| `endsAt` | object | Same shape; for a Day, `endsAt.date === startsAt.date + 1`. |
| `notes` | string | User notes |

Ordering of sibling segments (`stays[]`, `routes[]`) is implicit by `startsAt.date`. No explicit `order` field; sorting derives from dates. Re-ordering = changing dates.

Kind-specific fields are listed in each subtype below.

### Stay

An overnight stop. Extends Segment with `kind:"stay"`.

| Field | Type | Notes |
|---|---|---|
| `placeId` | string | ref → `trip.places[placeId]` — where you sleep |
| `nights` | number | Duration in days (also derivable from `endsAt.date - startsAt.date`) |
| `pois` | string[] | placeIds of POIs the user might visit from this stay |
| `days` | array | One Day-segment per calendar night, see *Day* |
| `intent` | string | Optional: `"recovery"`, `"anchor"`, `"transit-buffer"`, free text. Drives per-segment pace overrides. |
| `accommodation` | object | Booked hotel: `{ placeId, confirmation?, checkIn, checkOut }` |
| `weather` | object | Cached weather forecast |
| `execMode` | object | Day-of-trip state: tracker items, etc. |
| `paceOverride` | object | Optional per-stay overrides — `{ hoursPerDay?, maxBigSightsPerDay? }`. Fall back to `trip.brief`. |

POIs vs PlanItems: the `pois[]` list is the *menu* of places Max thinks are worth visiting from this stay. PlanItems are the *commitments* — which of those POIs (plus any others) end up on a specific day.

### Day

A 24-hour calendar slice. Extends Segment with `kind:"day"`. Belongs to a Stay (in `stay.days[]`) and may also be referenced from one or more Routes (via `route.transitDays[]`).

| Field | Type | Notes |
|---|---|---|
| `date` | ISO date | Calendar day this slice represents |
| `planItems` | array | Atomic content placed on this day — sights, meals, events, free-time blocks. See *PlanItem*. |
| `refs` | array | References to overlapping segments (mostly Routes). See *Reference*. A drive that lands you here in the afternoon shows up as a Reference; the afternoon's PlanItems and the Reference can coexist on the same Day. |

A Day can be *both* content-bearing AND transit-spanning. A morning drive into Vík plus afternoon sights at Vík sit on the same Day — the drive is a `refs[]` entry pointing at the Route; the sights are `planItems[]`.

### PlanItem (LEAF — not a Segment)

The atomic content unit placed inside a Day or a Route. Has time + place but no internal structure. Distinct from Segment (containers) and Reference (pointers).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable |
| `type` | enum | `sight` / `meal` / `stop` / `transit` / `hotel-checkin` / `hotel-checkout` / `event` / `freeTime` / `other` |
| `state` | enum | `suggestion` / `scheduled` / `booked` — state machine below |
| `placeId` | string | ref → `trip.places[placeId]` — required for all types |
| `startTime` | time | Optional; absent for state=suggestion |
| `endTime` | time | Optional |
| `duration` | number | Minutes; optional, derived if start+end set |
| `recommendedMin` | number | For `type:"stop"` — Max's suggested stop duration |
| `priority` | enum | For `type:"stop"` — `iconic` / `if-time` / `optional` |
| `booking` | object | Present when state=booked: `{ confirmation, vendor, price, modifyUrl, cancelUrl }` |
| `notes` | string | User notes |
| `source` | enum | `llm-suggestion` / `user-added` / `imported` |

**Type semantics:**
- `sight` / `meal` / `event` / `freeTime` — placed on a Day's `planItems[]`. Anchored to a Place.
- `stop` — placed on a Route's `planItems[]`. Anchored to a Place. The wayside POI on a transit route, or the destination of a day-trip loop. `priority` distinguishes "stop if time" from "iconic / the point of this trip."
- `transit` — specific transit-leg items (a train segment, a flight) inside a route's transit-day plan.
- `hotel-checkin` / `hotel-checkout` — placed on Day boundary days; tied to a Stay's accommodation.

Note: in v2 a `type:"route"` PlanItem represented "the drive happens on this day." In v3, that's promoted to a **Reference** (see below), and `type:"route"` is removed from PlanItem's enum. PlanItems are leaves; references between Segments live in the dedicated Reference type.

### Reference (POINTER — not a Segment, not a PlanItem)

Captures "this Segment overlaps with this one." Lives in `Day.refs[]` today (a Day reffing a Route). Could appear elsewhere if the model grows other cross-segment relationships.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable |
| `targetKind` | enum | `route` (today) / `stay` / `day` (future) |
| `targetId` | string | id of the Segment being referenced |
| `startTime` | time | Optional — when within the owning Day this referenced segment occupies time |
| `endTime` | time | Optional |
| `source` | enum | `user-scheduled` / `migration` / `auto` |

A Reference is **not** a copy. It's a typed pointer. The referenced Segment's data lives once, in its own array (e.g. `trip.routes[]`). References can be one-to-many (a multi-day route is referenced from each of its `transitDays[]`).

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

**A day-trip is a Route, not a PlanItem.** A trip from Reykjavik to the Blue Lagoon and back is a `Route` with `kind:"route"` + `subKind:"dayTrip"`, `fromDestId === toDestId === Reykjavik`, `transitDays:["d3"]` (the day the loop happens on), and the day-trip's destination (Blue Lagoon) as a `{type:"stop", priority:"iconic"}` PlanItem in the route's `planItems[]`. The hub destination's day references it via `hubDest.days[someDayIdx].refs = [..., {targetKind:"route", targetId}, ...]`.

This is the same data shape as a transit route (Reykjavik → Vík with waysides along the way); only `subKind` and `from === to` distinguish them. Unifying the two means the picker, the trip-view map, the day plan, and the LLM all reason about one concept (Route-with-Stops) instead of two.

The earlier representations — `dest.dayTrips[]` chips, then `{type:"dayTrip", placeId}` PlanItems on the hub's `day[0]`, then `{type:"route", routeId}` PlanItems alongside `day.refs[]` — are all legacy. The schema-version migration walks every trip on read, lifts those PlanItems out into `trip.routes[]` entries, mirrors them as `Reference` entries on `day.refs[]`, and finally (v4) strips the `{type:"route"}` PlanItems from `day.planItems[]` entirely. **`day.refs[]` is the canonical surface; `day.planItems[]` holds only leaf content.**

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

A first-class Segment (`kind:"route"`), peer to Stay. Holds the geography and semantics of a transit segment, a day-trip loop, or the trip's arrival / departure. Owns transit days and its own ordered stops.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable; derived from endpoints + subKind so re-mints reproduce the same id |
| `kind` | enum | Always `"route"` (the Segment kind discriminator) |
| `subKind` | enum | `transit` / `dayTrip` / `arrival` / `departure` |
| `fromDestId`, `toDestId` | string | refs → `trip.stays[].id`. Same value for `dayTrip` loops. May be null for `arrival` (from outside the trip) or `departure` (to outside). |
| `modeOptions` | array | `['train', 'car', 'flight', 'bus', 'ferry', 'walk']` — populated by the LLM in the Destination Selector |
| `modeChosen` | enum | Single mode the user committed to — set in the trip view |
| `transitDays` | array | Day IDs this route occupies. Bidirectional with `day.refs[]` — keep in sync. |
| `durationHours` | number | Total movement time. Drives the "is this an easy or exhausting day?" math. |
| `distKm` | number | Distance, useful for day-trip-radius and the realism check |
| `character` | enum | `transit` / `scenic` / `ferry-leg` / `urban` — surfaces "is the drive itself worth time?" on the map |
| `fuelStops` | array | Place IDs of suggested gas/charging stops (self-drive routes only) |
| `planItems` | array | Stops along the route — `type:"stop"` PlanItems. For `transit`, these are waysides; for `dayTrip`, they include the loop's iconic target. |
| `bookings` | array | Multi-leg booking refs (train ticket numbers, ferry reservations) |
| `paceOverride` | object | Optional per-route overrides for transit-day pacing |
| `notes` | string | |

**Four subKinds, one shape.**
- `subKind:"transit"` — Reykjavik → Vík. `planItems[]` holds waysides along the path.
- `subKind:"dayTrip"` — Reykjavik → Blue Lagoon → back. `from === to`, `planItems[]` holds the iconic target (Blue Lagoon) and any side-stops.
- `subKind:"arrival"` — outside → trip's first stay. Referenced from `trip.arrival`.
- `subKind:"departure"` — trip's last stay → outside. Referenced from `trip.departure`.

The picker surfaces `planItems[]` candidates per route ("Reykjavik → Vík · 3.5 h drive · 4 stops suggested"). The trip-view map renders the polyline AND the stops as beaded dots along it. A Day's `refs[]` includes a Reference to any Route that occupies that day.

**The Day's plan vs the Route's stops list.** Two different orderings:
- `day.planItems[]` — atomic content on this calendar day, by time of day.
- `day.refs[]` — Routes that ALSO occupy this day (e.g. the morning drive).
- `route.planItems[]` — stops on this route, in geographic order along the path. Time-of-day for each stop is computed from `durationHours` + start-of-drive + pace.

**When `modeChosen` gets set.** The Destination Selector gathers `modeOptions[]`; the trip view commits `modeChosen`. Default carries from the brief's `transport` field. One click swaps. Time / booking / drive-time math reads `modeChosen` only. Picking a mode doesn't re-build the trip — it retunes that one route's transit days, drive-time math, and mode-dependent waysides.

**Wayside source.** LLM populates `route.planItems[]` with `type:"stop"` candidates on Choreograph. Picker presents them grouped by route for keep/reject.

**Bidirectional sync with Day.** `route.transitDays[]` and `day.refs[]` are two indexes of the same fact (which days this route occupies). Writers that attach / detach / reschedule a drive must update both. Helpers: `attachRouteToDays(route, dayIds)` / `detachRouteFromDays(route)`. Consistency check on save flags any drift.

**Arrival / departure as receptacles.** `trip.arrival` and `trip.departure` are routeId references into `trip.routes[]`. The route data lives once. Either receptacle may be null while the trip is being planned; the picker fills them in.

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

**Calendar.** A by-date slice of the trip. Walk all `stays[].days[]`, sort by date, and for each Day emit its `planItems[]` (atomic content) plus a synthetic block for each Reference in its `refs[]` (showing the overlapping Route in-context). No separate storage; always derived.

**Unallocated PlanItems.** Filter all PlanItems where `state === "suggestion"` and not attached to any Day's `planItems[]` or any Route's `planItems[]`. Derived.

**Bookings list.** Filter PlanItems where `state === "booked"`. Useful for the "what's confirmed?" view.

**Drive time / total transit.** Sum `route.durationHours` across `trip.routes[]`. Per-day drive time = sum across routes whose `transitDays[]` includes that day's id. Used by the realism check + the per-day intensity meter.

**Per-segment pace.** `segment.paceOverride.<field> ?? trip.brief.<field>`. Lets a `intent:"recovery"` Stay run slower than the trip default without mutating the brief.

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

*(All settled — see Resolved below. Add new questions here as they emerge during the v3 Segment migration.)*

### v3 migration outline (not yet started)

The current persistence is at schema v2 (`{type:"route", routeId}` PlanItem on Days references Route objects in `trip.routes[]`). v3 changes:

- `trip.destinations[]` → `trip.stays[]` (rename). Each gets `kind:"stay"` and `startsAt`/`endsAt`.
- `trip.routes[]` gains `subKind` (`transit` / `dayTrip` / `arrival` / `departure`). v2's `kind` field becomes `subKind`.
- Each Day gets `kind:"day"`, `startsAt`/`endsAt`, and a new `refs[]` array.
- Day's `{type:"route", routeId}` PlanItems migrate to `day.refs[{kind:"reference", targetKind:"route", targetId:routeId}]`. PlanItem's `type:"route"` is removed from the enum.
- `trip` itself gets `kind:"trip"`, `startsAt`/`endsAt` derived from its stays.
- `trip.brief.entry` / `trip.brief.tbExit` migrate to arrival + departure Routes in `trip.routes[]`, referenced from `trip.arrival` / `trip.departure`.
- `_schemaVersion: 2` → `_schemaVersion: 3` after.

Readers + writers (especially `convertDestToDayTrip`, `ungroupDayTripByRouteStop`, `_moveDayTripRouteToHubDay`, the trip-view map, the dest-card chip render) need updating to walk `day.refs[]` instead of `day.planItems[type:"route"]`.

## Resolved

- **Segment as polymorphic base (v3):** Trip, Stay, Route, and Day all extend Segment. Each shares `id`, `kind`, `startsAt`, `endsAt`, `notes`, plus kind-specific fields. Code that operates on "anything with a duration and content" (calendar laying, realism check, drag-and-drop reorder) reads against the Segment shape; kind-specific specializations layer on top.
- **Trip is itself a Segment.** The envelope's `startsAt` / `endsAt` derive from its contained Stays and Routes; arrival/departure receptacles point into `trip.routes[]` so there's a single source of truth for every transit leg.
- **PlanItem is NOT a Segment.** PlanItems are atomic content leaves placed inside Day or Route. Segments are containers. The distinction stays sharp — anything that *contains* other things is a Segment; anything atomic is a PlanItem.
- **Reference is its own type, separate from PlanItem.** A Reference is a pointer from one Segment (Day) to another (Route). Day has `refs[]` for these. Keeps the meaning "atomic content" (PlanItem) and "pointer to another segment" (Reference) distinct rather than overloading PlanItem.type to do both.
- **Implicit ordering.** No `order` field on any Segment. Order is derived from `startsAt.date`. Robust to writes that change one without touching the other. Reordering = changing dates.
- **Per-segment constraints.** Pace, density, avoidances default to `trip.brief` but can be overridden on individual Stay or Route segments. Realism check reads `segment.<field> ?? trip.brief.<field>`.
- **Day ↔ Route bidirectional reference.** A Day's `refs[]` lists Routes that occupy it; a Route's `transitDays[]` lists Days it spans. Both held because a Day can be content-bearing AND transit-spanning at once (drive in the morning, sights in the afternoon).
- **Time ownership (Day vs PlanItem):** PlanItems own absolute times. Day has no `startTime`. UI offers an auto-stack affordance for ergonomics. See *PlanItem → Time ownership* above.
- **PlanItem ordering:** Timed items sort by `startTime` — no separate `order` field. Drag-and-drop edits the time. Untimed items live in a separate "loose" section with their own ordering. See *PlanItem → Ordering* above.
- **Multi-place plan items:** Default is one PlanItem per stop, linked by `groupId`. Use a single PlanItem with `placeIds[]` only when the operator binds the stops as one inseparable unit. See *PlanItem → Multi-place tours and routes* above.
- **Route mode commitment:** Destination Selector gathers `modeOptions[]`; the trip view commits `modeChosen`. Default carries from the brief's `transport` field. See *Route → When `modeChosen` gets set* above.
- **Naming — Destination Selector vs Picker:** "Destination Selector" is the canonical name. "Picker" remains a valid code-level alias.
- **Day-trip representation:** Day-trips are **Routes** (`subKind:"dayTrip"`, `from === to`), with the loop destination as a `{type:"stop", priority:"iconic"}` PlanItem in the route's `planItems[]`. The day's reference to the route is a **Reference** (v3) — `{kind:"reference", targetKind:"route", targetId}` in the Day's `refs[]`. The v2 form (`{type:"route", routeId}` as a PlanItem on the day) is migrated out on the v2→v3 read. Pre-v2 forms (`{type:"dayTrip"}` PlanItem; legacy `dest.dayTrips[]` chips) are also handled by the migration chain.
- **Routes as first-class containers:** Routes peer to Destinations. Both hold ordered `planItems[]`. Routes own their own transit days, mode, character, distance. The picker selects waysides on routes alongside destinations to sleep in. See *Route* above.
- **Day ↔ Route bidirectional reference:** A day's `planItems[]` can contain `{type:"route", routeId}`; the route's `transitDays[]` lists day IDs. Two indexes of the same fact, maintained by `attachRouteToDays` / `detachRouteFromDays`. Verified by a consistency check on save.
- **Wayside source:** LLM populates route `planItems[]` on Choreograph from the (from, to, mode, character) tuple. User keeps / rejects in the picker. No manual-only path required (though `source:"user-added"` stays available).
- **Wayside priority:** Three levels: `iconic` (don't skip — the point of the route's character / the destination of a day-trip loop) / `if-time` (stop if time allows; default for waysides on transit routes) / `optional` (placeholder). All waysides are inherently optional in execution; `priority` ranks them.

---

*Living doc. Update when the model evolves.*
