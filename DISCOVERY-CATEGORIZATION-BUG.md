# Discovery categorization instability — bug report + investigation plan

**Status:** OPEN. Reported by Neal. NOT yet fixed. This is a data-model /
architecture issue in the Discovery picker — the app's most fragile subsystem
(disappearing-pin bugs have lived here; change carefully, gate with the full
Playwright + discovery-model suites).

---

## Symptoms (Neal's observations)

1. **Counts change on re-entry.** Re-opening Discovery changes the "N unchecked
   sights" banner count (e.g. 131) — it should be stable when nothing changed.
2. **Count disagrees with the map.** The banner/chip counts don't match the
   number of pins drawn on the map.
3. **Categories shrink.** The number of category chips drops on re-entry.
4. **"Sights near places you listed" disappears.** This (useful) catchall
   section vanishes — yet the banner text still references it.
5. **"Places you added (1)" is wrong and shouldn't exist.** Count is too low
   (there are more), and there shouldn't be a section by that name at all.
6. **"More places to consider (N)" count is wrong** too.

Observed chip set in one session: Overnight stays (12) · Recommended overnight
stays (47) · Hike to waterfalls (1) · Walk on ice (2) · Drive scenic routes (1)
· See natural wonders (3) · Explore cities and towns (3) · Places you added (1)
· More places to consider (7). Banner said **131 unchecked** (121 in
"Sights near…" + "More places…", 10 in theme sections) — but no "Sights near…"
chip was present.

---

## Initial diagnosis (HYPOTHESIS — confirm before fixing)

The categorization is **re-derived on every Discovery open** and is not stable:

- **Theming pass is LLM-driven and non-deterministic.** `applyTheming` /
  `buildThemingPrompt` (gen-prompt / gen-postprocess / construct-decorate.js)
  sort sights into themed buckets. An LLM sort returns different groupings on
  different runs → categories + counts move on re-entry. (Theming was turned ON
  by default in PD.486; PD.404/405 cover `_themeFit`.)
- **The catchall empties as theming runs.** As sights move into theme buckets,
  "Sights near places you listed" shrinks → disappears.
- **Counts have multiple sources that drift.** Banner "unchecked" count vs. chip
  counts (`consideredBySection`, discovery-model.js / max-data.js) vs. map pins
  — these read different representations and can disagree.
- **On-open re-runs.** Opening the picker also triggers `reopenPickerForEdit` →
  stay-fold (PD.299), `_schedulePickerSecondaryDiscovery` (auto day-trip/wayside
  discovery), and re-canonicalization — each can mutate the model.
- **"Places you added"** is likely a per-place fallback category (PD.405) firing
  incorrectly.

**Core architectural issue:** the DiscoveryModel is meant to be the single
source of truth (PD.400), but the view re-categorizes (partly via the LLM) on
each open instead of deriving once and holding stable. Map / chips / banner
should all read the ONE model; today they can drift.

---

## Files in scope
- `discovery-model.js` — DiscoveryModel SSOT, `consideredBySection`, canonicalize.
- `construct-decorate.js` — section names, `applyTheming`, `_themeFit`, catchalls.
- `discovery-curation.js` — `_schedulePickerSecondaryDiscovery`, persistence.
- `gen-prompt.js` / `gen-postprocess.js` — `buildThemingPrompt`, `applyTheming`.
- `max-data.js` — `getConsideredSights`, `consideredBySection`, `countConsidered`.
- `engine-picker.js` — the "N unchecked sights" banner count.

## Suggested investigation order
1. **Reproduce deterministically:** open Discovery N times on a fixed trip,
   record the chip set + each count + map pin count each time. Pin the drift.
2. **Find what re-runs on open** that changes the model (theming? auto-discovery?
   canonicalization?) — log a model signature before/after each.
3. **Confirm LLM involvement** in theming on re-open (and what happens signed-out
   / no API key — partial theming may be the disappearing-section cause).
4. **Audit count sources:** do banner, chips, and map all derive from the one
   DiscoveryModel? Where do they diverge?
5. **Decide the fix:** (a) derive categorization once + persist (no re-theme on
   open), or (b) make theming idempotent/cached, AND (c) unify all counts + the
   map onto the single model. Kill the spurious "Places you added" section.
6. **Gate:** full Playwright + `discovery-model-tests` + the build-harness
   theming tests must stay green.

## Guardrails (from BACKLOG)
- Reproduce in the harness before changing live behavior.
- Max NEVER checks/unchecks for the user; a listed place must never disappear
  (the 401V tripwire watches for large place-set drops).
- Speculative key/normalization changes have caused disappearing-pin bugs — don't.
