# Discovery categorization — rearchitecture summary

**Status:** FIXED (Node gate green incl. new SSOT invariants; verified live on the
Live Iceland trip). One step left for you: run `./dev.sh check` for the full
Playwright browser gate.

This is the resolution of `DISCOVERY-CATEGORIZATION-BUG.md`. All six reported
symptoms are fixed, at the root.

## Root cause (it was NOT the LLM theming pass)

The spec's leading hypothesis was that the non-deterministic LLM theming pass
moved categories around on re-open. That was disproved: the entire instability
reproduces **signed out, with no API key, with theming never running**. The real
causes were three stacked source-of-truth forks plus one destructive render pass:

1. **The count read a volatile, render-mutated array.** The receipt banner and
   chips derived their model from `_tb.placeActivities`, which the render
   rewrites every paint. A leading-edge render throttle (PD.376) meant the
   model-apply sometimes ran and sometimes didn't, so the same trip read **17 or
   131** depending on timing — the "counts change on re-entry" flip.

2. **A destructive render pass deleted 114 places.** Inside
   `_reconcileUserListedKeeps`, the orphan-catchall rebuild found the "Sights
   near places you listed" section *by name* and **overwrote** its
   `requiredPlaces` — clobbering the synthetic-enhance section that legitimately
   shares that label (✦ Enhance additions + migrated sights). That is the
   "Sights near disappears" symptom and the 131→17 collapse.

3. **Two considered-sight pools that double-counted.** `MaxData.consideredPlaceKeys`
   read `placeActivities` AND "absorbed" the legacy `dest.suggestions._considered`
   pool at read time with `section:null` (the "(none): 55"). On the real trip,
   all 129 of those suggestions were already represented in `placeActivities`
   (95 as considered, 34 as stays) — so the old **186 was inflated by ~55
   phantom/double-counted pins**. The de-duplicated truth is **131**.

4. **"Places you added" was a generic bucket.** Manually-added places were pooled
   under one "Places you added" section instead of standing on their own.

## The fixes (small, surgical, gated)

| # | File | Change |
|---|------|--------|
| 2 | `discovery-adapter.js` | The considered count derives from the **persisted** `trip.placeActivities` (`_discoveryCountSource`), not the render-mutated `_tb`; `_discoveryOpts` reads stay-exclusions from the persisted trip too. Kills the 17↔131 flip. |
| 3 | `max-data.js` | New `foldConsideredSuggestionsIntoPlaceActivities()` unifies the two pools (idempotent, additive, coordinate-aware dedup via the canonicalizer); `consideredPlaceKeys` derives from the folded set and the read-time "legacy absorption" fork is deleted. |
| 5 | `index.html` | `_reconcileUserListedKeeps` orphan-catchall rebuild now **merges** (unions) into the "Sights near" section instead of **overwriting** it — the 114-place disappearance is gone, `_tb` no longer collapses, and that also secures "more like this" persistence. |
| 5 | `discovery-model.js` | "Places you added" places each become their **own named category** (the PD.405 pattern), for both checked and unchecked. The "Places you added" chip no longer exists. |

## Verification

**Live (Live Iceland trip):** banner == map == trip pill == section chips == one
number, **stable across every reopen** (was flipping). "Sights near places you
listed (114)" restored; "Places you added" gone (its place, Þingvellir, now its
own category). "More like this" added 75 places that were **counted, persisted to
localStorage, and survived reopens** — with nothing lost (132 → 207).

**Tests:** `tests/discovery-ssot-tests.js` — 8 invariants, now a hard gate in
`tests/run.sh`:

- I1 map count == picker count (pools unified)
- I2 no "(none)" sectionless sights
- I3 re-derivation is stable (no bistability)
- I4/I6/I7 "more like this" additions survive persist→rehydrate and re-enhance dedups
- I5 no listed sight ever disappears (the 401V guardrail)
- I8 "Places you added" never appears; each manual add is its own category

`tests/contract-checks.js` **Rule 30** locks the merge fix (asserts the
overwrite pattern never returns). Full Node suite: **0 fails**.

## Guardrails honored

- Reproduced deterministically before any change (instrument harness +
  `discovery-drift-data.json`).
- "A listed place must never disappear" — I5 asserts it; the 131 dedup loses
  nothing (every legacy entry remains as its proper considered/stay self); the
  75 enhance additions are additive.
- No speculative key/normalization changes.

## To finish

Run `./dev.sh check` for the Playwright browser suite (the one gate that doesn't
fit the sandbox). The relevant specs (build-harness, picker-flow) assert exactly
the consistency these fixes enforce and use synthetic trips with no
`dest.suggestions`, so they're expected to pass — but it's worth confirming.

Note: the Live Iceland trip now carries the 75 test additions from the "more like
this" run. Re-import `Live-Iceland.json` if you want the pristine set back.
