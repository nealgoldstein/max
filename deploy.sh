#!/usr/bin/env bash
# v353: deploy.sh — single-command deploy with automatic cache busting.
#
# Why this exists
# ----------------
# The hardcoded ?v=NNN query strings on script tags in index.html
# served as the de-facto cache-busting mechanism because sw.js was
# never registered as a real service worker. Bumping ?v=NNN by hand
# every deploy is the kind of step that gets skipped on the rounds it
# matters most — exactly what happened across ~300 release notes
# where the live JS had been ?v=1 for who-knows-how-long while the
# CDN files kept changing.
#
# This script flips that around: in source the string is ?v=DEV, and
# the deploy substitutes a fresh epoch timestamp at deploy time, then
# runs `wrangler pages deploy`. The repo never carries a version
# string at all, so there's nothing to forget.
#
# Usage
# -----
#   bash deploy.sh             # frontend only
#   bash deploy.sh --server    # frontend + worker (api.travelingwithmax.app)
#   bash deploy.sh --dry       # show what would be replaced, don't deploy
#
# Notes
# -----
# - Substitutes ?v=DEV → ?v=<epoch> in index.html only. Skips all
#   other files (sw.js, the docx README, etc.).
# - The substitution is in-place on the source file; the file ends
#   up with the timestamp committed. Next deploy bumps it again.
#   If you want the DEV marker to come back on disk after deploy,
#   change `--in-place` below to a tempfile dance.
# - `commit-dirty=true` lets wrangler ship without a clean git tree.
# - Does NOT run any test suite. Add a step here if/when you have one.

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "✗ wrangler not on PATH. Install with: npm i -g wrangler" >&2
  exit 1
fi

DRY_RUN=0
DEPLOY_SERVER=0
for arg in "$@"; do
  case "$arg" in
    --dry)    DRY_RUN=1 ;;
    --server) DEPLOY_SERVER=1 ;;
    *)        echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

STAMP="$(date +%s)"
echo "→ stamp: $STAMP"

# In-place sed. macOS sed needs the -i '' empty arg; Linux sed doesn't.
# Detect by trying GNU style first.
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)
else
  SED_INPLACE=(-i "")
fi

if grep -lq '?v=DEV' index.html 2>/dev/null; then
  echo "→ replacing ?v=DEV with ?v=$STAMP in index.html"
  if [ "$DRY_RUN" -eq 1 ]; then
    grep -n '?v=DEV' index.html | sed "s/?v=DEV/?v=$STAMP/" | head
  else
    sed "${SED_INPLACE[@]}" "s/?v=DEV/?v=$STAMP/g" index.html
  fi
else
  # Already-substituted from a previous deploy — bump again.
  if grep -qE '\?v=[0-9]+' index.html; then
    echo "→ rotating existing ?v=<num> to ?v=$STAMP in index.html"
    if [ "$DRY_RUN" -eq 1 ]; then
      grep -nE '\?v=[0-9]+' index.html | sed -E "s/\?v=[0-9]+/?v=$STAMP/" | head
    else
      sed "${SED_INPLACE[@]}" -E "s/\?v=[0-9]+/?v=$STAMP/g" index.html
    fi
  else
    echo "  (no ?v=DEV or ?v=<num> markers found; skipping)" >&2
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "→ dry run — skipping wrangler deploys"
  exit 0
fi

echo "→ wrangler pages deploy ."
wrangler pages deploy . --project-name=max-app --commit-dirty=true

if [ "$DEPLOY_SERVER" -eq 1 ]; then
  echo "→ wrangler deploy (server)"
  ( cd server && wrangler deploy )
fi

echo "✓ done. cache-buster ?v=$STAMP"
