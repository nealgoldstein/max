# Max test suite

Two layers, only one shipped today:

## Engine layer (shipped today)

`tests/engine-tests.js` — Node-runnable unit tests for the trip + picker engines.

```
./tests/run.sh
```

Or directly:

```
node tests/engine-tests.js
```

39 tests, ~1 second to run, no browser needed. Targets the namespace surfaces (`MaxEngineTrip.*`, `MaxEnginePicker.*`, `MaxDB.*`) and the back-compat window globals.

### What's covered

- All pure helpers in `engine-trip.js` (haversine, pair-key, fastest-practical, hour parse/format, place-name canonicalization)
- The FQ async verdict pipeline — service injection works; LLM is mocked; verdict + cache populate
- All pure helpers in `engine-picker.js` (findMatchingRequired, brief parsers)
- `orderKeptCandidates` against three trip shapes (Iceland round-trip, Switzerland linear, empty)
- Event bus (on/off/emit, throwing-listener isolation, unsubscribe-via-return)
- Service injection (separate slots on each engine)
- State sharing (`MaxEnginePicker.state` and `window._tb` are the same object)
- Trip-engine adoption (`replaceTrip` mutates + emits + handles edge cases)

### What's deliberately not covered

- The full picker → trip flow. That lives in DOM-driven inline-script code (button click handlers, modal flows, the picker right-pane). Belongs in Playwright.
- UI rendering (`drawTripMode`, `drawDestMode`). Pure DOM, also Playwright territory.
- The 600-line `buildFromCandidates`. The function is too entangled to unit-test today. The planned decomposition (Round HJ, deferred) will produce testable pieces (`Picker.publishTrip`, `Trip.load`).

### One known issue (skipped, deferred)

`orderKeptCandidates` substring-matches in both directions. When inferring the "Reykjavik" gateway, "Vik" matches because `"reykjavik".indexOf("vik") >= 0`. Test marked `xtest` with explanation; fix planned for the same round as the `buildFromCandidates` decomposition.

## Browser layer (Playwright — not shipped yet)

`tests/playwright/` — reserved for end-to-end tests that drive the actual app DOM.

When the e2e tests get built, they should cover (at minimum):

1. **Switzerland scenario** — multi-destination linear trip with route blocks (Glacier Express, Bernina), explicit entry Zurich + exit Geneva. Verifies the dense verdict, the route-block adjacency, day-trip suggestions, and the buffer-night handling.

2. **Iceland scenario** — round-trip with Reykjavik as both entry and inferred exit, multiple stops on Route 1, day-trip placement (Blue Lagoon), peer-night transfer mechanism.

3. **Edge case** — multi-region or no-explicit-exit trip to exercise the inference fallbacks.

Each scenario should mock the LLM via `MaxEngineTrip.injectService('llm', recordedFixture)` and `MaxEnginePicker.injectService('llm', recordedFixture)` so the tests are deterministic. A simple JSON fixture per (place A, place B) pair captures the LLM's transit-info responses.

### The hand-off contract

When the e2e tests reach green for the three scenarios, the `buildFromCandidates` decomposition (Round HJ, currently namespace-only) becomes safe to do. The contract is: **every split step must keep all tests green**. That's the regression net the deferred refactor needs.

## CI / pre-commit (future)

Once Playwright runs reliably:

```bash
# pre-commit
./tests/run.sh && ./tests/playwright/run.sh
```

Engine tests run in <1s — fast enough for every commit. Playwright might run only on push or on CI (slower).
