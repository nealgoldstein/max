# Max → world-class architecture — the five workstreams

The *design* is already world-class-caliber (orthogonal axes, single-source
projections, strangler-with-shadow-checks, invariant gates). What remains is
closing the gap between the design and the running code. Five workstreams, each
with a finishable definition of done. Status as of this writing in brackets.

The governing rule for all of them: **a strangler is not done until the old path
is deleted. Land-or-revert; never leave two representations.**

---

## #1 — A verification loop you can trust  [STARTED]

*Why:* every change this session was bottlenecked by "can't verify in the
browser" + untested interactive paths (that's how `togglePlaceActivity` shipped
silently broken). World-class = fearless change because the gate catches
regressions in seconds.

- [x] Property-based invariant fuzz harness (`tests/place-invariants-fuzz.mjs`) —
      1000 random trips/run assert the structural + detector invariants; in `run.sh`.
- [x] Characterization gate for the activity keep-toggle (build-harness).
- [ ] **Fix the local dev loop** so the app actually boots/clicks on localhost
      (it was dead this session — likely the trip never finished loading). This is
      the single highest-leverage item: it unblocks manual smoke-testing of every
      subsequent change.
- [ ] Push the gate down into the **interactive surface**: a characterization test
      per keep/role/section toggle and per picker flow (most are currently
      untested). Acceptance: every wired `onclick` handler that mutates trip state
      has at least one Playwright assertion.
- [ ] Promote the shadow checks to **always-on**: run `registryShadowCheck` /
      `candidateMirrorCheck` / `keepShadowCheck` as a dev-mode runtime assert after
      each mutation (behind a flag), so drift surfaces the instant it happens.

## #2 — Finish the unifications, delete the old representations  [IN PROGRESS]

*Why:* the real disease is accreted half-finished migrations (`_keepOf` was a
prior attempt left mid-retirement). One representation per concept.

Current state: keep is now read through ONE accessor (`_keepOf`) and written
through ONE writer (`MaxRoleWriter.set`); the drift-bug class is closed. The
`_keep` cache still exists as a redundant mirror.

Finishable sequence (from OBJECT-MODEL.md §7):
- [ ] **Route the build seed through the log.** `app-main:8775`
      (`_keep = !!item.checked`) is the one keep source that doesn't write the
      decision log. Route it through `MaxRoleWriter.set` (or log the seed) so the
      log is COMPLETE. Acceptance: a publish→reload gate shows `_keepOf` derives
      every place's keep from the log alone (no `_keep` fallback) — extend the
      three-way reconcile to assert `keepOf-without-fallback === stored`.
- [ ] **Remove `_keepOf`'s `_keep` fallback** (one line) once the above is green.
- [ ] **Delete the `_keep` cache writes + the `MaxRoleWriter` mirror block.**
      Divergence becomes structurally impossible. Acceptance: `grep _keep` returns
      only the (now-removed) mirror site; the fuzz + keep-shadow gates stay green.
- [ ] **Repeat for `_isDayTrip` / `_rejected`** via `roleOf` / the decision.
- [ ] **Collapse candidate ↔ requiredPlace duplication** — make requiredPlaces a
      projection of the registry (candidates the working set), retire the PD.303
      bridge + reconciliation passes. This is where the six representations finally
      become one.

## #3 — Retire the god-module + the globals hack  [PLANNED]

*Why:* `app-main.js` is ~36k lines; modules talk through `auto-expose.js`
republishing onto `globalThis` (the code itself calls it "interim"). Every
`typeof _keepOf === "function"` guard is a symptom.

- [ ] **Carve cohesive domains out of `app-main.js`** leaf-first (the same
      strategy as the ESM migration #2 Stage 3): `picker/`, `build/`,
      `trip-view/`, `decision/`. Each carve: move a cohesive cluster to a module,
      convert its globals to real imports, re-point callers. One domain per PR,
      gate-verified.
- [ ] **Delete `auto-expose.js`** once no module reads a bare global. Acceptance:
      `expose:check` is removed from the gate because nothing needs exposing;
      `grep "__expg"` is empty.
- [ ] Replace remaining `typeof X === "function"` global guards with imports.

## #4 — Typed domain model  [FOUNDATION DONE]

*Why:* make illegal states unrepresentable (a place that's both a stale cache and
a record) — the compiler enforces the orthogonality you designed.

- [x] Core interfaces exist (`Place`, `PlaceGeo`, `ExploredFrom`, `PlaceDecision`,
      `RequiredPlace`, `Candidate`, `MaxDecisionSpec`) + typed `keepFor`.
- [ ] Make `buildRegistry` return `Map<string, Place>` with strict conformance
      (move `_destRecord` into a typed internal field or a side table).
- [ ] Typed signatures on every exported `MaxPlaces` / `MaxDecisions` accessor.
- [ ] Consider a real `.ts` migration for the domain core (decision-model,
      place-registry, geography-model) — strict mode, no `any` at the boundaries.

## #5 — Prune dead code  [STARTED]

*Why:* dead code is where bugs hide and the next engineer wastes a day.

- [x] Deleted dead `togglePlaceInActivity`.
- [ ] Periodic usage sweep: a script that flags exported/`__expg` symbols with no
      live caller (excluding tests). Run it, triage, delete. Acceptance: no
      exported symbol is referenced only by comments or its own expose entry.

---

## Sequencing recommendation

Do **#1 (fix the dev loop + interactive coverage) first** — it makes every other
workstream safe and fast. Then **#2** (finish the keep/role unification and delete
the caches/mirror — the bug-class is closed, this is the cleanup that collapses
the representations). **#3** (god-module) and the deeper **#4** (real TS) are the
largest and can run in parallel slices once #1 gives you a trustworthy gate. **#5**
is a cheap recurring hygiene pass throughout.

Each step ships behind a shadow check + a gate, reversible to a checkpoint tag —
the same discipline that landed the decision model, the ESM migration, and the
Place model.
