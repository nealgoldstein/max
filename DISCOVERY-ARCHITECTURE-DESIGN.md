# Discovery subsystem — target architecture & migration design

**Purpose.** Replace the imperative pass-chain around Discovery with a clean,
extensible, object-oriented + service-oriented architecture, so that adding a new
way to *enhance* Discovery (a new suggestion source) or a new *category* is a
registration against a stable interface — not a new mutation pass bolted onto a
shared array.

**Foundation (decided): vanilla namespaced services.** No bundler. Each object /
service is a classic script exposing one namespaced API (the seam
`discovery-model.js` already uses), native ES `class` for OO, constructor
injection for collaborators, documented interface contracts. This keeps the
design clean today and is the on-ramp to TypeScript later with no rework.

---

## 1. Principles (the standards we're holding to)

- **Single Responsibility.** Each service does one thing (ingest, enhance, theme,
  place, persist, render). No "god function" that mutates everything.
- **Single Source of Truth + Single Writer.** The `DiscoveryModel` is the only
  representation of Discovery state and the only thing that mutates it. No second
  mutable array (`_tb.placeActivities` stops being a parallel truth).
- **Open/Closed.** New behavior is added by implementing an interface and
  registering it — existing code is not edited. (This is the "extensibility".)
- **Dependency Inversion.** Services depend on interfaces (a `SuggestionSource`,
  a `PlacementRule`, a `ThemingStrategy`), not on concrete LLM/DOM code. The
  concrete bits are injected, so they're swappable and testable.
- **Pure domain, effects at the edges.** The model and placement are pure and
  unit-testable; LLM/DOM/storage live in thin adapter services at the boundary.
- **Read-only projections.** The view derives from model queries and never
  mutates state. Counts come from one query, so surfaces cannot diverge.
- **Guardrails are invariants, not hopes.** "A listed place never disappears,"
  "counts agree," "idempotent re-derivation" are enforced by the SSOT test gate.

---

## 2. The layers

```
                        ┌─────────────────────────────────────────────┐
                        │                VIEW (projection)             │
                        │  PickerRenderer · HeroMapRenderer · Receipt  │
                        │  read model.sections()/considered(); no write│
                        └───────────────▲───────────────┬─────────────┘
                                        │ change events  │ user intent
                                        │                ▼
        ┌───────────────────────────────┴───────────────────────────────┐
        │                          APPLICATION / SERVICES                 │
        │  IngestionService   EnhancementService   ThemingService         │
        │  PersistenceService DiscoverySession (façade / coordinator)     │
        └───────────────▲───────────────────────────────▲────────────────┘
                        │ operate via the model's API     │ pluggable strategies
                        ▼                                 │
        ┌───────────────────────────────┐   ┌────────────┴────────────────┐
        │           DOMAIN              │   │        EXTENSION POINTS      │
        │  DiscoveryModel (SSOT+writer) │   │  SuggestionSource (registry) │
        │  Place (entity)               │   │  PlacementRule  (ordered)    │
        │  PlacementPolicy (strategy)   │   │  ThemingStrategy             │
        │  SectionKind (taxonomy)       │   │                              │
        └───────────────────────────────┘   └──────────────────────────────┘
```

### 2.1 Domain (mostly exists — `discovery-model.js`)

- **`Place`** — entity with stable, coordinate-aware identity and orthogonal
  attributes (`origin`, `role`, `decision`, `themeFit`, `nearListed`,
  `routeUmbrella`, `source`). *Exists.*
- **`DiscoveryModel`** — the aggregate root: a keyed ledger of `Place`s and the
  ONLY writer (`upsert`, `setDecision`, `setRole`, `setTheme`). Pure queries
  (`sections`, `considered`, `committed`, `consideredBySection`, `coverage`).
  *Exists* — gains: an **event emitter** (`on('change', …)`), `setTheme`, and a
  `snapshot()/restore()` for persistence.
- **`PlacementPolicy`** — today one pure function. Becomes an **ordered list of
  `PlacementRule`s** (strategy/chain-of-responsibility): the first rule whose
  `match(place)` is true returns the section. Adding a category = adding a rule.
  *Refactor of existing `sectionFor`.*
