# NC.3 — Normalized place-role state model

Contract for the single source of truth on "what role does a place play in this trip." Replaces the fragmented field set that gave us the Seljalandsfoss bug (picker says "See", trip-view popup says "Stay") in Rounds NC.1 / NC.2.

## Geography model (the framing under the roles)

A **trip** takes place inside a **geography** — a political or cultural boundary like Iceland, the American Southwest, Paris. Inside that trip geography, a **sight** is a physical place (the Matterhorn, the Louvre, Gullfoss). A **destination** is a sub-geography inside the trip that has lodging — it is the only kind of place you spend a night.

Every sight belongs to exactly one geography. The user decides which by picking a role:

| Role | Geography assignment |
|---|---|
| `stay`    | This place IS a destination — its own geography on the trip |
| `daytrip` | Inside destination `_dayTripHub`'s geography — visited out-and-back |
| `onway`   | Inside the **trip's** geography — a wayside between two destinations |
| `see`     | Undecided which geography it belongs to yet |
| `maybe`   | Not yet decided whether to include it at all |
| `reject`  | User said no — geography is irrelevant |

The user's choice between "Day trip from Reykjavík" and "On the way" IS the user's act of defining the boundary of Reykjavík. Saying "Day trip" makes Reykjavík's geography big enough to include the sight; saying "On the way" leaves the sight in Iceland-the-trip-geography. We don't ask the user to draw polygons — the geography is emergent from role decisions.

Use `_geographyOf(place)` to ask the question directly: returns `{kind, hub?}` where `kind ∈ "destination" | "in-destination" | "trip" | "none"`.

## The three fields per candidate

| Field | Type | Set by | Mutates |
|---|---|---|---|
| `c.overnightCapable` | `bool` | LLM at generation time | Never (intrinsic to the place — does it have lodging + restaurant?) |
| `c.status` | `"keep" \| "reject" \| null` | User (Discovery View checkbox / reject) | User can flip freely |
| `c.role` | `"stay" \| "see" \| "daytrip" \| "onway"` | LLM default; user mutates | User mutates via Discovery cards (stay ↔ see) and Trip View popup (any → any except "stay" for non-capable) |

Everything else (`singleSight`, `intent`, `dest.intent`, `dest.dayTripHub`, `dest._roleConfirmed`, `dest.singleSight`, `dest.nights`) derives from these three or gets retired.

## Default `c.role` at generation

- `overnightCapable === true` → `role = "stay"`
- `overnightCapable === false` → `role = "see"`

## Allowed role transitions

| From | To | Surface | Allowed? |
|---|---|---|---|
| `stay` | `see` | Discovery card / Trip popup | Yes (only when `overnightCapable`) |
| `see` | `stay` | Discovery card / Trip popup | Yes **only if** `overnightCapable === true` |
| `stay` | `daytrip` / `onway` | Trip popup | Yes |
| `see` | `daytrip` / `onway` | Trip popup | Yes |
| `daytrip` / `onway` | `stay` | Trip popup | Yes only if `overnightCapable === true` |
| `daytrip` / `onway` | `see` | Trip popup | Yes |
| Anything | Anything (non-capable, role=`stay`) | Anywhere | **Forbidden** — UI must hide/disable the Stay option |

## Icon vocabulary (both maps, both surfaces)

| Visual | Means | When |
|---|---|---|
| Gray circle | Unchecked | `status === null` |
| Hidden (collapsed list) | Rejected | `status === "reject"` |
| Blue circle | Stay | `status === "keep"` && `role === "stay"` |
| Eye icon | See | `status === "keep"` && `role === "see"` |
| Purple circle | Day trip | `status === "keep"` && `role === "daytrip"` |
| Octagon | On the way | `status === "keep"` && `role === "onway"` |

Discovery View card UI: for `overnightCapable` places, show two buttons — Stay (selected if `role === "stay"`) and See (selected if `role === "see"`). For non-capable places, show only the See label (no Stay button). Day-trip and On-the-way are *not* available in Discovery — they require the trip's geography to make sense.

## Derivations (read paths)

Anywhere code reads one of these legacy fields, swap to the derivation:

| Legacy read | New source |
|---|---|
| `c.singleSight === true` | `!c.overnightCapable` |
| `c.intent` (LLM `"base"/"anchor"`) | Rename to `c.llmKind` for backward compatibility; or retire entirely (unused user-facing) |
| `dest.singleSight` | `!candForDest(dest).overnightCapable` |
| `dest.intent` (current user intent: stay/dayTrip/wayside/see) | `candForDest(dest).role` |
| `dest._roleConfirmed` | `!!candForDest(dest)._roleTouched` — see below |
| `dest.nights` | `c.role === "stay" ? c.nights || c.stayRangeMin : 0` |
| `dest.dayTripHub` | Computed at display time as nearest stay |

Add one bookkeeping flag: `c._roleTouched: bool` — true once the user has explicitly set a role (vs. defaulted from `overnightCapable`). Lets UI surface "you haven't decided yet" affordances without resurrecting a fourth role value.

## Write paths (mutation choke points)

All mutations go through one engine setter:

```js
MaxEnginePicker.setRole(candId, role)
```

Validates:
- `role` is one of `"stay" | "see" | "daytrip" | "onway"`
- If `role === "stay"`, the candidate's `overnightCapable` must be `true`. Else throws / no-ops.

Emits `candidateChange { id, role, prevRole }`.

The existing `convertDestToDayTrip`, `convertDestToWayside`, `convertDestToSee` helpers become thin wrappers around `setRole` plus their geographic side-effects (route shaping, hub linking). Nothing in inline code writes to `intent` / `singleSight` / `_roleConfirmed` directly — those are derived.

## Migration plan (multi-round, strangler-fig)

- **NC.3a** — add `c.role` + `c.overnightCapable` to the data model. Derive from existing fields for legacy trips. New engine setter `MaxEnginePicker.setRole`. Tests pin the contract. No UI change yet.
- **NC.3b** — Discovery View card UI: Stay/See buttons drive `setRole`. Picker map's `_makeCandidateIcon` reads `c.role` exclusively (drops legacy `singleSight` checks).
- **NC.3c** — Trip-view pin renderer reads `c.role`. Octagon SVG for `onway` (deferred from NC.2).
- **NC.3d** — `_openTripDestRolePopover` writes `setRole` as the primary action; `convertDest*` helpers become thin wrappers. Distance-from-previous shown in the popup.
- **NC.3e** — Retire the legacy fields entirely (`c.singleSight`, `c.intent`, `dest.intent`, `dest.singleSight`, `dest._roleConfirmed`). Remove the derivation shims. Test count drops where assertions were on legacy fields.

Each round green-tests before the next. NC.3a is safe because nothing reads the new field yet; NC.3b-d are visible but additive; NC.3e is the only one that removes existing fields and gets a careful review.

## Out of scope for NC.3

- Adding non-overnight candidates as separate map pins on the trip-view map (today they only appear as `dest`s of overnight stays). Future round.
- Mode-2 / Mode-3 entry flows (activity-first / place-first openers). Tracked in `STATE.md`.
- The drawTripMode → Places fold (Item E in `path-to-10.md`).
