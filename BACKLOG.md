# Max — Normalized Backlog & Status

**Single source of truth.** Consolidates the 2026-06-06/06-10 architecture audits, the
NEXT-SESSION handoff, and the PD task history. Read this first.

Last updated: **2026-06-11** · `index.html` ≈ **38,432** lines · ~**50** JS modules extracted.

---

## Extensibility roadmap (the next architectural tier)
Three levers to lower change-risk further (change-risk = bug-risk). Ordered: each de-risks the next.

- **#1 — Types on the data shapes. ◑ CORE LAYER DONE; UI + monolith remain.** `tsconfig.json` (allowJs,
  checkJs OFF globally, opt-in per file via `// @ts-check`), `types/max-model.d.ts` (the written-down
  Trip/Brief/Destination/Route/Candidate/PlaceActivity/RequiredPlace/PlaceMeta/Facts/Decision shapes +
  the cross-module global surface), `tsc --noEmit` wired into `tests/run.sh` (skips if typescript not
  installed). **14 modules typed clean** — the whole data + engine layer: decision-model, migration,
  engine-publish, geography-model, discovery-model, max-data, place-repo, section-kind, place-key,
  engine-routing, engine-enrich, engine-build, tripstore, engine-trip. Surfaced + fixed real latent
  type bugs along the way (engine-trip's `_perpKm` shape union, two Date-minus-Date sites; engine-enrich's
  pluggable-hook arity). Established mechanics: declare a sibling's global on the surface; cast the IIFE
  bootstrap arg to any; don't ambient-declare a global a typed module OWNS. **Remaining (incremental,
  lower marginal value than the core):** the UI modules (trip-ui, features-*, construct-decorate,
  edit-constraints, map-pin-panel, home-screen, …), engine-picker.js (large), and index.html (the 39k
  monolith — biggest; best tackled after/with #2). As a shape gets fully enumerated, drop its
  `[k:string]:any` index signature to also catch unknown-field typos.
- **#2 — Module system / build step. ◑ Phase B bootstrap DONE; ESM cutover is the dedicated project.**
  60 ordered `<script>` tags + 200+ globals = the load-order-race class + no encapsulation/dead-code
  detection. **Phase B (the build+verify foundation) is in:** `build.js` concatenates the 55 local
  module `<script src>` files in index.html order into `dist/app.bundle.js` — concatenation (not
  esbuild `--bundle`) on purpose, so it's behavior-IDENTICAL to today's tags (same global scope, same
  order). `npm run build` builds + `node --check`s it; CI (gate.yml) now installs root deps, runs
  `tsc`, and builds the bundle on every push. Verified locally: 55 modules → a valid 2.9 MB bundle.
  **Phase B VERIFIED (the bundle serves correctly):** `build.js` now also emits `index.bundle.html`
  (index.html with the 55 contiguous local module tags collapsed to one bundle tag; vendor + inline
  untouched). Confirmed in a real browser (Chrome vs the dev server): it boots the full app from the
  single bundle with all core globals up (MaxEngineTrip/EnginePicker/TripStore/MaxDecisions/Migration/
  _normPlaceName) and ZERO console errors. Added `tests/playwright/bundle-smoke.spec.js` (skips if
  unbuilt, runs in CI after the build step) so this is gated on every push. So "the bundle works as a
  load path" is now proven, not assumed — the exact thing that was blocked.
  **Remaining (Phase C — the ESM cutover, now unblocked):** migrate modules to real `import/export`
  leaf-first (decision-model/migration first — typed + pure), esbuild replacing the concat as the
  graph forms, the bundle-smoke + full Playwright gating each step. Each leaf is a small CI-verified
  slice now that the harness exists.
- **#3 — Complete the canonical model (FACTS / DECISIONS / derived VIEW). ◻ Planned (large, incremental).**
  The decision-model/geography-model strangler-fig is partial; lots of state is still read directly
  from `trip`/`_tb`/`brief`. Finish so ALL state is one source, every view a pure projection, every
  mutation through the decision log + single doors — then a new view (e.g. the spreadsheet) is "write
  a projection" and a behavior change is "change one place." Same per-slice + Chrome-verify pattern as
  the publishTrip dedup; multi-session.

> Why #1 first/now: shape-drift was the root of most of what this whole effort fixed. #1 is the only
> one of the three that's incrementally adoptable with zero app-breaking risk, and it makes #2 and #3
> materially safer (the checker watches module-boundary + state-flow refactors). #2 and #3 are
> dedicated projects, not single-turn work — starting #2 half-way and committing would leave the app
> broken, which is the opposite of the goal.

---

## How to verify & ship

```bash
cd ~/Desktop/max
bash tests/run.sh                                  # Node suite + contract checks — must exit 0
cd tests/playwright && npx playwright test          # full browser suite — all green (55 pass, 3 skip)
```

Deploy: `bash deploy.sh --commit --message="..."` — runs the gate, stamps `?v=DEV`→epoch,
bumps the sw.js cache name, commits, pushes, ships to Cloudflare, then reverts to `?v=DEV`.
Hard-refresh (Cmd-Shift-R) after.

**Rule learned the hard way:** run the FULL Playwright suite before declaring a refactor
done — `build-harness` boots the app but doesn't click every button. A narrower gate missed
a module-load `ReferenceError` that the full suite caught (PD.483b).

---

## Done & trustworthy (recent)

**Data integrity (a real, booked trip can rely on it):**
- PD.475 — every raw trip write routes through the id==key asserting writer.
- PD.476 — `[0,0]` null-island coords scrubbed at ingestion (migration + place-repo).
- PD.477 — `publishTrip` checks its write result; warns loudly on failure.
- PD.478 — sync pull re-checks local before overwriting (no clobber of in-flight edits).

**Network reliability (survives Iceland's patchy signal):**
- PD.479 — transient OSRM cache stripped on save (a failed segment can't persist as a straight line).
- PD.480 — geo-queue races each task against a timeout (a hung Nominatim fetch can't latch the queue dead).
- PD.481 — `callMax` backs off on 429/529/503 instead of aborting Discovery/Enhance.

**Consistency / correctness:**
- PD.482 — dead `MaxMobile` removed; role-color drift guarded with a test (the two pin
  authorities intentionally differ by surface — the guard pins the one shared value).
- PD.484 (T4.1) — one canonical `_escHtml` (`util-esc.js`); 20 scattered escapers delegate to it.
- PD.485 (T2.7) — per-sight `s.research` folded into the one place-notes store.
- PD.486 (#80) — **theming pass ON by default** (sorts listed sights into themed sections);
  guarded by contract-check "Theming 1"; `"max-theming-pass"==="0"` is the escape hatch.

**UI design system / single source of truth (PD.491–494):**
- A `:root` token block is now the single definition for colors, type, and radius.
  ~2,370 `var()` refs app-wide (stylesheet + every inline `style=` + JS view files).
- Property-AND-context-aware migration: border tokens kept distinct from equal-valued
  bg/ink; only CSS contexts var()-ized (SVG `fill=`/canvas `fillStyle`/pin-color DATA
  left as hex — `var()` doesn't resolve there; `pinColorForRole` still returns `#1a5fa8`).
- Shared `.btn` system (two-tier black/blue preserved); button COLORS single-sourced.
- Every step value-preserving (zero visual change), gated by Node + full Playwright.
- See `UI-CONSISTENCY-AUDIT.md` → "SHIPPED — 2026-06-11" for the full record.
- Tooling: `./dev.sh serve|check|stop` + `dev.config` (single-source dev port).

**Architecture:** single role authority; base-to-base routes; DiscoveryModel SSOT + PlaceKey/
aliases + PlaceRepository; bloat reduction PD.449–483 (25 modules, 42.7k→38.4k lines).

**Full audit status:** Tier 1 (transient-error) — **all 8 done**. Tier 2 — T2.1/2.7 done, rest
below. Tier 3 — T3.4/3.7 done. Tier 4 — T4.1 done.

---

## Open work (prioritized)

### Correctness — investigated 2026-06-11 (PD.487)
- **T2.4 — DONE/deleted.** `_pmCoord` was alias-blind, but it had ZERO call sites — dead code
  carrying a latent bug. Removed it (the live coord resolution is the main pin loop).
- **T2.8 — NOT a bug.** `_grpIsStay` routes through the single authority (`_pmIsStayCandidate`
  → `_pmDeriveRole`); `nights>0` is a documented fallback for un-hydrated saved trips. Correct.
- **T2.10 — leave (diagnostic-only).** `getRejectedSights` reads per-dest `suggestions[]._rejected`
  vs considered/kept's collection, but it only feeds a debug stats snapshot — not user-facing.
  Reconciling means editing reject/curation logic (high-risk) for no user gain.
- **T2.5 / T2.9 — unverified-minor alias-blind reads** (`pinByKey` vs `_pinSeen`; `toggleDestKeep`'s
  raw `toLowerCase`). Same family as T2.3; fix only with a reproduction.

### Structural / perf — maintainability, no trip impact
- **T3.1 — double-render on every mutation. ✅ DONE (PD.433).** `_scheduleMainMapUpdate()`
  (`index.html` ~26681) coalesces repaints into one microtask; both the `tripChange`
  and `mapDataChange` subscribers route through it, so a mutation emitting both repaints
  `updateMainMap` ONCE, not twice. Also fixed the nights-flip case (the audit's risk note).
- **T3.2 — ~150 direct `drawTripMode`/`drawDestMode`/`updateMainMap` calls** bypass the central
  subscription. **Funnel introduced (step 1 done):** `requestTripRepaint()` (`index.html` ~26752)
  routes a repaint through the single `tripChange` handler (+ PD.433 map coalescing). REMAINING:
  migrate call sites to it incrementally (per-batch, behind CI — not a blind bulk sweep, since
  some callers pass opts / rely on synchronous render), then a contract-check banning new direct calls.
- **T3.3 — two migrators on one field. ✅ DONE (Option A — one migrator).** `tripstore._migrate`
  now keeps its structural backfill (id-from-key, default fields, drop `mdcItems`) and **delegates
  the shape migration to `MaxMigration.migrateTripShape`** (the complete, Node-tested v0→v4 one);
  `SCHEMA_VERSION` aligned to 4 so the two no longer stamp `_schemaVersion` with incompatible
  numbers. The two v0→v1 are complementary (structural vs shape), both idempotent. The harmful
  `_preMigrationBackup` rolloff (deleted the snapshot on a multi-version jump) was removed.
  **Verified in a real browser** (Claude-in-Chrome): a v1-stamped, v3-shaped real trip
  (Live-Iceland, 40 dests) migrates on load to v4, gains its missing arrival/departure routes
  (13→15), renders fully, zero console errors. Node 964 green (data-preservation version
  assertions updated). REMAINING (separate cleanup slice): now that every trip migrates to the
  `subKind` shape on load, the ~6 dual-shape route ORs (`r.subKind || r.kind…`) can be removed —
  do it once, behind the gate + a Chrome check, since a file-imported v2 trip still relies on them
  until its first migrated save.
- **T3.5 — placeMeta/tripMeta two-store. ✅ DONE (risk-audit M2).** Prefer-newer
  resolved WITHOUT per-entry timestamps via a hydrate-time baseline: hydrate now
  deep-copies (was a shallow `Object.assign` that shared each entry's value object,
  so in-place edits cross-mutated `trip.brief`) and snapshots `_tb._placeMetaBaseline`;
  persist routes through the pure `_pmMergePlaceMeta(tb, brief, base)` — edited-locally
  wins, untouched-local-but-changed-remote (sync pull) wins, brief-only key preserved,
  no-baseline degrades to the old local-wins (no regression). Both hydrate paths seed
  the baseline. Chrome-verified (8 cases) + Playwright guard.
- **T3.6 — god-functions** (`publishTrip` ~2434 lines, `_renderPlaceActivityItems`
  ~2500, `updateMainMap` ~1245, `_openTripStopPopover` ~812) with mixed
  responsibilities. Large extraction — do per-piece behind CI with the app driven,
  NOT a blind bulk refactor. **◑ Started — 2 slices done.**
  - *Slice 1 (1a03020):* extracted the PURE transit-leg ranking (~76 lines) out of
    `_openTripStopPopover` into top-level `_rankPopoverTransitLegs(trip, ctx,
    currentRouteId) → {html,count}` — no DOM, no side effects; Playwright unit test
    + Chrome-verified live.
  - *Slice 2 (6eb72f4):* extracted the by-Place single-row builder (~107 lines) from
    `_renderPlaceActivityItems` into top-level `_pmBuildPlaceRow(key, pInfo, deps)
    → rowNode`; `deps` carries the only two render-locals (childrenByHub map +
    whyFitsLineFor). This is the seam a future SINGLE-ROW re-render needs (repaint
    one row on a keep-toggle, not wipe+rebuild the whole list). Playwright guard +
    Chrome-verified live (builds a well-formed node, no throw). The single-row
    re-render itself (wiring a `_pmRerenderPlaceRow(key)` into togglePlaceByPlaceMode)
    is the natural slice-3 follow-up — the perf payoff the audit named.
  **ROI note:** slice 1 was the one cleanly-PURE block; the rest (`updateMainMap`,
  the popover's role-apply handlers) is side-effectful render/DOM code — smaller,
  lower-value, each needs a Chrome render check. Proceed per-slice behind the gate.
- **T3.8 — `mdcItems` zombie field. ✅ DONE (PD.488).** Publish no longer emits it
  (`engine-picker.js` ~2318); no `trip.mdcItems =` write remains. The `tripstore` delete-on-save
  and the `max-data` legacy fallback are KEPT intentionally — they migrate pre-PD.488 saved
  trips that still carry the field.
- **T3.4 — raw trip writes bypass id==key. ✅ DONE (PD.475 + writeRaw routing).** Verified: all
  trip-ENVELOPE writers route through `MaxDB.trip.writeRaw` (the id==key assert) — sync.js (834/1045),
  tripstore._persist, the index.html save helper — with only id==key-safe defensive raw fallbacks.
  The 3 remaining raw `setItem` are for the `max-trips-index` LIST (not envelopes; the assert doesn't
  apply); unifying those into one index-writer is optional low-value tidy.
- **T4.3 — `_isStaySection` vs `SectionKind.isStay`. ✅ DONE.** `_isStaySection` (index.html ~5930)
  already delegates to `SectionKind.isStay`; the inline fallback is load-order defense, not a duplicate.
- **T4.2 — `86400000`/`msDay` redefined ~12×. ◯ Deferred (cosmetic).** A magic-number→named-constant
  rename spanning ~10 independent script scopes + the server; readability-only, lowest leverage.

> **Audit drift note (2026-06):** the 2026-06-10 audit's Tier-3/4 list is stale — T3.1, T3.4, T3.8,
> T4.3 were all completed afterward (PD.433/PD.475/PD.488 + delegation) and just weren't crossed off.

### Latent-bug architectural risk audit — 2026-06 (✅ ALL FIXED)
A two-pass read-only audit (data-integrity + render/consistency) found 15 latent-bug risks; all
fixed in 4 verified waves (Node gate + Chrome + Playwright guards):
- **H1/L1** raw `toLowerCase` keying in `toggleDestKeep`/`_adjustDestNights` → now canonical
  `_normPlaceName` (disappearing-place class; the role-write + DOM update could disagree on a
  diacritic/alias place). **H2** same for the gateway matcher `_matchDestByName` (duplicate pin).
- **R1** `updateMainMap` colored pins from a stale `_pmKindByKey` → now refreshes it first (PD.432
  parity). **M1** the last 4 `subKind||kind` dual-shape route readers → `routeSubKind`.
- **M2/T3.5** placeMeta prefer-newer (above). **M3** candidate-projection fallback drift.
  **L2** `_routingCache` `_failed` sentinels latching past a transient outage (PD.479 class).
- **R2** `_wispEvalInProgress` stuck-flag lockout → try/finally. **R3/R4** async geocode clobbers
  after trip-switch → captured-trip-id guards. **R5** surgical-toggle flag scoped to the sync emit.
  **R6** map funnel + **R7** rev-write swallowed errors → now warn. **H3** false migration comment.
- Commits: `153dc4d` (wave 1), `af896de` (wave 2), `60ffd16` (R1), `766102c` (wave 3), `058a2f2` (wave 4).

> Genuinely-open architectural work left: T3.2 call-site migration (funnel + ratchet done; sites are
> incremental, ratchet-protected), T3.6 god-function extraction (in progress, below), T4.2 (cosmetic).

### God-function decomposition (T3.6) — change-risk = bug-risk program (2026-06)
Reframed: maintainability/extensibility and bugs are the same thing seen from two sides — a bug is a
change colliding with hidden coupling or a duplicate. So decomposition is bug-prevention, equal
priority to fixing armed bugs. Attack order: (1) god-functions, (2) bypass call-site → single funnel
(T3.2) + ban regrowth, (3) collapse remaining parallel state, (4) ratchets that fail the build when
coupling creeps back.

**publishTrip dedup — done so far (each: a drift-risk inline copy of an already-extracted+tested
engine-publish.js / MaxPublish helper, now delegated):**
- slice 1 (e624723): entry/exit validation → `MaxPublish.validateEntryExit`.
- slices 2+3 (7977ae1): rebuild detect → `detectRebuild`; PD.16 stayOverride bridge decision →
  `deriveStayOverrideBridges` (application kept local).
- Earlier T3.6 (1a03020 / 6eb72f4): `_rankPopoverTransitLegs`, `_pmBuildPlaceRow`.

**Unwired tested helpers — RESOLVED for 3 of 4 (slice 4, 7133cec):** an equivalence audit
(data-integrity subagent) compared each helper to publishTrip's inline copy:
- ✅ `rehydrateClassifierBuckets`, `dedupCandidatesByPlace`, `filterCandidatesForDestinations` were
  EQUIVALENT — publishTrip now delegates to them, so the unit tests finally guard the LIVE path and
  ~60 lines of duplicate logic left publishTrip. (filter is fed the AUGMENTED `_pd234SightSet`, not
  raw `_tb._sightsClassified` — guarding the PD.430 destination-inflation bug.)
- ✅ **`synthesizeMissingCandidates` — RESOLVED (slice 5, 6260782).** Was DIVERGED (dead helper
  emitted `role:"stay"` + lacked the `(0,0)→null` guard). Rewrote the helper to emit the EXACT live
  shape (`role:"see"`, the v359.60.18 coord guard, reconciled tags/_required, whyItFits from the
  activity), rewrote its unit tests to the live shape + added a `(0,0)`-guard test, and wired
  publishTrip to delegate the decision (application — push into kept/_tb.candidates + log — kept
  local). Inline copy deleted. One implementation; the tests now guard the live publish path.
  Chrome-verified live (role:"see", (0,0)→null, real coords kept). **All 4 unwired helpers resolved.**

**Funnel migration (item 2) status:** the BASELINE=154 ratchet (contract-checks.js) already PREVENTS
new direct drawTripMode/drawDestMode/updateMainMap calls — the bypass class can't grow. Migrating the
~41 EXISTING direct calls is delicate: each one examined is coupled to synchronous context (init
sequence at 25958, `render()` then updateMainMap at 27617, navigation repaint at 29834, exec-mode
day-selector at 26420/26431). Switching to the async coalesced funnel is a timing change that needs
each UI path EXERCISED to verify — do per-site with the path driven, then drop BASELINE by the count
migrated. Not a blind sweep.

**God-function decomposition — clean pure seams DONE; remainder is diminishing-returns.**
Extracted as top-level, individually unit-tested + Chrome-verified pure helpers this program:
`_rankPopoverTransitLegs`, `_pmBuildPlaceRow`, `_pmOrderSectionsByCategory`, `_searchNormalize`,
`_pmSectionSlug`, `_pmWhyFitsLine`, `_mapResolveDestCoords` — plus the whole publishTrip
helper-delegation (entry/exit, rebuild, stayOverride, dedup/filter/synthesize/rehydrate).
**Stopping point is deliberate, not fatigue:** what remains is NOT tangled inline code — it's either
(a) ALREADY well-factored named nested helpers where top-level-izing is a modest testability gain for
a large verbatim-move risk (`_collectWhatsHere` ~150 lines, the day-trip option builders, the gateway
badge prep), or (b) the irreducible side-effectful core (Leaflet drawing, DOM/drag wiring, the render
orchestration + throttle) that should NOT be extracted (low ROI, high risk). The high-value work —
turning buried spaghetti into named, testable, reusable units — is complete. Do the remaining
top-level-izations opportunistically/fresh if a given helper needs reuse or a unit test; not worth a
marathon-tail batch.

**Funnel migration (item 2) — BASELINE 154→152→138.** Batch 1 (aa9f674) migrated 14 confidently-safe
control-toggle / repaint-after-mutation handlers to `_scheduleMainMapUpdate()` / `requestTripRepaint()`.
Batch 2 (~25 `global.drawTripMode()` inline handlers in trip-ui.js / features-conversation.js /
edit-constraints.js / features-trip.js) is "likely safe" but each needs its trip-view path EXERCISED
before migrating — not a blind sweep. `drawDestMode(id)` sites stay (no dest funnel). Floor is ~8–9
occurrences that can never be removed (the 2 function definitions, the 3 funnel-internal calls, the
menubar onclick string, 2 comments) — don't drop BASELINE below that.

### Parallel-state collapse (item 3) — audit 2026-06
A focused audit for remaining "same fact in two places / two writers / derived-and-stored" drift.
- ✅ **F1 (HIGH, 882edd9):** the Ask-Max key modal was a THIRD api-key writer (loose `^sk-ant-` check
  + raw setItem) — now routes through the single PD.445 gate `_isWellFormedApiKey` + door `saveApiKey`.
- ✅ **F2 (HIGH, 882edd9):** dead divergent `MaxPublish.deriveTripName/isAutoName` twin removed; the
  LIVE `MaxEnginePicker` versions are now the only impl + are tested.
- ✅ **F3 (MED) — duration drift FIXED (fceecc3).** Correction to the original framing: `brief.duration`
  is the user's BUDGET/INTENT (a range like "7-10 days"), NOT derived from nights — the budget gate
  measures planned nights against it (confirmed via parseTripDuration + the readers). So the fix was
  "one setter, sync the mirrors," not "derive." Added `setTripBudgetDuration(durStr)` (writes
  `trip.brief.duration` + `_tb.duration` atomically) and rerouted the drifting writers
  (`_extendBudgetToFit`, edit-constraints Apply Parameters, the over-budget modal). Chrome-verified
  both stores stay in sync. REMAINING (lower priority, separate slice): `startDate/endDate` have the
  same `_tb`/brief mirror pattern but don't affect a budget verdict — a `setTripDates` door would
  finish it. (trip-affordance.js:281 overwriting the budget with derived length on a date edit is a
  PRODUCT question, left as-is.)
- ◻ **F4 — NOT a dedup (product decision).** The budget banner (index.html:23300) uses
  `displayNights` (actual PLANNED nights) while `computeStayTotalSummary` sums each candidate's
  SUGGESTED `stayRange` — different quantities. Unifying changes what the banner means; leave to
  product, don't mechanically merge.
- ◑ **F5 — `_userListedNames`/`_userListedDisplay` dual-store: RATCHETED, full retirement deferred.**
  Finding (analysis): the parallel state is ~80% already collapsed — `_tb._userListedNames` is a LIVE
  PROJECTION of the records (`_refreshUserListedFromRecords` re-derives from `_origin:"user"` on every
  build/hydrate, so it can't drift), and there is NO live writer to `trip.brief._userListedNames` (it's
  a frozen legacy artifact + a hydration seed for pre-PD.429 trips). DONE: a contract-check ratchet
  (BASELINE=37) freezes brief-mirror references so dependence can only shrink; new code must read
  records `_origin` / the `_tb` projection / `MaxData.deriveListedFromRecords`. DEFERRED (needs a
  migration window — the only steps that can drop a listed place): migrating the direct brief-mirror
  readers (esp. `map-pin-panel.js` iconic seed — hydration-ordering risk) and DELETING the persisted
  mirror. A notes-less, never-`_origin`-baked legacy trip could otherwise lose provenance → 401V. Do
  per-reader, behind the gate + Chrome on a real legacy trip; never delete the seed until records-or-
  notes coverage is proven for the loaded trip.
- ✅ **F6/F7 (LOW) — DONE (c0102fb).** `max-road-routing` toggle → single `_setRoadRouting(on)` door;
  the duplicate/share-import trips-index raw writers → single `_appendTripIndexEntry(entry)` door
  (kept the read-PERSISTED-index-fresh-and-merge behavior on purpose — using in-memory `_tripsIndex`
  in those flows could be stale and drop other trips).

### UI design system — remaining (needs eyes on each view; not blocking)
- **Button MARKUP → `.btn` classes beyond home.** ~159 inline-styled buttons across
  trip/picker/Discovery. NOT a blind sweep: buttons are heterogeneous and
  `var(--c-primary)` is also used by non-buttons (badges, dots). Migrate per-view with
  the app navigated so each screen is visually reviewed.
- **Aesthetic consolidation.** Reduce 17 font sizes → ~6 and 14 radii → 3 by snapping
  to the scale. Real visual change (reflow / corners) — review per view. Tokens are
  already in place, so it's a per-token value edit once approved.

### Bloat phase 3 (ongoing, risky)
The remaining monolith sections have interleaved boot code (event listeners, load-time IIFEs,
template-embedded `<script>` tags). The pure-declaration extraction method is exhausted; these
need per-section boot-preservation. Higher risk, diminishing returns. **Recommend pausing**
unless there's a concrete reason.

### Assessed — intentionally leaving (don't "fix" without a reason)
- **#19 — Discovery picker pins** are deliberately richer than the map factory (selected ring,
  grayed variant, place-initials, gray-`?` see pin). Routing through `MaxMapPin.draw` would
  regress them or bloat the factory.
- **#20 / T2.6 — "View larger" popout pins** live in a *separate browser window* with serialized
  HTML; can't share the factory without first extracting `MaxMapPin` to a module + loading it
  there. Bigger cross-window change.
- **T2.2 — two distance formulas** (equirectangular `*111` for local fast-paths vs haversine):
  intentional perf/precision split; thresholds (wayside >4km, day-trip >8km) are tuned to it.
- **T2.3 — `MaxPlaceKey.normalize` alias-blind:** no reproduction; speculative key-logic changes
  caused past disappearing-pin bugs.

---

## Conventions
- Root-cause, don't patch; reproduce in the harness before changing live behavior.
- NEVER reassign the routed `_tb.placeActivities` mid-build (it loops via `tripChange`). Writes
  go through `TripStore.setPlaceActivities` (the one door, with the PD.356a no-op guard).
- Max NEVER checks/unchecks anything; the user's pasted list is a contract — a listed place must
  never disappear (401V tripwire watches for a large place-set drop).
- Every new extracted module goes in the `tests/contract-checks.js` haystack; `globalThis.X = X`
  exposures must be `typeof`-guarded (a cross-script exposure runs before its function's script
  loads — PD.483b).
- Sensitive: the Turso auth token was shared in an earlier session — treat as secret, never print it.
