# Max — Architecture principles

A working document. Captures the structural decisions that shape what
goes where in Max, so future rounds don't re-litigate them.

---

## The core principle: shape vs. calendar

> **The picker owns the SHAPE of the trip. The trip owns the CALENDAR.**

- **Shape** is conceptual and time-independent: which places the
  traveler wants to go, which activities they want to do, how many
  nights at each, what order, and the trip-mode framing
  (public-transit vs road trip vs mix). Captured in `_tb` during the
  picker session and snapshotted into `trip.candidates` /
  `trip.mdcItems` / `trip.brief` when the user clicks
  *Choreograph my trip →*.

- **Calendar** is the materialized realization of that shape on
  specific dates: `dest.dateFrom` / `dest.dateTo` per destination,
  hotel and transport bookings tied to absolute dates, sights
  scheduled onto specific days, the entry/exit logistics with their
  flight numbers and times. Lives on `trip.destinations[]` and
  `trip.legs[]`.

When shape changes, the calendar adapts where it can (re-derive
dates from new sequence + nights, dump scheduled sights onto the
new day grid by clamping the index) and gets surfaced for human
action where it can't (a hotel booking whose dates fall outside the
destination's new range becomes a `PendingAction` — Max can't cancel
the reservation; the user has to make the call).

---

## What lives where

| Concern | Lives in | Owned by |
|---|---|---|
| Region, place, traveler context (party, pace, prefs) | `_tb` → `trip.brief` | shape |
| Picked activities, kept places, nights per place | `_tb.placeActivities`, `trip.mdcItems`, `trip.candidates` | shape |
| Trip-mode (transit vs road) — *future* | `trip.brief.tripMode` | shape |
| Destination sequence + per-dest nights | `trip.destinations[].nights` | shape, projected onto calendar |
| Calendar dates per destination | `trip.destinations[].dateFrom/dateTo` | calendar (derived) |
| Days array per destination | `trip.destinations[].days[]` | calendar |
| Sights placed on specific days | `dest.days[].items[]` | calendar |
| Hotel bookings (date-locked) | `dest.hotelBookings[]` | calendar |
| Transport bookings (date-locked) | `trip.legs[].bookings[]` | calendar |
| Sight bookings with times | `dest.generalBookings[]` (or on day-items) | calendar |
| Pending actions (provider-side cancellations) | `trip.pendingActions[]` | calendar |

Anything date-bound is calendar-side. Anything that describes intent
without dates is shape-side.

---

## The iteration loop

**Historical note**: the bidirectional picker ↔ trip loop is a
recent capability. The trip-edit path (`previewConstraintChanges`)
has always existed but was forward-only — edit dates, accept the
cascade, lose any scheduled sights silently. The picker-edit path
needed *persistent state* in both directions to enable real
iteration. Round BK introduced re-opening the picker with the
trip's current keep/reject state; Round CG.2 preserved nights;
Round DS preserved scheduled sights via a snapshot/restore cycle;
Round DT validated bookings and surfaced them as PendingActions
instead of dropping them. **Round DW** then replaced the entire
snapshot/restore mechanism with an *identity-preserving incremental
reconcile* in `_reconcileDestinations`: surviving destinations are
mutated in place rather than rebuilt from scratch, so every dest
field (bookings, day items, suggestions, locations, dayTrips,
execMode, generated*) survives automatically by reference. Adding
new dest state no longer requires remembering to add it to a
preservation list — that was the bug class that kept regressing.

That stack of changes is what turned the picker from
"commit and live with it" into the iteration loop the rest of
this section describes.

The picker → trip flow is bidirectional. The user iterates:

```
home → brief → picker → "Choreograph my trip" → trip view
                  ↑                                ↓
                  └────── "Edit destinations" ─────┘
```

Each loop pass goes through `reopenPickerForEdit` → user mutates
shape → `saveActivityPickerEdits` → `findCandidates` →
`buildFromCandidates` → fresh `trip.destinations[]`.

### Preservation rules across rebuilds

What survives a rebuild and what gets re-derived:

**Survives via `trip.mdcItems` hydration** (Round BK):
- Activity selections (which destinations, which activities, what
  the user kept vs. discarded)
- Activity-level metadata (iconic flag, duration, route endpoints)

