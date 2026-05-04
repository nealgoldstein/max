# Max Playwright e2e tests

Browser-driven tests against `index.html`. Complement the engine-layer unit tests in `tests/engine-tests.js`.

## Quick start

```bash
cd tests/playwright
npm install
npm run install:browsers     # first time only
npm test                     # run headless
npm run test:headed          # watch it run
```

The config boots a local `python3 -m http.server` on port 8765 and points Chromium at it. The SW registers (matching production); each test resets storage + unregisters the SW for isolation.

## What's runnable today

**`trip-mutators.spec.js`** — 9 tests covering the Phase 2 mutator refactor. No LLM needed: each test seeds a finished Iceland trip into localStorage via `helpers/seed-trip.js`, navigates to the trip view, exercises mutators, asserts data + DOM state. This is the regression net for `addBufferNight`, `reverseTripOrder`, `delDest`, `makeDayTrip`, `addDayTripPlace`, `addDayTripToDay`, plus the central `tripChange` subscription.

## What's scaffolded but not runnable

**`picker-flow.spec.js`** — three picker→trip scenarios (Switzerland linear, Iceland round-trip with day-trip mechanism, edit-existing). All marked `test.skip` because they need recorded LLM fixtures that don't exist yet.

To bring them online:

1. Configure your Anthropic API key in localStorage (visit the app once, paste the key into the API-key form).
2. Capture fixtures:
   ```
   PLAYWRIGHT_RECORD=1 npm run test:headed
   ```
3. Each LLM call gets recorded into `fixtures/llm-fixtures.json`.
4. Verify the recordings look reasonable, commit them.
5. Remove `test.skip` from each scenario and flesh out the brief-flow drive code (TODO markers in the file).
6. Re-run without the env var — tests replay deterministically with no API calls.

The scaffold is complete: `helpers/mock-llm.js` handles record + playback, `helpers/load-app.js` handles boot modes, `playwright.config.js` boots the local server. Only the scenario implementations need to be written, and they need fixtures.

## File layout

```
tests/playwright/
├── package.json              — Playwright dep, npm scripts
├── playwright.config.js      — config + local server boot
├── README.md                 — this file
├── trip-mutators.spec.js     — runnable: Phase 2 mutator regression
├── picker-flow.spec.js       — scaffolded: picker→trip scenarios (skipped)
├── fixtures/                 — LLM fixtures (created on first record)
│   └── llm-fixtures.json     — keyed by SHA-256 of prompt
└── helpers/
    ├── seed-trip.js          — pre-built trip seeds (Iceland Ring)
    ├── load-app.js           — bootSeeded / bootClean
    └── mock-llm.js           — record + playback for callMax
```

## When this becomes the gate for the deferred refactor

Once `picker-flow.spec.js` is unskipped and green for all three scenarios, plus `trip-mutators.spec.js` is green, plus the engine tests are green, the `buildFromCandidates` decomposition (Round HJ, currently namespace-only) becomes safe to do. The contract:

> Every step of the decomposition must keep the entire test suite green.

That's the regression net the doc was waiting on. Until then, the decomposition stays parked.
