#!/usr/bin/env bash
# dev.sh — the Max local dev loop in one command each.
#
#   ./dev.sh serve    (re)start the preview server (kills any stale one first)
#   ./dev.sh check    run the full gate: Node suite + Playwright browser suite
#   ./dev.sh stop     stop the preview server
#   ./dev.sh help     show this
#
# The port lives in ONE place: dev.config (DEV_PORT). Both this script and
# tests/playwright/playwright.config.js read it, so they never drift.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# --- single source of truth ---
# shellcheck disable=SC1091
source "$ROOT/dev.config"
PORT="${DEV_PORT:-8765}"

free_port() { lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true; }

case "${1:-help}" in
  serve)
    free_port
    echo "→ Serving  $ROOT"
    echo "  Open:    http://localhost:$PORT/index.html"
    echo "  (Ctrl-C to stop. Leave this window running while you work.)"
    # no-cache server: every reload refetches, so dev code is never stale.
    exec python3 "$ROOT/dev-server.py" "$PORT" "$ROOT"
    ;;

  check|test)
    echo "→ Node suite (engine/contract checks)"
    bash "$ROOT/tests/run.sh"
    echo ""
    echo "→ Playwright browser suite"
    echo "  (reuses your running 'serve' server if one is up; otherwise starts its own)"
    ( cd "$ROOT/tests/playwright" && npx playwright test )
    echo ""
    echo "✓ gate complete"
    ;;

  stop)
    free_port
    echo "→ stopped any preview server on :$PORT"
    ;;

  help|--help|-h|*)
    sed -n '2,10p' "$ROOT/dev.sh"
    ;;
esac
