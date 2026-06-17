# Max Object Architecture — the unified "Place" model

This is the canonical target model and the gap-analysis + migration plan to get
there. It is the architectural north star; PD/feature work should move *toward*
this, never away from it.

---

## 1. The target model

**At its core, everything is a Place.** A Place is a geographic area — as precise
as a lat/lng point or polygon, or as broad as a city, region, country, or park.

There are **three orthogonal axes** — though the third (Containment) is really
**two distinct relations**, so the implementation has **four** independent
concerns. They are independent: one Place can carry any combination.

### Axis 1 — Geography ("where is it?")
- `point` — a single lat/lng
- `polygon` — an explicit boundary
- `region` — a named area whose extent may be fuzzy/derived

### Axis 2 — Role ("why does it exist, in this trip?")
- `trip` — the root Place; the geographic scope of the journey
- `destination` — a place you **stay** (lodging; could spend the night)
- `sight` — a place you **visit** (viewpoint, museum, trail, restaurant, …)

### Axis 3 — Containment ("what is inside what?")
Containment is a general **Place-contains-Place** graph — and it is **two distinct
relations** that must not be merged (merging them recreates exactly the kind of
axis-conflation this model exists to kill):

- **`geo-within` — geographic nesting (objective, derivable).** Pure geography: one
  place's extent lies inside another's.
  - Switzerland ⊃ Zermatt ⊃ Gornergrat railway
  - Yellowstone (a *region*) ⊃ a lodge inside its boundary
  - Derivable from coordinates/polygons once Geography (Axis 1) is richer; it is a
    *fact*, not a choice.

- **`explored-from` — itinerary association (subjective, a decision).** "This sight
  is experienced while based at this destination (day-trip), or while traveling a
  leg (wayside), or belongs to the trip at large." The guide says this *depends on
  how travelers typically experience it* — so it is a **decision**, and lives with
  the decision log, not with facts.

