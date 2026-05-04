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
node tests/engine-tests.js