- **`SectionKind`** — section taxonomy/value object (names, predicates,
  precedence). *Exists.*

### 2.2 Application / services (new — replaces the pass-chain)

| Service | Responsibility | Replaces |
|---|---|---|
| `IngestionService` | Build the model once from trip data, unifying `placeActivities` + the legacy `dest.suggestions` pool (coordinate-aware dedup). | `fromPlaceActivities` + `foldConsideredSuggestions…` + `_mdcItemsDedupe` + `canonicalizePlaceActivities` |
| `EnhancementService` | Run registered `SuggestionSource`s, add results to the model via `upsert` (dedup is the model's job). | `enhanceDiscovery` (more-like-this) + `runPickerDayTripDiscovery` + `runPickerWaysideDiscovery` |
| `ThemingService` | Assign `themeFit` to places via a `ThemingStrategy` (LLM or rules or none), writing through `model.setTheme`. | `_runThemingPass` / `applyTheming` |
| `PersistenceService` | Serialize/deserialize the model to `trip.placeActivities`; one debounced save; subscribes to model `change`. | `_persistDiscoveryState`, the scattered `_initialTripSave`/`autoSave` calls |
| `DiscoverySession` | Thin façade the UI talks to: `open(trip)`, `toggle(placeKey)`, `enhance(sourceId)`, `close()`. Wires the services to one model instance, owns the event subscriptions. | `reopenPickerForEdit` + `_reconcileUserListedKeeps` orchestration |

### 2.3 View (projection — read-only)

- `PickerRenderer`, `HeroMapRenderer`, `ReceiptBanner` each subscribe to the
  model's `change` event and re-render from `model.sections()` / `considered()`.
- They **never** mutate state; user actions call `DiscoverySession` methods,
  which mutate the model, which emits `change`, which re-renders. (Classic
  unidirectional flow / observer pattern.)
- Replaces `_applyDiscoveryModelToSights` + `_renderPlaceActivityItems` writing
  back into `_tb.placeActivities`.

---

## 3. The extension points (your "extensibility / enhanceability")

### 3.1 `SuggestionSource` — add a new way to enhance

```js
// Interface (documented contract). A source FINDS candidate places; it never
// touches the model or the DOM — EnhancementService upserts what it returns.
interface SuggestionSource {
  id: string;                       // "more-like-this", "day-trips", "waysides", …
  label: string;                    // user-facing button text
  appliesTo(session): boolean;      // e.g. day-trips need >= 2 kept hubs
  fetch(modelSnapshot, ctx): Promise<PlaceSeed[]>;   // PlaceSeed = upsert payload
}
```

Adding "find Michelin restaurants near each stay," or a non-LLM source (a curated
DB, a partner API), is: implement `SuggestionSource`, `EnhancementService.register(source)`.
No existing file changes. `EnhancementService` handles the run, the dedup (via
`model.upsert`), the loading state, and the `change` emit — uniformly for every
source. **This is the enhanceability, done to the open/closed principle.**

### 3.2 `PlacementRule` — add a new category/section

```js
interface PlacementRule { match(place): boolean; section(place): string; }
```

`PlacementPolicy` evaluates rules in order. New section type = new rule, registered
once. (Today's special cases — route umbrellas, "Places you added" → own category,
catch-alls — each become an explicit, individually-testable rule instead of nested
`if`s in one function.)

### 3.3 `ThemingStrategy` — swap how categorization happens

```js
interface ThemingStrategy { theme(places, ctx): Promise<Map<placeKey,string>>; }
```

`LlmThemingStrategy` (current behavior), `RuleThemingStrategy` (deterministic,
offline), or `NoopThemingStrategy`. Injected into `ThemingService`, so signed-out
/ no-key gracefully degrades and tests run without the network.

---

## 3A. Two-phase discovery: generate first, then learn-and-enhance

Discovery is **two distinct rounds**, and keeping them distinct is a design
principle — not an accident of the build pipeline.

**Round 1 — Generate (`runCandidateSearch` / `expandMustDos` /
`generateActivitiesForPlace`).** Produces the *core* set straight from the
traveler's brief: the destinations and sights implied by what they listed and
described.

**Round 2 — Enhance (`enhanceDiscovery` / `_runEnhancePhase`, also the
"✦ More like this" button).** A **curation-aware** round. It reads which places
the traveler **kept** vs **rejected** and uses those as signals:

- *"More like what you kept"* — treats the kept set as a **taste signal** ("find
  more places shaped like THESE") and the rejected set as an **anti-signal**
  ("don't suggest things in that character"), and asks for ~`ceil(kept/4)`
  (8–20) additional places that fit the pattern.
- *Nearby enrichment* — for each **kept** place, suggests 1–2 nearby sights
  (within ~50 km) not already on the list.

**When each round runs (the rule).**

- **First create = Round 1 + Round 2, once.** When the trip is first built, Max
  runs both rounds so the traveler is handed a rich, taste-shaped set up front.
  This first enhance is *wanted* — it's the difference between a thin literal
  reading of the brief and a real starting board to curate from.
- **Return to Discovery = Round 1 result stands; NO automatic enhance.** Re-opening
  Discovery to edit (a *rebuild*) must **never** auto-enhance. An unconditional
  enhance on every Discovery→edit→return round-trip ratcheted the unchecked-sights
  count up each cycle (observed 50 → 187) — pure proliferation with no user intent
  behind it. Two separate triggers were removed to enforce this: the build skips
  enhance in `rebuild` mode (PD.345), and the picker no longer auto-fires a
  secondary discovery pass on return (the `_schedulePickerSecondaryDiscovery`
  auto-call was deleted).
- **More, on demand = "✦ More like this."** After the first build, *every*
  additional enhance round is user-initiated (`MaxBuild.rerunEnhance`). By then the
  traveler's keeps/rejects mean something, so the round is curated to their taste
  instead of bulk-expanding.

So: **enhance fires automatically exactly once — at first create — and never
again on its own.** The distinction is fresh-build vs rebuild, not on/off.

> **In the product's words:** *Max gathers a first set from your trip. After you
> pick what appeals to you, "More like this" lets Max learn from those choices and
> generate curated suggestions shaped by what you liked — and steer clear of what
> you didn't.*

### Discovery is an iterative refinement loop

The two rounds aren't a one-shot "generate then enhance." Round 2 is meant to be
run **repeatedly**, each pass sharpened by the curation you did on the last. The
core workflow is a loop:

```
        ┌─────────────────────────────────────────────────────┐
        │  1. Look at the current set                          │
        │  2. Keep what appeals · reject what misses           │
        │  3. "✦ More like this" → Max re-runs, learning from  │
        │     THIS pass's keeps and rejects                    │
        │  4. Repeat until the list is one you really like     │
        └─────────────────────────────────────────────────────┘
                 ▲                                   │
                 └──────────── converges ◀───────────┘
```

Each iteration tightens the taste signal: the kept set grows more coherent, the
rejected set teaches Max what to avoid, and the suggestions get sharper — the
traveler steers the model toward *their* trip a few decisions at a time, instead
of being handed one giant list to wade through.

**This holds even when Max generated the initial list itself.** Whether Round 1
came from places the traveler listed *or* from a sentence-mode brief where Max
proposed everything, the same loop applies: the traveler doesn't have to arrive
with a list. They can start from Max's first guess (first create already includes
one enhance pass), accept/reject against it, and re-run — convergence comes from
the *curation*, not from who seeded the set. (The "Max's first guess is on the
page… reject is the teaching move" banner is exactly this case.) The key
invariant: every enhance round *after* the first build must be **user-initiated**,
and it reads keep/reject state each time it runs — so returning to Discovery never
silently re-floods, but the traveler can re-run as often as they like.

This is the user-facing contract behind the `EnhancementService` /
`SuggestionSource` registry (§3.1): apart from the single first-build pass, every
enhancement source runs *on demand against a curated set*, re-runnable as many
times as the traveler wants — never as a repeated automatic flood on return.

---

## 4. How today's mess maps onto this

| Today | Becomes |
|---|---|
| `_tb.placeActivities` (2nd mutable truth) | **gone** — the model is the only state; `_tb` keeps only transient UI fields (scroll, draft brief) |
| `_reconcileUserListedKeeps` (200-line pass) | dissolved: identity/dedup → `IngestionService`+model; orphan/​umbrella/​stay rules → `PlacementRule`s; the destructive overwrite → deleted |
| `_applyDiscoveryModelToSights` (render rewrites array) | **gone** — renderer projects, never writes back |
| `_mdcItemsDedupe`, `canonicalizePlaceActivities` | folded into the model's `upsert` identity (one merge, at the write door) |
| `_runThemingPass` / `applyTheming` | `ThemingService` + `LlmThemingStrategy` |
| `enhanceDiscovery`, day-trip, wayside | three `SuggestionSource`s behind `EnhancementService` |
| `_persistDiscoveryState`, `_initialTripSave` | `PersistenceService`, one debounced subscriber to `change` |
| count read from `_tb` vs `trip` vs `dest.suggestions` | one `model.considered()` query; the PD.376 render throttle stops mattering because counts no longer depend on render timing |

---

## 5. Migration roadmap (strangler-fig, each phase gated)

The current surgical fixes already moved counts onto the model and unified the
pools — Phase 0 is effectively in place and green. We strangle the rest:

- **Phase 1 — Domain hardening.** Add `model.on/emit`, `setTheme`,
  `snapshot()/restore()`; refactor `PlacementPolicy` into registered
  `PlacementRule`s (behavior-preserving). Gate: `discovery-model-tests` +
  `discovery-ssot-tests` unchanged-green.
- **Phase 2 — `IngestionService`.** One ingestion owns identity/dedup/pool-union;
  `MaxData` count functions delegate to it. Delete `_mdcItemsDedupe`. Gate: SSOT
  I1/I2/I5 + canonical-placeset tests.
- **Phase 3 — `PersistenceService` + events.** Model emits `change`; persistence
  subscribes (one debounced save). Remove scattered save calls. Gate: I6/I7
  (additions persist) + a new "every mutation reaches storage" test.
- **Phase 4 — `EnhancementService` + `SuggestionSource`s.** Wrap more-like-this /
  day-trip / wayside as sources; route additions through `model.upsert`. Gate:
  live enhance→reopen survival + dedup.
- **Phase 5 — View projection.** `PickerRenderer` reads the model and subscribes
  to `change`; delete `_applyDiscoveryModelToSights` write-back. Retire
  `_reconcileUserListedKeeps` (its rules now live in `PlacementPolicy`/ingestion).
  Gate: full Playwright picker suite + the chip==banner==map DOM checks.
- **Phase 6 — Remove `_tb.placeActivities` as state.** It becomes a thin UI-draft
  object; the model is authoritative. Gate: full `./dev.sh check` + the 401V
  tripwire + an adversarial subagent review.

Each phase is independently shippable and reversible; the SSOT invariants + 401V
"never disappear" run the whole way as the safety net.

---

## 6. Risks & how the design contains them

- **Fragile subsystem / disappearing-pin history.** Every phase keeps the SSOT
  gate green and never lets the place-set shrink (I5/401V). The model's
  coordinate-aware identity is authored once at the write door (no per-reader
  re-derivation), which is what historically caused the flicker.
- **No compile-time interfaces (vanilla).** Mitigated by: documented contracts,
  a tiny runtime "implements" assertion when registering a source/rule, and the
  test gate. The clean separation also makes a later TS adoption mechanical.
- **Big-bang temptation.** Explicitly avoided — strangler-fig phases, old and new
  coexist until each surface is migrated and gated.

---

## 7. What success looks like

Adding "suggest sights near my hotels from a curated list" is ~30 lines: one
`SuggestionSource`, one `register` call, zero edits to the picker, the counts, or
the persistence — and it inherits dedup, persistence, the loading UI, and the
"never disappears" guarantee for free. That is the bar this architecture sets.
