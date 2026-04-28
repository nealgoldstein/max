# Gallery-first trip planning — design notes

Context for the work-in-progress template gallery system, and the open design
questions for extending it to multi-destination trips.

## The core insight

Travelers plan trips by starting from a *shape* (a suggested itinerary, a guide
book's "7-day Swiss Alps circuit," a friend's trip) and then customizing —
adding, removing, swapping. They almost never start from a blank slate and
assemble a trip by picking individual destinations from a list.

The current app's "Places to think about" page is a candidate-list model: a
bag of places, decide for each whether to keep or reject. This works for
travelers who already know what they want, but forces a cold-start decision
for most people. It also hides the *why* of a trip — the reason Zermatt and
St. Moritz land next to each other is because the Glacier Express connects
them, which is the kind of logic a list of places can't express.

The gallery model inverts this: show 3 complete trip shapes, each with a
thesis. The user picks one to react to, then edits from there. The candidate
system, the must-do logic, and the scheduler all become tools the *editor*
uses — not the primary surface.

See: `gallery-prototype.html` (Switzerland, 4 weeks), `gallery-iceland.html`
(Iceland, 2 weeks, aurora-focused).

## Why 3 templates, not 5 or 10

Three is enough to show real alternatives (comprehensive vs. compact vs.
extension, or full-circuit vs. south-focus vs. two-base). More than three and
decision fatigue kicks in — the user has to read every thesis and compare,
which is the exact work templates were meant to eliminate.

If none of the three fit, the tray's "Show 3 more" is the pressure-release
valve. It regenerates rather than piling more choices on the initial view.

Templates at different durations should not be scale variations of the same
shape. A 4-week "Slow Switzerland" is qualitatively different from a 10-day
"Scenic Rail Loop" — different bases, different pacing, different themes —
not the same trip with longer nights.

## The generator's four-axis vocabulary

The two prototypes surfaced a small vocabulary the template generator
probably needs. When the model is asked to produce three templates for a
brief, it should first identify:

1. **What is the trip optimizing for?**
   - Switzerland: "named trains + regional variety"
   - Iceland: "aurora-viable dark-sky nights"
   - Japan cherry blossoms: "days in peak bloom across regions"
   - This becomes the number in the totals strip on every card.

2. **What's the binding constraint?**
   - Switzerland: none strict (most months work)
   - Iceland: season (Sep–Mar for aurora)
   - Galápagos: wildlife calendar
   - When one exists, it's a season banner above the gallery.

3. **What's the dominant transport mode, and what axis does it create?**
   - Switzerland: rail → "named-train focus vs. slow-travel" axis
   - Iceland: drive + flight → "how much driving vs. how settled" axis
   - Japan: Shinkansen → "how many cities vs. how deep in each"
   - This shapes the tray's regeneration buttons.

4. **Does probability-management matter?**
   - Aurora: yes — diversifying weather regions is a legit strategy (Template C)
   - Cherry blossoms: yes — bloom timing varies by latitude
   - Most trips: no
   - When it matters, at least one template should be a diversification play.

## Template card anatomy

Each card has, in order:

- **Mini-map** — SVG, simplified country outline with the route and anchor
  stops. Not map-accurate, just legible.
- **Badges** — trip name (top-left), duration (top-right), and for
  condition-driven trips, a success-metric badge at bottom-left (e.g.,
  "12 dark-sky nights").
- **Title + thesis** — title is the shape's name, thesis is one sentence
  that captures the philosophy ("Three home bases, day trips from each"
  or "Ring Road in a loop, every weather region").
- **Tags** — 3–5 colored chips for quick filtering and scanning.
- **Totals strip** — surfaces the optimization target, base changes,
  and any trip-specific success metric.
- **Week ribbon** — grouped by week, each week shows its 1–3 bases
  and nights per stop. At 2+ weeks, the planning unit is the week, not
  the day.
- **Expandable day-by-day** — grouped by week, matching the ribbon.

## Condition-driven trip adaptations

The Iceland prototype surfaced a small pattern for trips where a weather or
seasonal condition drives the logic:

- **Season banner** above the gallery with a "tune to month" dropdown
- **Dark-sky dots** in the week ribbon — green with a halo — mark
  nights in aurora-viable locations. Ordinary dots mark light-polluted
  nights. The ribbon becomes readable as a strategy at a glance.
- **Success metric** in the totals strip (e.g., "12 aurora-viable nights")
- **Diversification template** — at least one of the three templates
  uses probability-management as its thesis (Template C splits across
  two weather regions)

This generalizes to any weather- or timing-dependent trip: cherry blossoms,
whale watching, wildflowers, migrations, monsoon avoidance, hurricane season
risk, etc. The same UI primitives work; only the label changes.

## What the editor inherits

When the user picks a template and lands in the editor (the current "Places
to think about" UI plus the schedule view), the template pre-populates:

- Must-dos (from the template's route/activity/condition items)
- Candidates (the anchor stops and notable secondary stops)
- Keep/reject state (anchors default to keep)
- Sequence (the template's order)
- Dates (if the banner's season/month was picked)
- Entry/exit cities
- Transport modes per leg

The editor's job is to let the user add, drop, swap, or reorder — all the
machinery already exists. Templates shift it from primary surface to
refinement tool.

---

## Multi-destination trips (next step — not yet built)

Neal's eventual case: 5 weeks combining Switzerland (4w) and Iceland (2w).
This is genuinely harder than single-destination because:

### New axes

1. **Order matters for condition-driven legs.** Iceland aurora must be
   Sep–Mar. Switzerland works year-round. A 5-week trip in late Sept
   could go CH→IS (end on aurora high) or IS→CH (start with aurora,
   finish in Swiss October). In June, IS→CH doesn't work (no aurora);
   only CH→IS-in-late-Sep does. The template has to know this.

2. **Day budget split.** "5 weeks" doesn't divide evenly between two
   destinations. Templates should propose splits (3+2, 4+1, 2.5+2.5),
   each a distinct shape.

3. **Inter-destination transit is a first-class leg.** ZRH→KEF is a
   3-hour flight plus airport time — a real travel day that has to
   appear on the ribbon and eat a date slot. It's not a scenic travel
   leg; it's capital-T transit. Might warrant its own ribbon color.

### Template shapes for two-destination trips

Each "template" becomes a composition of two per-destination templates
(or fragments), plus an order and a split. The gallery could show:

- **CH (Grand Tour Plus) + IS (Full Ring Road)** — 4w + 2w = 6w. Too long
  if budget is 5w. Would need trimming.
- **CH (Slow Four Weeks) + IS (South Focus)** — 4w + 2w = 6w. Same issue.
- **CH (Grand Tour compressed to 3w) + IS (Two-Base Aurora)** — 3w + 2w = 5w.
  Compresses Switzerland by trimming less-iconic stops.
- **CH (4w) + IS (Two-Base compressed to 1w)** — 4w + 1w = 5w. Iceland
  becomes a highlights run.
- **IS (Two-Base 2w) → transit → CH (Slow 3w)** — reverse order,
  aurora first.

The primary user decision becomes: *how do you want to split the time?*
Shown visually as a slider or three preset splits.

### UI sketch (not yet built)

```
Step 1: "5 weeks, Switzerland + Iceland, aurora in Iceland, chocolate in Switzerland"

Step 2: Pick split
  [  3w CH + 2w IS  ] [  4w CH + 1w IS  ] [  2w CH + 3w IS  ]
    "CH focus"         "CH deep dive"      "IS focus"

Step 3: For that split, pick the CH shape and the IS shape from mini-galleries.
         Or: see 3 complete two-dest templates that have already picked both.

Step 4: Pick the order.
  [ CH first → IS aurora finale ]   [ IS aurora → CH Oct finale ]
    (Sep start, Oct-Nov aurora)       (late Sep start, aurora first,
                                       finish in Swiss late Oct)

Step 5: Land in the editor with both destinations pre-populated,
         a transit leg marker between them.
```

The cleaner version is probably "complete two-dest templates" — each card
is a fully composed trip, not a matrix the user assembles. Three of those,
each with a distinct thesis:

- "Chocolate + Chase" — 3w Switzerland slow + 2w Iceland two-base aurora,
  Sept start, aurora-timed finale.
- "Grand European Circuit" — 4w Switzerland Grand Tour + 1w Iceland south
  highlights, late summer/early fall.
- "Aurora-first" — 2w Iceland Ring Road Oct + 3w Switzerland Oct/Nov
  (autumn colors, fewer crowds, good hiking still).

### Open questions

- Should the generator produce multi-destination templates natively, or
  compose them from single-destination fragments?
- How do we represent the transit leg? As a day-eating entry in the
  ribbon, or as a banner between two per-destination sub-galleries?
- Does the editor need to know about multi-destination at all, or is each
  destination edited independently (with a separate sequence) and the
  whole thing is stitched at Build?
- When a user edits one destination's dates, should the other destination
  auto-shift? (Probably yes — they're adjacent in calendar time.)

### What changes in the data model

The current `trip` object has one `region`, one `entry`, one `tbExit`,
one set of must-dos. For multi-destination we probably need:

```
trip.legs = [
  {
    region: "Switzerland",
    entry: "Zurich",
    exit: "Zurich",
    dateFrom: "2026-09-14",
    dateTo: "2026-10-11",
    mdcItems: [...],  // Swiss must-dos
    destinations: [...],
    ...
  },
  {
    region: "Iceland",
    entry: "Keflavik",
    exit: "Keflavik",
    dateFrom: "2026-10-12",
    dateTo: "2026-10-25",
    mdcItems: [...],  // Iceland must-dos, including aurora
    destinations: [...],
    ...
  }
]
trip.transits = [
  { from: "Zurich", to: "Keflavik", date: "2026-10-12", mode: "fly" }
]
```

Single-destination trips become a degenerate case where `trip.legs` has
one entry. Nothing else about the existing editor / schedule UI has to
change — it just iterates over legs.

---

## Files in this iteration

- `index.html` — the main app (current Places-to-think-about flow)
- `gallery-prototype.html` — 4-week Switzerland gallery prototype
- `gallery-iceland.html` — 2-week Iceland aurora gallery prototype
- `design-notes.md` — this document

## To save this work

1. `git add .` (the two prototype HTMLs + this notes file)
2. `git commit -m "add gallery prototypes + multi-destination design notes"`
3. `git push`

Tag it so the design iteration is easy to find later:
`git tag -a gallery-v1 -m "gallery-first trip planning prototype, v1"`

## When picking this up again for the multi-destination build

Start from this document's "Multi-destination trips (next step)" section.
The four open questions at the end are the first decisions to make before
writing any code.

---

## Deferred items after the picker/Places merge (Round AX)

Carried forward at the end of the merge. Recommended order: 1, 6, 2, 5, 4, 3.

### 1. "Edit destinations" should re-open the picker (not the legacy candidate explorer)
**Status:** in progress (Round BK, Apr 2026).
Currently "Edit destinations →" on the trip view calls `reopenCandidateExplorer`,
which mounts the old "Places to think about" overlay — different layout from
the picker, breaks the design promise that the picker is the canonical
curation surface. Right behavior: re-open `renderActivityPicker` with state
rehydrated from `trip.mdcItems` + `trip.brief.entry/tbExit`, button reads
"Save changes →", on save apply diffs back rather than rebuilding from
scratch (or rebuild and accept the data loss for early-stage trips —
choose based on how much per-destination user data is at stake).

### 2. "Other places worth considering" — breadth discovery (Phase 2 of merge)
**Status:** deferred.
`runCandidateSearch` already generates `pCities` (major gateway cities) and
`pThematic` (thematic discovery picks). In place mode they're auto-rejected
so they don't inflate the trip. To surface them as opt-in: add a section
at the bottom of the picker — 6–10 places the brief implies but aren't
tied to a specific activity, each with a "+ Add" button. Catches cities
the activity-driven picks missed.

### 3. Multi-destination — reframed as the "journey" concept
**Status:** deferred. Solidify single-destination first.

The original framing — extending a single trip to span multiple regions —
turned out to be combinatorially expensive (every existing assumption
breaks: trip.region, picker scope, night-budget math, edit-mode cascades).
We discussed three patterns:
1. **Single-region** (Switzerland 4w) — existing model handles.
2. **Multi-city tour within a continent** (Paris/Amsterdam/Berlin/Vienna,
   3-4 days each) — should work in the existing model with a coherent
   region name like "Western Europe" and good prompt cooperation; needs
   testing to confirm. NOT a journey case — this is one trip.
3. **Two genuinely-distinct regions** (Switzerland 4w + Iceland 2w aurora) —
   each dense enough to warrant its own picker session, transit between
   is a significant flight. **Journey case.**

The cheaper architectural extension for case 3 is a **journey concept:**
a list of trips with optional transit legs between them, viewed as a
stitched calendar. Each trip uses existing tooling unchanged. The journey
is a thin layer of composition.

**When to revisit:** after single-destination version is fully solid
(remaining items 2, 5, 8). Then decide whether to test pattern 2 against
the existing prompt + build the journey concept for pattern 3.

### 4. "Plan" page day-count mismatch
**Status:** probably resolves with item 1.
User reported "Plan" page showed 38 days while "Trip page" showed 27 days
(a 5-week Switzerland trip). Likely the legacy candidate explorer still
computes from `trip.candidates` including route-only endpoints that the
build now filters out at place-mode fast path. Once edit-mode uses the
picker (item 1), the candidate explorer is no longer in the new-trip
flow and this discrepancy disappears.

### 5. Entry/exit field validation
**Status:** polish, not blocking.
Free-text inputs ("Zurich" / "ZRH" / "Zürich Airport" all behave
differently downstream). The old Places page had an entry-points map
that helped disambiguate; we removed it during the merge. Could add
typeahead from the existing airport list, or restore the entry-points
map in some form.

### 6. "+ more like this" per activity row — depth discovery
**Status:** deferred.
Each activity row in the picker shows a fixed set of `requiredPlaces`
(e.g., "Walk in the mountains" → Zermatt, Lauterbrunnen, St. Moritz,
Appenzell). A "+ more like this" button per row would fire a small
LLM call asking for additional places where the same activity is
iconic, append them to that activity's `requiredPlaces`. Lets the
user expand the option set for an activity they're invested in,
without re-prompting the whole picker. Cheap to ship; high value
for users who want to push deeper into a theme.

### Item 1 vs item 6 vs item 2 — what each is for
- **Item 1** (edit-mode picker) = workflow consistency. Every curation
  uses the same UI, whether new trip or editing built one.
- **Item 6** ("+ more like this") = depth discovery. "More places where
  THIS activity is great."
- **Item 2** ("other places worth considering") = breadth discovery.
  "Places I didn't think to ask for, anywhere in this trip."

### 7. Route endpoints sneaking into the trip as destinations
**Status:** open.
Vitznau, Alpnachstad, Arth-Goldau, Pilatus Kulm, Rigi Kulm and similar
train/cable-car access stations show up as standalone destinations with
overnight stays. They're in route activities AND in some non-route
activities (the LLM includes them in "Walk by the water" or similar),
so Round BH's filter (which checks `placesUsedByActivity`) doesn't drop
them. Probably needs a stronger prompt rule: "don't include train/
cable-car access stations as destinations unless the user would actually
stay there overnight." Or a hardcoded denylist of known transit-only
endpoints. Or both.

### 8. Picker night-count vs trip night-count mismatch by 1
**Status:** open.
Suspected cause: one destination's `c.nights` override in
`runCandidateSearch` fails to match its picker key (place-name
normalization mismatch, or the place is route-only and not in
`pickedNightsByPlace`), so it falls back to `parseNightsFromRange(c.stayRange)`
which defaults to ~3. Picker's per-place max-nights doesn't account for
that fallback. Diagnostic to write: dump picker's `keptPlaceSet`
side-by-side with trip's destination nights after build, find the
divergent place. Once we know which place(s) drift, the fix is either
better key normalization or making the override seed all kept places
(including route-only ones at 0 nights).
