# Place-picker hero map: plan

The hero-map treatment moves to the **place-mode picker** (the
right-pane map labeled `tb-pm-map`, backed by `_pmMap` /
`_renderPlacePickerMap`) — the surface a user is on *before* Max
generates candidates. This is where the user is reacting to LLM-
suggested places ("must do" checked, "think about" unchecked) and
adding their own, while there's still time to shape the trip
geometrically before any candidates exist.

The companion candidate-explorer hero-map work (`picker-hero-map.md`,
steps 1–9) stays in place as the *next* step. The two surfaces are
complementary: place-picker shapes the brief, candidate-explorer
refines the LLM's response.

## What the place-picker map shows

Every distinct place across the activities — checked, unchecked, or
user-added — appears as a pin. The map already renders the pins
today; this work adds two new elements:

1. **A main route polyline** through every *stay* (a place that's not
   a day trip), in geographic order, with ordinal numbers (1, 2, 3 …)
   on the pins so the sequence is legible at a glance.
2. **Day-trip spurs** from each stay-hub out to its attached day-trip
   places, rendered with a distinct dashed line so they read as
   branches off the main route rather than route stops.

Pin colors carry the three-state model already in place: kept is the
darker filled pin, not-kept is the smaller muted pin, iconic gets the
gold border. The route polyline includes all of them (per the
"show me what it'd look like if everything were checked" intent), but
visually the kept pins dominate.

## Data model extension

Each `_tb.placeActivities[i].requiredPlaces[j]` entry gains:

- `_isDayTrip: bool` — true when the user toggled this place to
  day-trip status.
- `_dayTripHub: string` — the lowercased key of the stay this day
  trip attaches to.

Both default to `false` / `""` on fresh items and on rehydrate. Carry
through `reopenPlacePicker`-style code paths and the trip envelope
serialization.

## Interactions

**Clicking a pin** opens a small Leaflet popup with two toggles:

- **Stay the night** (default for kept places): the place is in the
  main route, gets an ordinal.
- **Day trip from …**: a dropdown lists the other kept *stays* in
  geographic-distance order, nearest first. The user picks a hub.
  Pin loses its ordinal, gets the spur line out from the chosen hub.

**The sidebar rows** already carry chips like "day trip from
Reykjavik" and "+ stay the night" — those buttons get wired to the
same `_isDayTrip` / `_dayTripHub` fields so toggling from either
side keeps the map in sync.

## Carry-through to the candidate-generation prompt

The user's day-trip designations are part of their brief. When the
brief gets submitted, the existing candidate-generation prompt (the
one in `runCandidateSearch` and its sibling discovery batches) gains
a brief paragraph naming any places the user pre-flagged as day
trips. Example: *"Note: Treat Grindavik as a day trip from Reykjavik,
not a stand-alone overnight stop."*

That keeps the candidate explorer's built itinerary aligned with the
user's pre-LLM decisions. Without this, the user would re-do the day-
trip toggling on the candidate explorer (which doesn't have that
affordance today).

## Build steps

1. **Add the data fields** — `_isDayTrip` and `_dayTripHub` defaults
   on every place-creating site (LLM-seeded, user-added). Preserve
   through rehydrate paths. No visible change yet.
2. **Compute route order** — a small helper
   `orderPlacePickerStays(allPlaces, coordLookup)` returning stays in
   geographic order. Mirrors `orderKeptCandidates` but simpler (no
   route-block adjacency, no condition bunching — those are
   candidate-explorer concerns).
3. **Numbered pins for stays** — extend the existing place-marker
   factory to render ordinals on stays (kept && !_isDayTrip). Day
   trips keep place-initials. Not-kept places stay as small empty
   dots.
4. **Main route polyline** — `L.polyline` through ordered stays.
   Desaturated green, weight 3, opacity 0.75 — same look as the
   candidate-explorer route.
5. **Day-trip spurs** — for each kept day trip with a `_dayTripHub`,
   draw a short dashed `L.polyline` from the hub's coord to the day
   trip's coord. Distinct color (amber? a muted orange) so it
   reads as a different kind of edge.
6. **Pin popup + toggle** — click handler opens a popup with the
   stay/day-trip radio, hub dropdown for the day-trip option, and a
   confirm button that updates `_isDayTrip` / `_dayTripHub` and
   re-renders.
7. **Sidebar ↔ map sync** — wire the existing "day trip from X" /
   "+ stay the night" chips on the sidebar to the same fields,
   triggering the same re-render.
8. **LLM prompt carry-through** — add a small `dayTripNote` to the
   candidate-generation prompts when any `_isDayTrip` flags are
   set on `_tb.placeActivities`.

## Risks

**Hub-detection edge case**. If the user marks the only-kept place as
a day trip, there's no hub left. The popup should either prevent
this (hub dropdown is empty → option disabled) or surface a "pick a
hub stay first" prompt.

**Sidebar wiring is shared with other code paths.** The "day trip
from X" chip is currently rendered by sidebar code that may not yet
have a clean toggle hook. Plan to verify before step 7.

**Geocode race**. Pins render via async Nominatim lookups. The
polyline + spurs must handle "pin not yet geocoded" — defer drawing
that segment until the coord lands, same way the candidate-explorer
polyline handles late-arriving geocodes.

## Out of scope

- Drag-reorder of stays on the place-picker (deferred — same
  pattern as the candidate-explorer's Step 4.5 deferral).
- Routing-mode picker per edge (Glacier Express, ferry, etc.) —
  still parked from the original conversation.
- Reordering / moving the picker's existing left-pane activity
  grouping. The sidebar layout stays as is.
