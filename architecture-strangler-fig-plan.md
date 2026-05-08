# Architecture: strangler fig migration plan

> Captured at v353.1, May 7 2026. Living document — update as steps land.

## Why this exists

`index.html` is ~23k lines holding HTML, CSS, and most of the JS in inline
`<script>` blocks. There's no module boundary; mutators, renderers,
persistence, bootstrap, and event listeners share one global scope. Two
parallel rendering paths (`drawTripMode`/`drawDestMode` in `index.html` and
`MaxTripUI.renderTripPage` in `trip-ui.js`) are circularly dependent.
Object identity has semantic meaning — DOM closures capture references to
specific dest/day/item objects, which is why we couldn't route `localSave`
through `MaxDB.trip.writeRaw` even though the architecture comments say
that's the goal.

The architecture works but every new feature compounds the debt. The next
major change will hurt unless we incrementally clean up.

## What this is NOT

**Not a rewrite.** Solo-developer rewrites are how solo apps die. The plan
below is a strangler fig: build the new architecture *alongside* the old,
migrate piece by piece, every step independently shippable. If we stop
halfway, the app still works.

## Principle

Every step:
- Leaves the app fully working.
- Is independently shippable (small enough to deploy on its own).
- Is independently valuable (not just setup for future steps).
- Reduces things-we-can-be-wrong-about, not increases them.

If a step doesn't satisfy all four, it doesn't belong here.

## Phase 1 — Mechanical extraction (~1 day, zero behavior change)

1. **Pull `<style>` out of `index.html` into `index.css`.** ~1000 lines
   moved. Add `<link rel="stylesheet" href="/index.css?v=DEV">` in head.
   Update `deploy.sh` to bump `index.css`'s `?v=` too. CSS edits stop
   scrolling past 22k lines of JS.

2. **Pull the giant inline `<script>` out of `index.html` into `app.js`.**
   ~20k lines moved. Add `<script src="/app.js?v=DEV"></script>` at the
   appropriate spot in the load order. Plain copy, NOT a refactor — same
   code, same global scope, same behavior. Editor stops thinking the
   file is binary, search becomes scoped, blast radius is visible.

This phase is infrastructure for everything else. Don't skip it; don't
expand its scope.

## Phase 2 — Tests and gates (~half a day)

3. **Three Playwright tests:**
   - Sync round-trip: edit on tab A → tab B sees it within poll.
   - Drag-drop with conflict: drop a timed sight onto a day with another
     timed item, verify conflict surfaces.
   - ✕→Later→assign-back: verify booking state survives the round trip.

   These cover the three flows where bugs silently corrupt data. Not
   exhaustive — sufficient.

4. **Wire tests into `deploy.sh`:** `npx playwright test || exit 1`
   before the wrangler call. Failing tests block deploys. Five-minute
   change, single highest-leverage guardrail in the migration.

5. **Add eslint with minimal config.** Just `no-unused-vars`, `no-undef`,
   complexity threshold. Surfaces dead code and globals you didn't know
   about.

## Phase 3 — Establish the new mutation seam (~1 day, isolated risk)

6. **Pick a name and an API.** Proposed: `MaxState.update(mutator, opts)`
   where `mutator` is `(trip) => void` and the function handles the
   post-mutation ritual: `localSave`, `_emitTripMutation`, autoSave,
   `MaxSync.scheduleSave`. ONE place owns this.

7. **Migrate ONE simple mutator** — `selectDest` is a good first one
   (tiny). Convert to `MaxState.update`. Tests pass. Ship.

8. **Document the rule.** At the top of the mutators section in `app.js`:
   *"All new mutators must call `MaxState.update`. Old ones may be
   migrated opportunistically."* Future code has a template; old code
   keeps working.

9. **Migrate two or three more** as you touch them. Don't try to do all
   30+ at once. Whenever you fix a bug or add a feature near a mutator,
   migrate that one as part of the change. After six months, 80% of
   mutators are on the new path.

## Phase 4 — Renderer cleanup (~2-3 days, spread across weeks)

