# NEXT SESSION — handoff

Read this first, then `ARCHITECTURE-AUDIT-2026-06-06.md` for the deep history.

## How to verify everything still works
```bash
cd ~/Desktop/max
bash tests/run.sh          # Node suite + contract checks — must exit 0 (now ~821 checks)
cd tests/playwright && npx playwright test   # browser tests — all green
```
Deploy with: `bash deploy.sh --commit --message="..."` (runs the gate, bumps cache-buster, commits, pushes, ships to Cloudflare). Hard-refresh (Cmd-Shift-R) after.

NOTE on the deploy gate: per-test timeout is now 60s + 1 retry (playwright.config.js), and the build-harness internal waits are 55s. This was needed because the full suite flakes on a loaded machine (a 30s wait tripped even though every test passes in isolation). If a deploy still flakes, free CPU / kill stale `http.server 8765` and re-run.

## State — done and trustworthy
The "one identity / one source of truth" re-architecture is complete and locked (DiscoveryModel SSOT + single writer + pure PlacementPolicy; PlaceKey + aliases; PlaceRepository; canonical-at-write via TripStore.setPlaceActivities).

Recent, shipped, tested:
- **401T–401W** — coverage/pins/empty-retry/publish-survives/sync-invariants (see git log).
- **PD.402** — extracted the activity-generation PROMPT assembly out of `_generateActivitiesForPlaceImpl` into `gen-prompt.js` (`MaxGenPrompt.build`, `detectCompleteness`). Proven byte-identical to the old inline prompt (snapshot test).
- **PD.403** — extracted the pure post-LLM transforms into `gen-postprocess.js` (`normalizePlaceArr`, `computeTransitOnly`, `mergeDuplicateSections`, `decorateConstructedWithCoords`, `coerceThemingMap`, `applyTheming`). Behavior-proven vs a pre-refactor snapshot. Together PD.402/403 pulled ~260 lines out of the index.html monolith into pure, Node-tested modules.

## Open work (in priority order)

### 1. Monolith breakup (the real remaining mass)
`index.html` is still huge. PD.402/403 extracted the prompt + post-LLM transforms; the build/generation flow (`_generateActivitiesForPlaceImpl`) is now a thinner orchestrator that calls those modules. Next cohesive candidates: the per-item decoration loop (id/headliner/_keep/_origin/day-trip defaults) and the construct-then-decorate merge. Extract like the existing modules, keep `bash tests/run.sh` green at each step.

### 1.5 Trip-view UI + map (Neal's current asks — UI, browser-verified only)
No Node harness for these — verification is the browser. Exact entry points:

- **DONE (PD.406, may be uncommitted): notes button on the detailed place view.** The trip-LIST destination card had a "📓 {place} notes" button; the detailed place view (`renderDestMode`-ish block in index.html ~line 59200, where `stBtn2`="About {place}" and `cmpBtn`="Compare tiles" live in `dmActs`) had none. Added a matching 📓 button there (calls `_pmEnsureResearchMeta()` + `_pmOpenResearchCard(dest.place)`).
- **TODO: inline trip-view search (replace the icon+dialog).** Today the trip view search is a 🔍 button → `openTripSearch()` dialog (`#trip-search-btn`, overlay ~index.html 6604, `data-menu="search"` button ~2483). Neal wants the **Discovery-style inline input** instead: see `#tb-place-act-search` (index.html ~20505-20560) — input + "2/5" match counter + ↑/↓ nav + scroll-and-highlight (`.tb-search-hit`). Replicate that inline in the trip view, wired to the trip's destinations/sights/notes, and retire (or fold into) the dialog.
- **TODO: unify the map renderers + shrink the gray sight pin.** Two renderers today — `_renderPlacePickerMap` (Discovery, index.html ~30011) and `drawTripMode`/main-map (`#main-map`, ~45567 / 56597). Icons differ between them (different sizing). Neal wants ONE renderer used by both, same icons; Trip just LAYERS routes/roads + day-trips + on-the-way decoration. Specific complaint: the **gray (unselected/considered) sight pin is a big teardrop** (`MaxMapPin` "see" role: teardrop 24×30, tip-anchored, index.html ~4371) — make it small and identical in both views. Confirm the exact small shape with Neal before changing pixels.

