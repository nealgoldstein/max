# NEXT SESSION — handoff

Read this first, then `ARCHITECTURE-AUDIT-2026-06-06.md` for the deep history.

## How to verify everything still works
```bash
cd ~/Desktop/max
bash tests/run.sh          # Node suite + 114 contract checks — must exit 0
cd tests/playwright && npx playwright test   # 20+ browser tests — must be all green
```
Deploy with: `bash deploy.sh --commit --message="..."` (runs the gate, bumps cache-buster, commits, pushes, ships to Cloudflare). Hard-refresh (Cmd-Shift-R) after.

## State — done and trustworthy
The "one identity / one source of truth" re-architecture is complete and locked:
- DiscoveryModel (single source of truth + single writer + pure placement policy)
- PlaceKey + alias registry; PlaceRepository (existence/coverage); canonical-at-write via TripStore.setPlaceActivities (the one write door)

Recent fixes (all deployed, all tested):
- **401T** — coverage matches by PURE name normalization, immune to corrupted learned aliases (fixed "8 listed places missing" + phantom "7 checked")
- **401R/S** — picker map pins from a place's own coordinates, with a raw-key fallback (fixed "sights in the list but not on the map")
- **401U** — activity generation RETRIES on an empty `[]` instead of silently leaving sights un-themed; logs `[Max PD.401U/diag] generation produced N item(s)`
- **401V** — test proves the full curated set survives publish into the trip; tripwire logs a large place-set drop at the write door
- **401W** — sync/persist invariants locked in the deploy gate (rev-gated pull; conflict defaults to keeping local; take-theirs needs a real server body; tripwire stays)

## Open work (in priority order)
1. **Monolith breakup** (the real remaining mass). `index.html` is ~62k inline lines, ~⅓ extracted into modules. Recommended next module: the **build/generation flow** — `_generateActivitiesForPlaceImpl` (in index.html, ~line 17020) plus its prompt assembly, parse loop, and the construct-then-decorate merge. Extract it like the existing modules (discovery-model.js, place-repo.js, max-data.js), keeping `bash tests/run.sh` green at each step.
2. **#80 — slim the generation prompt** so the model THEMES the user's existing places instead of re-emitting all of them (the intermittent empty-`[]` root, for large lists). Blocked on evidence: can't verify a prompt change without a real-LLM harness, and the 401U retry is the safety net. Act on it only if you see `[Max PD.401U] ... EMPTY after 2 attempts` in a live build — that's the signal the load is genuinely too high.

## One loose thread
The "my curated list vanished" scare was traced to a workflow/timing artifact, NOT a reproducible code bug — the local publish is proven sound and sync is guarded both ways. If it ever recurs, the **401V tripwire** prints `[TripStore PD.401V] LARGE place-set drop` with a stack at the exact write. Start there.

## Conventions
- Never silently swallow test output (read the explicit Playwright pass/fail count).
- Root-cause, don't patch; reproduce in the harness before changing live behavior.
- Max NEVER checks or unchecks anything; the user's pasted list is a contract (a listed place must never disappear).
- Sensitive: the Turso auth token was shared in an earlier session — treat as secret, never print it.
