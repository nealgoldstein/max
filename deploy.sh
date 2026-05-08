#!/usr/bin/env bash
# v353: deploy.sh — single-command deploy with cache-busting and
# optional git commit+push.
#
# Why this exists
# ----------------
# Hardcoded ?v=NNN query strings on script tags in index.html are
# what bust the browser HTTP cache. There's no real service worker
# (sw.js was retired in v353), so this query-string version is the
# only mechanism. Bumping it by hand every deploy is the kind of
# step that gets skipped exactly when it matters most. This script
# substitutes ?v=DEV with a fresh epoch on every deploy so source
# never carries a version string, and the working tree is reverted
# to ?v=DEV after the deploy via a cleanup trap.
#
# Usage
# -----
#   bash deploy.sh                                    # frontend only, no commit
#   bash deploy.sh --server                           # frontend + worker
#   bash deploy.sh --commit                           # also git add+commit+push
#   bash deploy.sh --commit --message="round X.Y"     # custom commit message
#   bash deploy.sh --dry                              # show substitution, no deploy
#   bash deploy.sh --keep-stamp                       # don't revert ?v= after deploy
#
# Combine flags freely:
#   bash deploy.sh --commit --server --message="ship FN.7.8"
#
# Notes
# -----
# - In --commit mode the cache-buster substitution is reverted
#   BEFORE the commit so git history records only your real code
#   changes. After the commit + push, the substitution is
#   re-applied for the wrangler deploy. After deploy, the cleanup
#   trap reverts again so your working tree is clean. Net effect:
#   git is clean, deploys are timestamped, you don't think about it.
# - Default mode (no --commit) does NOT touch git. Substitutes for
#   the deploy, reverts after. Working tree returns to ?v=DEV.
# - --keep-stamp leaves the substitution in the source file. Useful
#   if you want to verify the deployed version locally without git
#   muddying it.
# - --commit-dirty=true on wrangler deploy lets it ship even if
#   git is dirty (which it usually is mid-substitution).

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "✗ wrangler not on PATH. Install with: npm i -g wrangler" >&2
  exit 1
fi

DRY_RUN=0
DEPLOY_SERVER=0
COMMIT_MODE=0
KEEP_STAMP=0
COMMIT_MESSAGE=""

for arg in "$@"; do
  case "$arg" in
    --dry)         DRY_RUN=1 ;;
    --server)      DEPLOY_SERVER=1 ;;
    --commit)      COMMIT_MODE=1 ;;
    --keep-stamp)  KEEP_STAMP=1 ;;
    --message=*)   COMMIT_MESSAGE="${arg#--message=}" ;;
    *)             echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

STAMP="$(date +%s)"
echo "→ stamp: $STAMP"

# Cross-platform sed -i. macOS BSD sed needs the empty '' arg; GNU
# sed (Linux) doesn't.
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)
else
  SED_INPLACE=(-i "")
fi

# Cleanup trap: revert the cache-buster substitution on exit (success,
# failure, or interrupt). --keep-stamp opts out.
SUBSTITUTED=0
cleanup() {
  if [ "$SUBSTITUTED" -eq 1 ] && [ "$KEEP_STAMP" -eq 0 ]; then
    sed "${SED_INPLACE[@]}" -E "s/\\?v=$STAMP/?v=DEV/g" index.html 2>/dev/null || true
  fi
}
trap cleanup EXIT

substitute() {
  if grep -q '?v=DEV' index.html; then
    echo "→ substituting ?v=DEV with ?v=$STAMP"
    if [ "$DRY_RUN" -eq 0 ]; then
      sed "${SED_INPLACE[@]}" "s/?v=DEV/?v=$STAMP/g" index.html
      SUBSTITUTED=1
    fi
  elif grep -qE '\?v=[0-9]+' index.html; then
    # Leftover from a previous --keep-stamp run; rotate it.
    echo "→ rotating existing ?v=<num> to ?v=$STAMP"
    if [ "$DRY_RUN" -eq 0 ]; then
      sed "${SED_INPLACE[@]}" -E "s/\?v=[0-9]+/?v=$STAMP/g" index.html
      SUBSTITUTED=1
    fi
  else
    echo "  (no ?v= markers found; skipping substitution)" >&2
  fi
}

# Step 1: substitute (or in dry-run, just preview).
substitute
if [ "$DRY_RUN" -eq 1 ]; then
  grep -nE '\?v=' index.html | head -10 || true
  echo "→ dry run — exiting before deploy"
  exit 0
fi

# Step 2: optional git commit + push, BEFORE deploy.
# Reverting the substitution first keeps git history clean of the
# timestamp; we re-apply it for the deploy. The order is:
#   substitute → revert → commit → push → re-substitute → deploy
# so GitHub records exactly the source that the deploy contains
# (modulo the timestamp), and the deploy itself has a fresh number.
if [ "$COMMIT_MODE" -eq 1 ]; then
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "✗ --commit requires a git repo" >&2
    exit 1
  fi

  # Revert the cache-buster substitution so the commit is clean.
  if [ "$SUBSTITUTED" -eq 1 ]; then
    sed "${SED_INPLACE[@]}" -E "s/\\?v=$STAMP/?v=DEV/g" index.html
  fi

  if [ -z "$(git status --porcelain)" ]; then
    echo "→ no code changes to commit; skipping git commit"
  else
    msg="${COMMIT_MESSAGE:-deploy $STAMP}"
    echo "→ git add -A && commit: \"$msg\""
    git add -A
    git commit -m "$msg"
    echo "→ git push origin main"
    git push origin main
  fi

  # Re-apply the substitution for the wrangler deploy that follows.
  if [ "$SUBSTITUTED" -eq 1 ]; then
    sed "${SED_INPLACE[@]}" "s/?v=DEV/?v=$STAMP/g" index.html
  fi
fi

# Step 3: deploy frontend to Cloudflare Pages.
echo "→ wrangler pages deploy ."
wrangler pages deploy . --project-name=max-app --commit-dirty=true

# Step 4 (optional): deploy worker.
if [ "$DEPLOY_SERVER" -eq 1 ]; then
  echo "→ wrangler deploy (server)"
  ( cd server && wrangler deploy )
fi

echo "✓ done. cache-buster ?v=$STAMP"