10. **Remove the `mkItinItem` / `mkDay` wrappers** in `app.js`. Both are
    5-line delegators to `MaxTripUI.renderItinItem` / `MaxTripUI.renderDay`.
    Migrate the call sites to call `MaxTripUI` directly. Drop the wrappers.
    ~50 sites — boring, mechanical, immediately clearer.

11. **Identify the next renderer to lift.** Likely candidate: parts of
    `drawDestMode` that haven't been moved yet (each pane, each header).
    Lift one at a time into `MaxTripUI`, with tests in place from Phase 2.

12. **Eventually `drawTripMode` and `drawDestMode` shrink to dispatchers
    only** — they read state, decide what to render, call `MaxTripUI`. The
    actual rendering all lives in `trip-ui.js`.

## Phase 5 — Module boundaries (ongoing, low priority)

13. Once `app.js` is a separate file, common code clusters extract into
    focused modules: `file-io.js` (saveTrip, loadTripFile, restoreTrip),
    `dashboard.js`, etc. Don't pre-plan; let clusters emerge from the
    strangler.

14. Each module gets a one-paragraph comment block at the top: what it
    owns, what it depends on, what it doesn't touch.

## Phase 6 — Type system, optional (~1-2 weeks if you do it)

15. JSDoc-style type comments on the trip shape, dest shape, item shape,
    mutator signatures. Vanilla JS, just discipline.

16. Run `tsc --noEmit --allowJs` against the JSDoc-typed files. Type
    errors without converting anything.

17. Per-file conversion to `.ts` if and only if you find yourself wanting
    it. Not a mandate; an option.

## What stops the migration

Every strangler fig project plateaus around 60-80% complete. The remaining
20% is the worst legacy code, the trickiest edge cases, the least visible.
That's fine. The point isn't to finish — the point is that *every new
change has a clean place to land*.

## What to specifically NOT do during the migration

- **Don't add features in flight.** Resist scope creep. The strangler fig
  only works if each step is mechanical-extraction-only. The moment you
  say "let me also redesign the dest-mode tabs while I'm in there," you've
  blown the budget.
- **Don't refactor untouched code.** Boy-scout rule applies — leave the
  file better than you found it — but only the parts you touched.
- **Don't introduce new patterns just because they're elegant.** Match
  what's already there unless you have a concrete reason to deviate.
- **Don't make the new pattern perfect.** `MaxState.update` doesn't need
  to be CRDT-ready. It just needs to be better than the current scattered
  pattern. Iterate later.
- **Don't migrate to React/Solid/Vue/Svelte.** The app is built around
  DOM-mutation and object-identity in ways that don't translate. Three
  months of work to reproduce the bugs you already have.
- **Don't adopt TypeScript wholesale before extracting modules.** Get
  the file split done first; TS becomes a per-file thing, not a whole-
  codebase thing.
- **Don't try to finish the engine/UI split before tests are in place.**
  Mechanical work, but risky without tests. Add the tests first.
- **Don't build CRDT-style sync before there's a second human user.**
  Last-writer-wins with `__saved__` guard is correct in practice.
- **Don't add a bundler.** Static files served by Pages is the simplest
  possible deploy story; keeping it that way is a feature.

## What WOULD justify a real rewrite

(For the record, in case any of these apply later.)

1. Multi-user / shared trips with friends — would force rethinking
   conflict resolution, permissions, real-time sync.
2. CRDT-based sync as a hard requirement — current data model can't be
   patched into this; would force new shape.
3. Native iOS / Android push — going to React Native or similar is a
   rewrite either way.
4. A second developer joining who needs type safety to contribute.

If any of these become real, prototype the new architecture in a sandbox
first, prove it solves real problems, and only then start the migration.
Even then, strangler fig still wins.

## Concrete recommendation for "what to do this week"

Phase 1 step 1: extract CSS to `index.css`. 30-minute task, zero risk,
immediate clarity gain. Don't commit to anything beyond that yet — see
how it feels. If it feels good, do step 2 (extract JS to `app.js`) the
day after. By the end of the week you've done the highest-ROI part of
the entire migration without touching architecture at all.
