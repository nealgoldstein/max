#!/usr/bin/env bash
# tests/run.sh — convenience runner for the engine test suite.
#
# Usage: from the max/ root:
#   ./tests/run.sh
#
# Exit code 0 = all green, 1 = something failed. Use this in pre-
# commit / CI hooks once that's set up.

set -e
cd "$(dirname "$0")/.."
# #2 Stage 2 safety net: every .mjs must re-publish its non-colliding top-level
# decls on globalThis (esbuild isolates each module to an IIFE). A forgotten
# exposure is invisible to tsc and the Node tests but breaks app-main.js boot in
# the browser — so verify it here, deterministically, instead of via a 14-minute
# Playwright red. Skips gracefully if acorn isn't installed.
if [ -f node_modules/acorn/package.json ]; then
  node tools/auto-expose.js --check
fi
node tests/contract-checks.js
node tests/canonical-placeset-tests.js
node tests/place-key-tests.js
node tests/section-kind-tests.js
node tests/discovery-model-tests.js
node tests/discovery-ingestion-tests.js
node tests/discovery-persistence-tests.js
node tests/discovery-enhance-tests.js
node tests/discovery-session-tests.js
node tests/discovery-ssot-tests.js
node tests/place-repo-tests.js
node tests/place-set-tests.js
node tests/golden-build-tests.js
node tests/listed-presence-tests.js
node tests/candidates-snapshot-tests.js
node tests/decision-model-tests.mjs
node tests/containment-tests.mjs
node tests/geo-extent-tests.mjs
node tests/gen-prompt-tests.js
node tests/gen-postprocess-tests.js
node tests/engine-tests.js
node --experimental-test-module-mocks tests/tripstore-tests.mjs
node tests/engine-build-tests.js
node --experimental-test-module-mocks tests/data-preservation-tests.mjs
node tests/engine-publish-tests.js
node tests/engine-enrich-tests.js
node tests/engine-routing-tests.js

# Incremental JSDoc type-checking (extensibility lever #1). tsc checks ONLY the
# files that opt in with a top-line `// @ts-check` (see tsconfig.json), against
# the shapes in types/max-model.d.ts. A type error fails the gate (set -e).
# Skips with a notice if typescript isn't installed, so the Node suite still
# runs without `npm install`.
if [ -x node_modules/.bin/tsc ]; then
  echo "── typecheck (tsc --noEmit, // @ts-check files) ──"
  node_modules/.bin/tsc --noEmit
  echo "  ✓ typecheck clean"
else
  echo "── typecheck SKIPPED — run 'npm install' to enable tsc ──"
fi
