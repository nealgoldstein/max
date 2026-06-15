# Max — Normalized Backlog & Status

**Single source of truth.** Consolidates the 2026-06-06/06-10 architecture audits, the
NEXT-SESSION handoff, and the PD task history. Read this first.

Last updated: **2026-06-11** · `index.html` ≈ **38,432** lines · ~**50** JS modules extracted.

---

## How to verify & ship

```bash
cd ~/Desktop/max
bash tests/run.sh                                  # Node suite + contract checks — must exit 0
cd tests/playwright && npx playwright test          # full browser suite — all green (55 pass, 3 skip)
```

Deploy: `bash deploy.sh --commit --message="..."` — runs the gate, stamps `?v=DEV`→epoch,
bumps the sw.js cache name, commits, pushes, ships to Cloudflare, then reverts to `?v=DEV`.
Hard-refresh (Cmd-Shift-R) after.

**Rule learned the hard way:** run the FULL Playwright suite before declaring a refactor
done — `build-harness` boots the app but doesn't click every button. A narrower gate missed
a module-load `ReferenceError` that the full suite caught (PD.483b).

---

## Done & trustworthy (recent)

**Data integrity (a real, booked trip can rely on it):**
- PD.475 — every raw trip write routes through the id==key asserting writer.
- PD.476 — `[0,0]` null-island coords scrubbed at ingestion (migration + place-repo).
- PD.477 — `publishTrip` checks its write result; warns loudly on failure.
- PD.478 — sync pull re-checks local before overwriting (no clobber of in-flight edits).

