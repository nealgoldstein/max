# Place classification — one classifier, two roles, three surfaces

A one-pager to argue with. Spec for the model that decides whether a list entry becomes a destination, a sight under a destination, or neither.

## The diagnosis

Today's classification isn't a single decision — it's a chain of independent steps that can disagree:

1. **The parser** (`index.html:6852–7153`) reads each list line. Without an explicit section header or trailing tag, it defaults to *stay mode*. So "Harpa Concert Hall" with no header parses as `{isStay:true, nights:1}` — already on the destination track.
2. **The LLM enrichment** (`index.html:9773–9803`) returns `overnight` and `geographyKind` per place. It *should* downgrade Harpa to a sight.
3. **The demotion guard** (`engine-picker.js:186`) catches `role:"stay" && overnightCapable:false` and flips it back to `"see"`.

Three steps, three failure modes. If the LLM call drops a place, hallucinates `overnight:true`, or the user has pinned a role in the popover, Harpa stays a destination — and *also* lives in Reykjavík's `pois[]` because the activity generator put it there. Two surfaces, one place.

The deeper problem isn't the bug. It's that **there is no place in the code that holds the canonical answer to "what is this thing?"** Every consumer (picker, trip-builder, discovery map, See-and-Do) derives its own answer from defaults and inferred fields.

## The rule

**A Place is either a destination or a sight — never both, never neither.** Picked from your earlier #1.

The destination/sight distinction is structural, not visual. A destination is *a node in the trip's shape* — a stop with its own card, dates, weather, optional nights. A sight is *content that hangs off a node* — a thing to do while you're at the parent destination.

The two are exclusive: if a Place is in `trip.destinations[]`, it must not appear in any other destination's `pois[]`. If it's in `pois[]`, it must not appear in `destinations[]`. There is one toggle (Change role) that moves it between the two; the toggle is the *only* mutation that crosses the line.

## The classifier

One pass, before anything else touches the list. Input: a list line + the rest of the in-progress trip. Output: exactly one of —

- **`region`** — multi-city geographic area ("Westfjords," "Tuscany"). Becomes a destination *container* — may eventually be expanded into multiple sub-destinations.
- **`city`** — multi-night base ("Reykjavík," "Florence"). Becomes a destination.
- **`poi`** — a single place to visit ("Harpa," "Uffizi"). Becomes either a sight or a standalone destination — see *The Geysir problem* below.
- **`activity`** — a thing to do without a single fixed place ("Drive the Ring Road," "Walk on black sand beaches"). Becomes a role tag attached to one or more destinations. Not a Place.
- **`role-tag`** — a need without a place ("Place to stay overnight," "Anywhere with northern lights"). Becomes a wish-marker on a destination, drives the LLM's next suggestion pass.

The classifier runs *before* the picker is built. Its signal sources, in priority order:

1. **Explicit user tag** — "Harpa, see" overrides everything. If the user said it, the user is right.
2. **Geocoder feature type** — Mapbox/Nominatim returns `place`/`locality`/`city` for cities, `poi` for POIs, `region`/`administrative` for regions. Cheap, deterministic, ~95% accurate for unambiguous names.
3. **LLM tiebreaker** — only for items the geocoder returns ambiguously (e.g., "Tuscany" could be region or wine; "Geysir" could be the original or the generic noun). Single batched call per list, not per item.

The output is one field on the Place: `classification: region | city | poi | activity | role-tag`. It is set once, on import, and is the *only* input the destination/sight decision needs.

## The Geysir problem

Geysir is a POI. Under the simple rule "POI → sight under nearest in-list city," it becomes a sight under Reykjavík (90 min away, on the Golden Circle day-trip loop). Semantically fine. But:

- Geysir disappears from the discovery map, which only shows destinations.
- Geysir loses its own card — no weather, no dates, no notes specific to *being there*.
- The user's mental model of the trip ("Reykjavík → Geysir → Vík → Höfn") becomes "Reykjavík → Vík → Höfn" with Geysir buried in a tab.

This is the asymmetry you flagged. The fix has two parts.

### Part 1 — Promotion rule for standalone POIs

A POI becomes a **standalone destination** (its own card, default 0 nights) if *no viable parent exists or can be created*. The decision tree:

1. **Is there a viable in-list parent?** A city in the same trip whose drive-time to the POI is ≤ day-trip threshold (start with 90 min one-way) AND where the user is staying ≥ 1 night. If yes → sight under that city, done.
2. **Does the POI geocode to a city?** If yes, and that city is plausibly a destination on this trip (within the trip's geographic envelope), *auto-create the parent city as a destination* and bucket the POI as a sight under it. Mark the auto-created parent with `_autoCreatedFor: [poiId]` so the user can see why it was added. The user listed Harpa — that's an implicit vote for Reykjavík.
3. **Otherwise** → POI becomes a standalone destination with `nights:0`. Geysir, Gullfoss in a list with no Icelandic city. The discovery shape now anchors on the POI itself.

For Geysir + Reykjavík: step 1 succeeds. Geysir parents under Reykjavík as a sight. Discovery-map problem solved by `parentRelation`.

For Harpa with no Reykjavík in the list: step 1 fails (no parent), step 2 succeeds (Harpa geocodes to Reykjavík). Reykjavík is auto-added as a destination; Harpa lands in its `pois[]`.

For Geysir with no Icelandic city in the list: step 1 fails, step 2 fails (Geysir doesn't geocode to a city in any meaningful sense). Step 3: Geysir becomes a standalone destination, `nights:0`.

### Part 1b — The user-intent guarantee

A POI the user put on the list **must** be reachable from its parent destination's See-and-Do, no exceptions. The flow above already produces this — every classified POI ends up either (a) in a parent's `pois[]`, or (b) as a destination of its own — but it's worth stating as an explicit invariant because it's the property the *whole spec* exists to defend:

> Every user-listed item is addressable from exactly one trip surface. POIs land in their parent's See-and-Do. Standalone destinations get their own card. Activities/role-tags attach to one or more destinations. Nothing the user typed silently disappears.

The bucketing pass that consumes the classifier output asserts this. In dev, missing a user-listed POI from the expected surface crashes loudly. In production, it logs and falls back to a "Stray items" tray on the trip view so the user can re-place it manually rather than lose it.

This is the property the LLM-discovered sights *don't* get. If the LLM suggests Harpa and the bucketing drops it, that's a soft loss — there are other suggestions. If the *user* listed Harpa and it gets dropped, that's a broken promise.

### Part 2 — Sights live in one of two relationships to their parent

The two maps already have a natural division of labor:

- **The destination card's map** shows everything *inside* that destination — the in-city sights, walking-distance POIs, the destination's own footprint.
- **The discovery map** shows the trip's *shape* — the stops, the connections between them, and the headline things you'd plan a day around.

So a sight should appear on at most one map. The discriminator falls out of geography: is the sight *within* the parent's footprint, or *from* it?

- **`within`** — Hallgrímskirkja, Harpa, Sun Voyager. In the city. Shown on Reykjavík's destination card and on Reykjavík's own map. *Not* on the discovery map — it would just duplicate the parent pin.
- **`from`** — Geysir, Gullfoss, Þingvellir, Diamond Beach. Outside the city's footprint, reached as a day trip from it. Shown on Reykjavík's destination card (under day-trip options) *and* on the discovery map as its own pin, attributed to the parent.

One bit per sight captures this: `parentRelation: "within" | "from"`. Set at classification time by the LLM (heuristic: drive-time > ~20 min one-way, or "is this inside the city" check against the parent's bounding polygon). Editable by the user via the sight's role popover.

The discovery map shows: every destination + every sight with `parentRelation:"from"`. Geysir keeps its visibility. Hallgrímskirkja stays off — it's already on Reykjavík's own map, and that's the right place for it.

## Surfaces — explicit

After classification, four surfaces consume the data. Each has a single rule:

- **Trip shape (sidebar, calendar)** — destinations only.
- **Discovery map** — destinations + sights where `parentRelation:"from"`. In-city sights stay off the map itself, but each destination pin's *hover popup* surfaces a "things to do" section listing that destination's `within` sights. Same data as the discovery list view's things-to-do section, just delivered at the map level.
- **Destination card's map** — that destination's sights (both `within` and `from`, with `from` sights rendered as day-trip pins around the city's footprint).
- **Destination See-and-Do** — that destination's sights, both `within` and `from`, sorted by relation.

No surface needs to dedupe — the data model guarantees a Place lives in exactly one of `destinations[]` or some `pois[]`, and the `parentRelation` bit decides which map a sight shows up on. The dedup pass we discussed becomes unnecessary; the *parser* never lets the duplicate exist in the first place, and the *render rules* never double-place a sight across the two maps.

## Role changes — the only mutation

There is exactly one user action that crosses the destination/sight line: **Change role** on a destination card or a sight tile. It's a single atomic operation:

- *Sight → destination*: remove `placeId` from the parent's `pois[]`. Insert a new destination at the sensible sequence position (default: right after the parent, 0 nights). Move any per-sight notes/bookings to the new destination.
- *Destination → sight*: pick a parent (default: the previous destination in sequence, or prompt if ambiguous). Insert `placeId` into the parent's `pois[]`. Move per-destination notes to the sight. Set `parentRelation` from geography: `"within"` if inside parent's footprint, `"from"` otherwise.

Both directions reuse the same Place record. No data loss.

## What this removes

- The `_pastedRoles` override layer in the parser. The classifier produces the answer; there's no separate "user said" track to reconcile.
- The `overnightCapable` demotion guard. The classifier already settled the question.
- The activity-generator path that adds a destination's own placeId to its parent's `pois[]`. The classifier-then-bucket flow makes this structurally impossible.
- The implicit "stay is the default" parser fallback. Items with no header and no tag now flow into the classifier, which makes a real decision.

## What this adds

- One classifier call per list import (batched LLM, one round-trip).
- One field on every sight: `parentRelation: "within" | "from"`.
- One ref on every sight: the parent destination's id.
- One migration pass on existing trips — see below.

## Migration

Existing trips have the dual-surfacing bug baked in. The migration:

1. For each destination, check whether its placeId also appears in any *other* destination's `pois[]`. If yes, remove from the `pois[]` (the destination wins).
2. For each sight, run the classifier on it. If `classification:city`, prompt the user to confirm promotion. If `classification:poi`, leave it.
3. For each sight, set `parentRelation`. Default: `"within"` if the sight's coords fall inside the parent's bounding polygon (or within ~20 min drive of the parent's center), otherwise `"from"`.

Run once per trip on load, gate behind a `_classifierMigrationApplied` bit.

## Open questions

- **Regions.** A `region` classification creates a destination container that may later expand. Do we render it as a single card with sub-destinations inside, or do we resolve it to specific sub-destinations immediately on import? Probably immediate resolution via LLM (input: region + trip duration → output: 2–4 specific cities), but worth thinking about whether the *container* is itself useful as a UI concept.
- **Activities without a place.** "Drive the Ring Road" is currently a role chip. It works. But it's structurally homeless — not a Place, not a sight, not a destination. Is it a fourth kind of trip-level entity? Today it's stored on the trip's `roleTags[]` or similar; a clean model would name it (`Intent` or `Wish`) and give it its own lifecycle.
- **The day-trip threshold.** 90 min one-way (for parent-viability) and 20 min one-way (for `within` vs `from`) are guesses. Should they be user-configurable? Region-aware (90 min on Iceland's Ring Road feels different than 90 min in Tuscan hill-country traffic)?
- ~~**Headliner badges on the discovery map.**~~ Resolved: in-city sights surface in the destination pin's hover popup as a "things to do" section, mirroring the existing list view's things-to-do section. No separate pins, no badges — the popup IS the headliner surface. Geysir-style `from` sights still get their own pins.

## Implementation order

1. Build the classifier as a pure function (input: list lines + geocoder results + LLM batch → output: classified entries). Unit-testable. No UI changes yet.
2. Wire the classifier into the list-import path. Replace the parser's stay-by-default fallback with a classifier call.
3. Add the dedup invariant: in `publishTrip`, assert that no placeId is in both `destinations[]` and any `pois[]`. Crash loudly in dev if violated — this is the contract.
4. Migration pass.
5. Add `parentRelation` field + the two-map render rules (in-city sights to destination's map only, day-trip sights to both destination's map and discovery map).
6. Update Change-role to be the single atomic mutation.

Each step is independently shippable as a PD. The first three remove the bug class; the rest improve the model.
