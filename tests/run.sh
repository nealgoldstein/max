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
node tests/candidates-snapshot-tests.js
node tests/gen-prompt-tests.js
node tests/gen-postprocess-tests.js
node tests/engine-tests.js
node tests/tripstore-tests.js
node tests/engine-build-tests.js
node tests/data-preservation-tests.js
node tests/engine-publish-tests.js
node tests/engine-enrich-tests.js
node tests/engine-routing-tests.js