**Network reliability (survives Iceland's patchy signal):**
- PD.479 — transient OSRM cache stripped on save (a failed segment can't persist as a straight line).
- PD.480 — geo-queue races each task against a timeout (a hung Nominatim fetch can't latch the queue dead).
- PD.481 — `callMax` backs off on 429/529/503 instead of aborting Discovery/Enhance.

**Consistency / correctness:**
- PD.482 — dead `MaxMobile` removed; role-color drift guarded with a test (the two pin
  authorities intentionally differ by surface — the guard pins the one shared value).
- PD.484 (T4.1) — one canonical `_escHtml` (`util-esc.js`); 20 scattered escapers delegate to it.
- PD.485 (T2.7) — per-sight `s.research` folded into the one place-notes store.
- PD.486 (#80) — **theming pass ON by default** (sorts listed sights into themed sections);
  guarded by contract-check "Theming 1"; `"max-theming-pass"==="0"` is the escape hatch.

**UI design system / single source of truth (PD.491–494):**
- A `:root` token block is now the single definition for colors, type, and radius.
  ~2,370 `var()` refs app-wide (stylesheet + every inline `style=` + JS view files).
- Property-AND-context-aware migration: border tokens kept distinct from equal-valued
  bg/ink; only CSS contexts var()-ized (SVG `fill=`/canvas `fillStyle`/pin-color DATA
  left as hex — `var()` doesn't resolve there; `pinColorForRole` still returns `#1a5fa8`).
- Shared `.btn` system (two-tier black/blue preserved); button COLORS single-sourced.
- Every step value-preserving (zero visual change), gated by Node + full Playwright.
- See `UI-CONSISTENCY-AUDIT.md` → "SHIPPED — 2026-06-11" for the full record.
- Tooling: `./dev.sh serve|check|stop` + `dev.config` (single-source dev port).

**Architecture:** single role authority; base-to-base routes; DiscoveryModel SSOT + PlaceKey/
aliases + PlaceRepository; bloat reduction PD.449–483 (25 modules, 42.7k→38.4k lines).

**Full audit status:** Tier 1 (transient-error) — **all 8 done**. Tier 2 — T2.1/2.7 done, rest
below. Tier 3 — T3.4/3.7 done. Tier 4 — T4.1 done.

---

## Open work (prioritized)

### Correctness — investigated 2026-06-11 (PD.487)
- **T2.4 — DONE/deleted.** `_pmCoord` was alias-blind, but it had ZERO call sites — dead code
  carrying a latent bug. Removed it (the live coord resolution is the main pin loop).
- **T2.8 — NOT a bug.** `_grpIsStay` routes through the single authority (`_pmIsStayCandidate`
  → `_pmDeriveRole`); `nights>0` is a documented fallback for un-hydrated saved trips. Correct.
- **T2.10 — leave (diagnostic-only).** `getRejectedSights` reads per-dest `suggestions[]._rejected`
  vs considered/kept's collection, but it only feeds a debug stats snapshot — not user-facing.
  Reconciling means editing reject/curation logic (high-risk) for no user gain.
- **T2.5 / T2.9 — unverified-minor alias-blind reads** (`pinByKey` vs `_pinSeen`; `toggleDestKeep`'s
  raw `toLowerCase`). Same family as T2.3; fix only with a reproduction.

### Structural / perf — maintainability, no trip impact
- **T3.1 — double-render on every mutation. ✅ DONE (PD.433).** `_scheduleMainMapUpdate()`
  (`index.html` ~26681) coalesces repaints into one microtask; both the `tripChange`
  and `mapDataChange` subscribers route through it, so a mutation emitting both repaints
  `updateMainMap` ONCE, not twice. Also fixed the nights-flip case (the audit's risk note).
- **T3.2 — 125 direct `drawTripMode`/`drawDestMode`/`updateMainMap` calls** bypass the central
  subscription.
- **T3.3 — dead schema migrator + two version systems** on one field.
- **T3.5 — placeMeta/tripMeta two-store** with "_tb wins" stale hydrate.
- **T3.6 — god-functions** (`publishTrip` et al.) with mixed responsibilities.
- **T3.8 — `mdcItems` zombie field. ✅ DONE (PD.488).** Publish no longer emits it
  (`engine-picker.js` ~2318); no `trip.mdcItems =` write remains. The `tripstore` delete-on-save
  and the `max-data` legacy fallback are KEPT intentionally — they migrate pre-PD.488 saved
  trips that still carry the field.
- **T4.2 — `86400000`/`msDay` redefined ~12×;** **T4.3 — `_isStaySection` duplicates `SectionKind.isStay`.**

### UI design system — remaining (needs eyes on each view; not blocking)
- **Button MARKUP → `.btn` classes beyond home.** ~159 inline-styled buttons across
  trip/picker/Discovery. NOT a blind sweep: buttons are heterogeneous and
  `var(--c-primary)` is also used by non-buttons (badges, dots). Migrate per-view with
  the app navigated so each screen is visually reviewed.
- **Aesthetic consolidation.** Reduce 17 font sizes → ~6 and 14 radii → 3 by snapping
  to the scale. Real visual change (reflow / corners) — review per view. Tokens are
  already in place, so it's a per-token value edit once approved.

### Bloat phase 3 (ongoing, risky)
The remaining monolith sections have interleaved boot code (event listeners, load-time IIFEs,
template-embedded `<script>` tags). The pure-declaration extraction method is exhausted; these
need per-section boot-preservation. Higher risk, diminishing returns. **Recommend pausing**
unless there's a concrete reason.

### Assessed — intentionally leaving (don't "fix" without a reason)
- **#19 — Discovery picker pins** are deliberately richer than the map factory (selected ring,
  grayed variant, place-initials, gray-`?` see pin). Routing through `MaxMapPin.draw` would
  regress them or bloat the factory.
- **#20 / T2.6 — "View larger" popout pins** live in a *separate browser window* with serialized
  HTML; can't share the factory without first extracting `MaxMapPin` to a module + loading it
  there. Bigger cross-window change.
- **T2.2 — two distance formulas** (equirectangular `*111` for local fast-paths vs haversine):
  intentional perf/precision split; thresholds (wayside >4km, day-trip >8km) are tuned to it.
- **T2.3 — `MaxPlaceKey.normalize` alias-blind:** no reproduction; speculative key-logic changes
  caused past disappearing-pin bugs.

---

## Conventions
- Root-cause, don't patch; reproduce in the harness before changing live behavior.
- NEVER reassign the routed `_tb.placeActivities` mid-build (it loops via `tripChange`). Writes
  go through `TripStore.setPlaceActivities` (the one door, with the PD.356a no-op guard).
- Max NEVER checks/unchecks anything; the user's pasted list is a contract — a listed place must
  never disappear (401V tripwire watches for a large place-set drop).
- Every new extracted module goes in the `tests/contract-checks.js` haystack; `globalThis.X = X`
  exposures must be `typeof`-guarded (a cross-script exposure runs before its function's script
  loads — PD.483b).
- Sensitive: the Turso auth token was shared in an earlier session — treat as secret, never print it.