### 2. #80 — theming pass (SHIPPED + verified; flag default-OFF — flipping default-on is the remaining step)
Status update: #80 LANDED (PD.404 + PD.405) and is verified end-to-end by the canned-LLM build-harness test (`tests/playwright/build-harness.spec.js` → "PD.404: flag on → … broad categories, Max suggestions preserved"). Listed sights theme into broad categories, Max's suggestions are preserved, no render loop. It is still behind `localStorage 'max-theming-pass' === '1'` (default OFF). REMAINING: flip the default on (then verify the OTHER harness tests, which run flag-off today, still pass with theming active) — see history below for the original design notes.
Goal: get the user's listed SIGHTS sorted into themed sections instead of piling in a catch-all, without making generation re-emit the whole list (the re-emit is what makes the model drop places on long lists).

**Flag:** `localStorage 'max-theming-pass' === '1'`. Default OFF. With it OFF, behavior is identical to pre-#80 (the only always-on change is a no-op `_themeFit` read in `DiscoveryModel.fromPlaceActivities`).

**What's built and unit-tested (sound):**
- `MaxGenPrompt.buildThemingPrompt` + a `listHandledSeparately` option that softens the user-list block (don't re-emit).
- `MaxGenPost.applyTheming` (stamps a per-place `_themeFit`, splitting a grouped catch-all item across themes), `coerceThemingMap` (robust parse), country-suffix-tolerant matching.
- `MaxDiscovery.catchallSections()` / `isCatchallSection()` — the model's own "themeFit-null sections" set (includes "Sights you're keeping"); `fromPlaceActivities` honors a per-place `_themeFit`.
- `_runThemingPass()` runs in the reconcile phase (after `_reconcileListedSightsToSections`, before enhance).

**Layers already fixed (each was real):** ordering (run in reconcile, not primary) → country-suffix matching → target the model's catch-set incl. "Sights you're keeping" → per-place `_themeFit` to split grouped items.

**Why it's NOT done — the trap:** the theming pass correctly assigns themes (`sorted:31` in live diag), but the assignment does NOT survive to the final picker — a later stage (enhance/canonicalize/render) re-buckets the sights into "Sights near places you listed". The obvious fix (call `_applyDiscoveryModelToSights()` to "bake" `_themeFit`→section mid-build) causes an **INFINITE RENDER LOOP**: it reassigns the *routed* `_tb.placeActivities`, which emits `tripChange` → re-render → adapter → reassign → … (this hung builds and tripped Playwright teardown timeouts). That bake call has been removed.

**How to actually finish it (do this in a healthy env, NOT via live deploys):**
- Drive it through `tests/playwright/build-harness.spec.js` (the canned-LLM full-pipeline harness) with the flag ON and a canned theming response (the theming prompt matches marker `'A traveler is planning a trip'` + `'SORTING task'`; completeness is the same prefix WITHOUT 'SORTING task').
- The fix must make `_themeFit` (or a real theme section) **persist through enhance + the canonical write door** WITHOUT reassigning routed `_tb.placeActivities` mid-build. Likely options: (a) make the canonicalizer/enhance preserve `_themeFit`, or (b) feed theme assignments in BEFORE the model's first render so section-based placement carries naturally, or (c) a guarded single bake that goes through the proper write door with the PD.356a no-op guard intact.
- Assert in the harness that listed sights end in themed sections (not a catch-all), then ONE live confirm.

## One loose thread
The "my curated list vanished" scare was a workflow/timing artifact, not a code bug. If it recurs, the **401V tripwire** prints `[TripStore PD.401V] LARGE place-set drop` with a stack at the exact write.

## Conventions
- Never silently swallow test output (read the explicit pass/fail count).
- Root-cause, don't patch; reproduce in the harness before changing live behavior.
- NEVER reassign the routed `_tb.placeActivities` mid-build (it loops via tripChange). Writes go through TripStore.setPlaceActivities (the one door, with the PD.356a no-op guard).
- Max NEVER checks/unchecks anything; the user's pasted list is a contract (a listed place must never disappear).
- Sensitive: the Turso auth token was shared in an earlier session — treat as secret, never print it.