**Survives via identity preservation in `_reconcileDestinations`** (Round DW —
replaces the Round BK/DS `_tb._editPreservedByPlace` snapshot mechanism):
- Anything attached to a surviving destination object — bookings,
  locations, suggestions, day items, day trips, execMode, todayItems,
  discoveredItems, attachedEvents, generated\* fields, plus any new
  fields added in the future. Surviving destinations are mutated in
  place rather than rebuilt, so every reference and field carries
  forward by JS object identity. The matching is by
  `_normPlaceName(place)` to handle diacritics.
- For destinations whose nights changed: `days` is regenerated and
  existing day items are clamped onto the new day grid (items from
  dropped days fall onto the last surviving day; transport/transit
  chips are skipped since the build re-injects them fresh).

**Re-derived from shape** (not preserved):
- `dateFrom` / `dateTo` per destination — recomputed from the new
  sequence + nights + start date
- Day order within destinations — `makeDays` regenerates the grid
- Day-trip absorption — Round CO/DA re-runs the clustering
- Geographic destination order — Round CN re-runs nearest-neighbor
  (or DO's angular sort for round trips)
- Auto-seeded iconic sights on days — Round S/DB re-seeds (with the
  preserved sights merged on top, de-duped by name)

**Validated and surfaced as PendingAction** (Round DT):
- Hotel bookings whose dates fall outside the destination's new
  range. Booking record stays visible; pending-action calls for
  provider contact.
- (Future: transport bookings on dropped legs, sight bookings on
  vanished days.)

---

## Trip-mode as shape-side knowledge

Trip mode (public-transit vs road trip vs mix) is a shape-level
signal that should propagate through:

- **Day-trip absorption distance**: 60km for transit, 150–200km for
  road. (Round CO uses fixed 60km today — needs a transport-mode
  branch.)
- **Round-trip detection** in `orderKeptCandidates`: angular sort
  works for transit-style hub-and-spoke; road trips often want
  *no* reordering at all because the sequence IS the route.
- **Day-trip prediction** in the picker (Round DN.7): the
  "(day trip from X)" label assumes hub-and-spoke. For a Ring Road
  Iceland trip, every overnight is on the way to the next
  overnight — there are no day-trip-from-hub absorptions. The
  prediction should be suppressed or different in road-trip mode.
- **LLM prompts**: the brief context tells the LLM whether the
  user is moving by car or train. `_briefPersonalContext` already
  surfaces `transport`, but explicit trip-mode would give more
  reliable signal than free-text parsing.

### Two trip shapes worth modeling

**Public transit (hub-and-spoke)**
- Schedules dictate movement; the graph is fixed
- Day trips work because hubs are 30–90 min from many other nodes
- Backtracking is fine (rebook a train)
- Density of stops is high
- Examples: Switzerland, Japan, Italy, much of Europe

**Road trip (linear or circular tour)**
- *You* dictate movement; anywhere with a road is a candidate
- Time matters more than distance
- The journey IS structure; each overnight is a stage on a route
- Backtracking costs hours of driving — avoid
- Day trips often *don't exist* — the day's drive is the day
- Density of stops is low
- Examples: Iceland, Patagonia, American Southwest, Outback Australia

Round CO/DA/DN.7 logic should branch on this signal once it's
explicit on the brief.

---

## Activity taxonomy: planning vs. execution

Two parallel six-category taxonomies. See `taxonomy.md` for the
detailed descriptions and edge cases.

**Planning mode** (drives the picker's section grouping + LLM prompts):
1. Outdoor activities
2. Scenery & nature
3. Culture & history
4. Food & drink
5. Connections & gatherings
6. Wellness & personal growth

**Execution mode** (drives the destination detail's "On the ground" tab):
1. Getting around (with structured ride-share field)
2. Daily essentials
3. Help & safety
4. Getting to know the place
5. Saving money
6. Cultural norms

Taxonomy is **prefer, don't enforce**: prompts ask the LLM to pick
the closest category; code consuming activity output does not
reject items missing a category or with an unrecognized one.
Long-tail items live via "+ Add a place" / "+ Add an experience"
manual paths.

---

## Caching layers

Multiple caches live in the app at different layers — each fixes a
specific slowness:

- **`callMax` IDB cache** (Round CL.3): SHA-256 of every prompt → response.
  Survives reloads. Deterministic builds for repeat runs of the same
  brief. TTL + LRU eviction.
- **`_generatedCityData`** (in-memory): per-place city data
  (sights, districts, hotels, practical info, transit hubs).
  Persists onto `dest.generated*` fields when generation completes.
- **`_placeNarrativeCache`** (Round CQ.1): place description prose.
  In-memory only.
- **`_placeExecutionCache`** (Round CY): the on-the-ground 6-group
  payload. In-memory only.
- **`_coarseGeocode`**: lat/lng for places, seeded from LLM output
  + Nominatim. Persists in localStorage.

Failure mode: when a cache lookup hits an entry from a stale prompt
shape (e.g. we added a field to the schema), the cache key includes
the prompt, so the new prompt naturally misses cache and fetches
fresh. Prompt evolution is a cache-busting strategy.

---

## Service worker versioning

`sw.js` bumps `CACHE = 'max-vNN'` on every shipped change. Network-
first strategy (Round BJ) — try the network, fall back to cache only
on offline. The version bump triggers `skipWaiting` + claim, so
the next page load (or hard refresh) gets the new HTML.

User-visible behavior: **a hard refresh after any deployment is
recommended.** The dashboard, brief redesigns, and similar architectural
changes won't appear until the SW updates.

---

## Future structural work

- **Trip-mode question on Brief Step 2** (Public transit / Road trip
  / Mix) — explicit field, drives downstream algorithms.
- **Cloud-backed trip data** — current localStorage architecture means
  trips can't sync between devices. Mobile companion (read + edit
  on the road) needs a backend (or device-pairing).
- **Booking validation extends to transport + sight bookings**
  beyond Round DT's hotel-only validation.
- **"What changed" summary** when the user clicks Update → trip
  rebuilds. Currently silent except for new PendingActions; a
  summary banner would make iteration's cost visible.

---

## Max suggests, user decides

The auto-clustering arc (Round CO → EV) crystallized a principle worth
making explicit and propagating:

> **The system surfaces choices and consequences. The user makes
> the call.**

The picker already follows this — it collects intent ("X nights at
Y") without relitigating it. Round EV brought day-trip clustering
into line: instead of the algorithm silently turning Schaffhausen
into a chip on Zurich at build time, the destination's Explore tab
now shows "Could be a day trip from here" with a button. User
decides.

There are still places where the build silently chooses on the
user's behalf:

- **Night-clamp trims the user's longest stays** (Round CH) when
  picker total exceeds the duration budget. Round EQ surfaces this
  as a banner *after the fact* ("Trimmed to fit your 28-day budget:
  Zurich 3n→2n, Bern 4n→3n"). Better: present the proposal as a
  modal *before* applying — "You're 2 nights over budget. Drop a
  destination, shorten one, or extend your dates" — and let the
  user pick which lever to pull.
- **Buffer-night appends an exit Zurich stop** when entry == exit
  (Round BL/BM). Was silent — always-on by default unless the user
  unchecked it on the picker, but the trip view never surfaced
  that the extra destination was Max's call. **Round FE addresses
  this:** trip view now shows a blue informational banner —
  "Buffer night in {city}. Max added one night here before your
  flight, so a late arrival from your last stop doesn't push you
  onto same-day flying. [Drop the buffer] [Keep it]." Drop removes
  the destination + clears the toggle; Keep dismisses the banner
  for this trip. Halfway between disclosure banner (EQ/ER tier)
  and surfaced-choice-up-front (EV tier) — the user gets the
  decision in front of them with a one-click reverse, but the
  default is still applied first. Acceptable because it's a
  late-arrival safety net most users want.
- **Ordering reorders kept candidates geographically** (Round CN —
  nearest-neighbor for linear, Round DO angular sort for round
  trips). On reflection, **this is not a silent decision worth
  surfacing**, despite originally being listed here. The picker
  groups destinations by category, not by sequence — so the user
  never expressed an order preference for the build to override.
  Some sequence has to be picked, and the geographic one is a
  reasonable default. If the user wants a different order, the
  up/down arrows + drag-and-drop on the trip view are the right
  surface. Round FF tried adding a "Restore picker order" banner;
  Round FG reverted it because "picker order" wasn't a real
  thing the user could meaningfully prefer.

  Lesson: not every build-time choice is a silent decision worth
  surfacing. Only the ones where the user had (or could
  reasonably be expected to have) a competing preference. The
  buffer-night qualifies because Max adds an extra destination
  the user didn't pick. The geo-reorder doesn't qualify because
  there's no alternative the user can be said to prefer.

The pattern across all three: **detect → propose → ask → apply**,
not detect → apply → disclose. The disclosure banners (EQ, ER) are
a halfway measure — they restore transparency but don't restore
agency. The full move is to surface the choice up front.

Rounds EQ + ER are the "cover existing silent decisions with a
disclosure banner" tier. Round EV is the "convert silent decision
to user-controlled action" tier. The latter is the direction
everything else should converge toward.

---

## Where Max sits, what it does well, what's behind

Snapshot taken after the FA–FK trip-view sweep. Worth keeping in
mind as a north star while the next layers (functional verification
of card affordances; visual layer; mobile; collaboration) get
attended to.

### The category Max plays in

A *multi-destination trip choreographer*: user names intent
(interests, anchors, dates, transport mode), Max sequences a
real itinerary with stops, transport, lodging, sights. That's a
different posture from the field:

- **Wanderlog / TripIt** — aggregators. You bring the bookings;
  they organize them.
- **Google Travel** — suggestion-aggregator. Limited active planning.
- **Roadtrippers** — route-anchored. The journey *is* the trip.
- **ChatGPT-for-travel** — conversational but stateless.
- **Lonely Planet + spreadsheet** — editorial + manual.

Max's home territory is "I want to do a 3-week Switzerland trip
with these constraints; figure out a sensible structure I can
edit." Nothing else does that well.

### What Max does uniquely well

1. **The picker → choreograph flow.** Capturing intent and
   producing a coherent sequence is the differentiator.
2. **Hub + day-trip mental model** with explicit affordances
   (Make day trip / Stay overnight here).
3. **"Max suggests, user decides" pattern** as a design
   discipline (FE buffer-night, EW over-budget actions).
4. **Per-destination AI narrative on demand** (Story / Ask Max)
   richer than static editorial.
5. **Auto-injected transport chips in Itinerary** with
   click-through to Routing booking surface.
6. **Geographic reorder + smart-skip + buffer-night logic** —
   real intelligence in the build, not slot-filling.

### Where Max is weaker than the field

1. **Visual density.** Information-dense left pane vs.
   competitors' photo-forward whitespace.
2. **No photos.** Sights, hotels, destinations are text-only.
3. **Mobile is unaddressed.** Wide-desktop-only assumptions.
4. **No collaboration.** Single-player.
5. **Booking links are search-fallbacks** (Google search), not
   real availability + prices.
6. **No calendar export, share link, or print view.**
7. **Picker complexity.** Sophisticated activity↔place picker
   has a learning curve.
8. **Discoverability.** Many 9–11px text-link affordances.

### Items rough internally

- **Routing tab** can feel like a graveyard once all legs are
  booked (booked legs visible elsewhere too).
- **Logistics form** untested as of FK; lots of fields/modes.
- **No trip-stage awareness** (pre / during / post-trip).
- **Hero map's value scales** — limited on small trips, shines
  on 5+.

### What to borrow

- **Wanderlog**: photography-forward design, day-card
  collaboration, simpler list-to-day drag.
- **TripIt**: booking integration model.
- **Roadtrippers**: stops-along-the-route awareness — relevant
  for Iceland.
- **Google Travel**: calendar-strip + map-anchor pattern.

### Bottom line

The choreographer engine + "suggest/decide" architecture are real
differentiators that are hard to copy. The visual layer (photos,
mobile, collaboration) is the *next* investment after functional
verification of every card affordance is done. Don't conflate the
two — chrome can wait until the engine is proven solid.

---

## Known iteration-loop tensions

Cases where automated clustering / re-derivation can override an
explicit user action on the next rebuild. None are bugs in the
strict sense — they fall out of the "shape vs. calendar" split, where
shape edits trigger a re-derive of calendar consequences. Worth
noting so they're not re-discovered as bugs each time.

- **"Restore as own destination" gets re-clustered.** [Mostly
  resolved by Round EV.] Auto-clustering is now disabled, so this
  no longer fires. If clustering ever returns as a transit-mode
  default, it'd need a `_userOverride: true` flag set by ungroup
  to prevent re-absorption.

- **LLM regen on every picker save.** `runCandidateSearch` re-prompts
  the LLM on every iteration loop pass, which means small edits
  (uncheck one place) cost a full ~30s regen. Could be skipped when
  `_tb.requiredPlaces` matches the previous prompt's required set,
  reusing `trip.candidates` as-is. Cache key for `callMax` covers
  identical prompts; doesn't cover the "skip the call entirely"
  case.

---

*Last updated: 2026-05-02. Add to this doc when an architectural
decision crystallizes, not for incremental polish work.*