These can disagree, and that's correct: a lodge is `geo-within` Yellowstone, but a
sight inside Yellowstone may be `explored-from` that lodge — so as ONE relation you
get a cycle; as two relations there is no contradiction. The general case holds:
a destination may contain sights, **and a sight may contain destinations** (a
national-park *sight*/*region* contains lodge *destinations*). The same park is
simultaneously a region (geography), a sight (role), a `geo-within` container, and
an `explored-from` anchor.

### Modeling discipline — keep Place lean
"Everything is a Place" must NOT become a god-object with 40 optional fields. The
type is a **small core** — `{ id, identity, geo, role }` — plus **composable
sub-structures** for role-specific and containment data (e.g. a `stay` block only
on destinations; `geoWithin`/`exploredFrom` edges as separate relations). One
honest small type beats six shapes; one dishonest mega-type is worse than six.

### Derived consequences
- **Trip is a Place** (role=`trip`). Its geographic boundary is **not** a fixed
  political border — it is **derived from the places it contains** (a "Switzerland"
  trip may include sights in France/Italy).
- A sight belongs to a destination *or* to the trip depending on **how travelers
  experience it** — i.e. containment is a modeling decision, not a hard fact.

---

## 2. Current state (code-grounded)

Max already has the *ideas* but in fragmented form. Today there is **no single
Place type** — "a place" exists as **six** representations bridged by identity,
not by a shared class:

| Representation | Where | Role it plays |
|---|---|---|
| `destination` | `tripstore` `trip.destinations[]` | lodging base: `{id, place, lat, lng, nights, country, suggestions[], dayTrips[], …}` |
| `requiredPlace` | `placeActivities[*].requiredPlaces[]` | a stay OR sight: `{place, _key, _kind, lat, lng, _keep, _rejected, _dayTripHub, _waysideFromHub, role, …}` |
| `candidate` | `trip.candidates[]` | discovery working set (by-ref twin of requiredPlace) |
| `PlaceSet.Place` | `place-set.mjs` | read-only accounting projection |
| `DiscoveryModel.Place` | `discovery-model.mjs` `_byKey` | the coordinate-aware **canonical ledger** during discovery (closest thing to a real Place registry) |
| `Decision` | `decision-model.mjs` | durable decision log `{kept, rejected, role, hub, leg}` |

Mapping to the three axes:

- **Geography:** lat/lng **points only** (`geography-model.mjs`). No polygons or
  regions. Trip/destination extent is *implicitly* derived from contained places
  (`_geographyOf`) but never represented as a first-class boundary.
- **Role:** the destination/sight distinction exists (`_kind`, `SectionKind`,
  `kind: destination|sight`), but **Trip is not a Place** (it's the top-level
  container object), and **`role` conflates axes**: `role ∈ {stay, see, daytrip,
  onway, maybe, reject}` mixes *role* (stay vs sight) with *containment* (daytrip =
  in a destination; onway = on the trip's legs) with *decision state*.
- **Containment:** **one-directional and implicit** — a destination "contains"
  sights only via `_dayTripHub`/`_waysideFromHub` **name strings** + section
  membership. There is **no general Place-contains-Place edge**, and a **sight
  cannot contain a destination** (sights are always leaves). The Yellowstone⊃lodge
  case is currently unrepresentable.
- **Identity:** strong and coordinate-aware (`PlaceKey.resolve/same/contains`,
  `DiscoveryModel.sameEntity` with a 5km coord veto). This is the part most ready
  to anchor a unified type.

What's already aligned (assets to build on):
- A canonical, identity-merged ledger (`DiscoveryModel._byKey`) — the seed of a
  unified Place registry.
- A FACTS / DECISIONS / VIEW separation (`decision-model`: `factsOf`, `keepOf`,
  `roleOf`) — the same projection pattern the unification needs.
- `Decision` already separates `role` from `hub`/`leg` — i.e. the containment data
  exists, just tangled into the legacy `role` string elsewhere.

---

## 3. Gaps (what makes Max inconsistent with the model)

| # | Gap | Today | Target |
|---|---|---|---|
| G1 | **No unified Place type** | 6 representations bridged by identity | one Place; destinations/sights/candidates are *projections by role* |
| G2 | **Trip is not a Place** | top-level container object | root Place, role=`trip`, geography derived |
| G3 | **Geography is point-only** | lat/lng points | point \| polygon \| region; extent derivable |
| G4 | **Containment is implicit, one-directional, and single-relation** | `_dayTripHub`/`_waysideFromHub` strings; sights are leaves; geo-nesting and itinerary-association are blurred | **two** relations: `geo-within` (objective) + `explored-from` (a decision); general graph; sight may contain destinations |
| G5 | **Role conflates four concerns into one string** | `role ∈ {stay,see,daytrip,onway,maybe,reject}` mixes role + geo-containment + itinerary-association + decision | role ∈ {trip,destination,sight}; hub/leg → `explored-from`; coords → `geo-within`; keep/reject → *decision* |

---

## 4. Migration plan (additive-shadow, leaf-first, CI-gated)

Same playbook that worked for the canonical decision model (#3): build the new
shape **alongside** the old, prove the projection equals the current behavior with
a live **shadow check**, then cut readers over and delete the old shape. Every
phase is gated by `tests/run.sh` + Playwright + a mutation-verified guard. Order is
by **value first**, since the full type-unification (G1) is the highest-cost,
lowest-user-visible-payoff item.

### Phase A — Formalize + orthogonalize the axes (G5)  *(low risk, high clarity)*
- Define the lean target `Place` shape in `types/max-model.d.ts` (spec only, no
  runtime): small core + composable blocks (see "Modeling discipline").
- Decompose the overloaded `role` into its four real concerns:
  `role ∈ {trip,destination,sight}`; `daytrip`/`onway` → the **`explored-from`**
  relation (hub/leg, already on `Decision`); coords → **`geo-within`** (Phase C);
  keep/reject → **decision** (already on `Decision`). Add a pure, reversible
  `axesOf(legacyRole, decision)` ⇄ `legacyRoleOf(axes)` in `decision-model`.
- **Shadow check** (`_placeAxesShadowCheck`, Node-tested + browser-runnable):
  for every place, `axesOf` then `legacyRoleOf` reconstructs today's `role` string
  exactly — proving the four-way split loses no information before any cutover.

### Phase B — Containment as first-class edges (G4)  *(high value)*
- Introduce **two** explicit relations, not one:
  - **`explored-from`** — derived initially from `_dayTripHub`/`_waysideFromHub`/
    section signals (shadow), then made the source of truth and the strings retired.
    This is the itinerary decision from Phase A, now an edge.
  - **`geo-within`** — derived from coordinates/regions (lands with Phase C).
- **Allow the general case**: a sight may contain destinations. This unlocks the
  national-park-with-lodges model — the first genuinely new product capability.
- Shadow check: every existing hub/wayside relationship round-trips through the new
  `explored-from` edges; `geo-within` never contradicts known nestings.

### Phase C — Geography: point | polygon | region (G3)  *(high value, fuzzy trips)*
- Add `geo: { type: 'point'|'polygon'|'region', … }` to the place shape; existing
  places stay `point`. Add polygon/region where data exists (parks, cities,
  countries).
- Formalize `geography-model`'s implicit extent-derivation: trip/destination
  boundary = derived hull/region of contained places. Enables the "fuzzy trip whose
  boundary comes from its places" concept and region-containment inference
  ("is this sight inside Yellowstone?").

### Phase D — Unify the type (G1)  *(highest cost, mostly internal)*
- Promote `DiscoveryModel._byKey` to **the** Place registry. Make
  `trip.destinations[]`, sight sections, and `candidates[]` **projections** of the
  registry by role (exactly as `keepOf`/`roleOf` already project decisions).
- Additive-shadow: registry shadows the existing arrays; shadow-check equality;
  cut readers over leaf-first; delete the duplicate arrays last.
- Honest note: this is the facade-rewiring-scale item — large, risky, near-zero
  user-visible payoff beyond collapsing the 6-representation bridging that has been
  a recurring bug source. Do it only after A–C prove out, and only if the
  maintenance win justifies it.

### Phase E — Trip as the root Place (G2)  *(small, once D lands)*
- Model the trip as the root Place (role=`trip`), containing all others; geography
  derived (Phase C). Largely falls out of D.

---

## 5. Sequencing recommendation

Do **A → B → C** first: they are lower-risk and deliver the actual new
capabilities the guide implies (orthogonal axes, sight⊃destination, fuzzy/region
geography). Treat **D (full type unification)** and **E** as a separate, optional
track — high effort, internal-only payoff — to undertake only if the bridging
complexity keeps causing bugs. Each phase ships behind a shadow check and a
mutation-verified guard, the same way the decision model (#3) and the ESM
migration (#2) were landed.

---

## 6. Phase D — the storage flip (design)

Checkpoint tag `place-d-readers-done` marks the safe rollback point (registry +
access layer proven, all clean readers routed). The flip proceeds from there.

**Key de-risking decision: keep the arrays as the PERSISTENCE format.** The
registry does NOT need its own serialization or a schema migration. On load it is
rebuilt from the trip's arrays (as it is today). "Authority" is therefore an
in-memory + write-discipline property, not a storage-format change — which removes
the single biggest risk (persistence/migration) from the flip entirely.

So the flip reduces to: **one write door + projections everywhere.**

1. **Prove the write-door invariant** (DONE): every `TripStore` destination write
   (setDestinations/addDestination/removeDestination) leaves
   `registryShadowCheck`/`destinationsProjectionCheck` green — gated in
   tripstore-tests. This is the contract the flip stands on.
2. **Funnel scattered writers through the door.** The mutators that currently
   splice/assign `trip.destinations` inline (trip-affordance, logistics,
   itinerary-ordering) call `TripStore` mutators instead. Each is browser-verified
   (Playwright); the invariant test above fails loudly if any path desyncs.
3. **Flip reads to projections** (mostly DONE for destinations) — readers use
   `MaxPlaces.destinationsOf`, never the raw array.
4. **Repeat for the HIGH-VALUE arrays — placeActivities & candidates.** This is
   where the drift bug class actually lives (PD.303 bridge, keep/role smear,
   candidates↔placeActivities). Same arc: projection + shadow → route readers →
   funnel writers. The payoff concentrates here, not in destinations.
5. **Collapse.** Once every read is a projection and every write goes through the
   door, the six representations are observably one; `_tb.candidates`/the mirror
   bridges and the ad-hoc reconciliation passes delete.

Net: no persistence change, no big-bang. Each step is additively shadowed,
invariant-gated, and reversible to the checkpoint tag.

---

## 7. Phase D — the `_keep` flag retirement (DECIDED, in progress)

The high-value arc (step 4 above) opened on `candidates`/`placeActivities` and
quickly found the real disease: the keep/role **decision** is stored on every
`requiredPlace` as `_keep`/`_isDayTrip` (read in ~49 places) and kept in sync
with the flat decision by the `MaxRoleWriter` **mirror**. Stored-and-mirrored
state is what drifts (the gray-pin bugs).

**Important history — this has been attempted before.** `app-main.js:_keepOf`
(P4.3) is already a keep PROJECTION from the decision log, and its own comment
states the endgame: *"the reconcile caches the identical value onto `p._keep`;
routing reads through here lets that cache be retired once every read derives."*
That retirement was never finished, so the cache + mirror persisted. The lesson:
**finish this one — do not add another accessor.** (During this arc a parallel
`MaxPlaces.keepFor` was built; it is retained ONLY as a proof harness, never to
be consumed by app code.)

**DECISION (evidence-backed): standardize on `_keepOf`.** On the real build
pipeline (16 requiredPlaces across stays/sights/day-trips + the Hverir overnight
edge), a three-way reconcile proved `stored _keep === keepFor === _keepOf`
(`[keep-3way] allAgree=16 disagree=none`). The source choice is therefore moot;
`_keepOf` is the existing intended accessor, so it wins.

Finishable checklist:

1. **Shadow gate** (DONE): `keepShadowCheck` proves stored `_keep` == projection
   on the real pipeline — a HARD gate in build-harness. Three-way reconcile vs
   `_keepOf` also green.
2. **Migrate the ~49 `_keep` READS onto `_keepOf`**, leaf-first, each a
   behavioral no-op (proven equal), gate-verified. EXCLUDE the shadow/detector
   reads in place-registry.mjs (they must read the stored flag to compare) and
   `_keepOf` itself. Use the guarded-global pattern (`typeof _keepOf === "function"
   ? _keepOf(p) : <exact original expression>`) so Node-imported modules keep
   their original behavior (suite proves identity) and the browser derives.
   - DONE (8 reads, log-fed paths): engine-picker:4674/4015, place-set:240,
     place-repo:248, max-data:231/353, discovery-model:591.
   - **BLOCKED on the write side:** the remaining reads are all downstream of
     DIRECT `p._keep =` writes that bypass the decision log (the checkbox toggles
     `pm-doclink-dest:309/334`, `app-main` checkbox writes ~4005/8775, and the
     reconcile flips). `_keepOf` is log-first, so those reads are read-after-
     direct-write — they can only migrate AFTER step 2.5.
2.5. **Route the direct `_keep` WRITES through `MaxRoleWriter.set`** (which writes
   the decision log + mirrors to the cache), so `_keepOf` is always authoritative.
   The single-place doclink toggle already does this (`pm-doclink-dest:209`); the
   multi-place toggles and app-main checkbox writes do not. Delicate (emit/render
   timing — watch for the double-emit class) and browser-verified.
3. **Retire the `_keep` cache.** CAVEAT to verify first: `_keepOf` falls back to
   `!!p._keep` only when the decision log isn't attached, and returns the ORIGIN
   DEFAULT when the log is merely sparse. Before deleting the stored flag, prove
   the decision log (P4.5 persisted) is COMPLETE for non-default decisions across
   publish→reload — otherwise retiring the cache would silently change keep for
   log-missing places. The p4_4-gate reload round-trips are the start of that proof.
4. **Delete the `MaxRoleWriter` mirror** (the `_keep`/`_isDayTrip` requiredPlace
   write block). Once nothing reads the cache, the mirror has nothing to keep in
   sync — divergence becomes impossible by construction, not detected.

Same arc for `_isDayTrip`/`_rejected` via `roleOf`/the decision once `_keep` lands.
