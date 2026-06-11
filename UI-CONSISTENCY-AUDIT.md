# UI Consistency Audit — 2026-06-11

Static analysis of the rendered UI's *design vocabulary* (colors, type, spacing,
components) across all views. Goal: one consistent visual language everywhere.

> Method note: computer use is off, so this is a **source-level** audit (the CSS
> and inline styles are the ground truth for what renders). The *findings* are
> solid and quantified; the *visual migration* (Phase 2+) should be done with
> eyes on the running app — see "How to execute safely."

---

## Executive summary — the one root cause

There is **no design-token system** (0 CSS variables) and **1,151 inline
`style="…"` attributes**. Every element hand-rolls its own colors, sizes, and
radii inline, so the *same conceptual thing* drifts from view to view. That
single fact produces every symptom below:

| Axis | Distinct values in use | What a consistent system needs |
|---|---|---|
| Hex colors | **291** (+25 three-digit) | ~24 tokens |
| Font sizes | **17** px values | 5–6 step scale |
| Border radii | **14** px values | 3 (sm/md/lg) |
| Button styles | primary defined inline **24×**; no shared secondary | 3 variants |

---

## Findings by severity

### 🔴 High — drift that's visible across views

**H1. Near-duplicate colors doing the same job.** Clusters that should each be
ONE token:
- **Light-panel grays:** `#f0f0f0` (37), `#fafafa` (37), `#f5f5f5` (26),
  `#f7f7f5` (11), `#f8f8f8` (10) — five barely-distinguishable backgrounds.
  A card is `#fafafa` in one view and `#f5f5f5` in another.
- **Brand blue + its drift:** `#1a5fa8` (185, the real primary) vs `#1a6fb0`
  (10) — a second "primary" blue. Plus light-blue tints `#c8d8f0` (27),
  `#cfe1f7` (11), `#eef5ff` (11), `#eef4fb` (9), `#e8f0fc` (2) — 5 variants for
  "selected/hover/border-blue."
- **Purples:** `#5b3f8f`, `#7c5cbf`, `#7a6294`, `#7a4fbf` — four mid-purples;
  plus pale purples `#f4eef9`, `#f5f0ff`, `#f0e8f5`.

**H2. No consistent secondary/"soft" button.** The primary CTA is `#1a5fa8`
(good, but inlined 24×). Secondary buttons have no shared style — their
backgrounds scatter across `#eef5ff` (blue), `#f3faec` (green), `#fff8f0`/
`#fff7eb`/`#fff7e0` (three different ambers), `#f4eef9` (purple), `#f8f8f8`/
`#f5f5f5` (gray). The same "soft action" looks different on every screen.

### 🟡 Medium — scale drift (reads as "slightly off," not obviously broken)

**M1. No type scale.** 17 font sizes, with **four crammed into a 3px band**
doing the same job: `11px` (285×), `12px` (197×), `10px` (150×), `13px` (112×).
Body/label/caption text isn't on a defined scale — it's whatever px the author
picked inline.

**M2. No radius scale.** 14 radii, four bunched at the "small" end: `6px` (137),
`5px` (106), `4px` (71), `7px` (20). Cards/buttons/inputs round inconsistently.

### 🟢 Low — mostly fine, minor strays

**L1. Type family is consistent** — `font-family:inherit` is used 312× (good).
A handful of strays: 2 `Georgia,serif`, a few explicit `-apple-system…` repeats
that should just inherit. Trivial.

---

## Proposed design-token system

Drop this `:root` block once, then migrate values to it. These are the
**canonical** picks (highest-frequency in each cluster, so most of the app is
already on them):

```css
:root {
  /* brand + roles (already the de-facto standard) */
  --c-primary:    #1a5fa8;  /* stay/brand blue — 185 uses */
  --c-see:        #2a7a4e;  /* committed sight green */
  --c-daytrip:    #7c3aed;  /* day-trip purple */
  --c-accent:     #5b3f8f;  /* Max-voice purple */
  --c-danger:     #e05050;
  --c-warn:       #b05820;

  /* surfaces (collapse the 5 grays → 2) */
  --c-bg:         #ffffff;
  --c-panel:      #fafafa;  /* subtle card/panel */
  --c-panel-2:    #f5f5f5;  /* one step deeper */
  --c-border:     #e8e8e8;
  --c-tint-blue:  #eef5ff;  /* selected/hover blue wash */
  --c-border-blue:#c8d8f0;

  /* text */
  --c-ink:        #1a1a1a;
  --c-ink-2:      #666666;
  --c-ink-3:      #999999;

  /* type scale (collapse 10–13 band → 3 steps) */
  --fs-cap:  11px;   /* caption/label */
  --fs-body: 13px;   /* body */
  --fs-h:    16px;   /* heading */
  --fs-xl:   22px;   /* page title */

  /* radius scale */
  --r-sm: 4px;
  --r-md: 8px;
  --r-lg: 12px;
}
```

---

## How to execute safely (phased)

1. **Phase 0 — tokens defined (safe, zero visual change).** Add the `:root`
   block above. Nothing changes yet; it just makes the vocabulary real.
2. **Phase 1 — collapse the exact-duplicate-intent colors (low risk).** Map the
   stray near-duplicates onto their cluster token: `#1a6fb0`→primary, the 5
   grays→`--c-panel`/`--c-panel-2`, the blue tints→`--c-tint-blue`/
   `--c-border-blue`. These are *meant* to be the same; the drift is accidental.
   **Verify each cluster with eyes on the app** (or a screenshot diff) before/after.
3. **Phase 2 — one shared button component.** Replace the 24 inline primary
   buttons and the scattered soft buttons with `.btn`, `.btn-soft`,
   `.btn-danger` classes. Biggest consistency win; needs visual review.
4. **Phase 3 — type + radius scale.** Snap the 10–13px sizes and 4–7px radii to
   the scale tokens. Mostly mechanical, but visual — review per view.

**Strong recommendation:** do Phases 1–3 with **computer use enabled** so each
change can be screenshotted and compared. Blind-editing 291 colors / 1,151
inline styles without seeing the result is exactly the kind of change that
should be verified visually, not just by the test suite (the tests assert
behavior, not pixels).

---

## Scope reality
This is a real, multi-session refactor (~291 colors, 1,151 inline styles). The
*analysis* is done; the *migration* is a project. Phase 0 is safe to land now;
Phases 1–3 want a visual feedback loop.

---

## Execution notes (2026-06-11 — what we learned doing it)

**DONE & shipped (PD.490) — the only blind-safe merges:** primary-blue dedup
`#1a6fb0`→`#1a5fa8`; light grays 5→3 (`#f7f7f5`,`#f8f8f8`→`#fafafa`). Verified by
usage data that these never erase a border or recolor text.

**CRITICAL LESSON — do NOT do a blind hex find-replace.** The same hex serves
DIFFERENT semantic roles in different places, proven with usage counts:
- `#f0f0f0` is a **border** 37× AND a **background** 15×. `#f5f5f5`: border 10×,
  bg 20×. Merging them erases card borders into their fills.
- `#1a1a1a` is **body-text ink** 14× AND a **button background** 4×. Merging the
  "blacks" would recolor your text.
So the migration MUST be **property-aware**: map each color by the CSS property it
sits in (`color` → ink token, `background` → panel/primary token, `border-color`
→ a SEPARATE border token), never by hex alone. Keep border tokens distinct from
background tokens even when their values match, so a bg+border on one element can
never collapse.

**Button decision (settled):** intentional TWO-TIER system — **black** primary for
top-level/home actions, **blue** (`#1a5fa8`) primary for in-trip actions. Don't
unify to one color; make each tier internally consistent and give the scattered
soft/secondary buttons ONE shared treatment.

**Tooling reality:** the live-CSS-injection loop (Chrome extension `javascript_tool`)
TIMES OUT on the real 44-destination Iceland trip — it's heavy (PD.479 re-fetches
all routes on load) and blocks the renderer's main thread. Compositor screenshots
(`mcp__computer-use__screenshot`) work fine even then, but can't inject. **Do the
visual loop on a LIGHT page** (home/Discovery, or a small throwaway trip) where the
CSS is the same but the page isn't churning — preview there, then apply to source.

**Recommended next-session shape:** (1) define the `:root` semantic tokens at their
CURRENT dominant values (zero visual change), (2) property-aware rewrite of inline
styles + CSS rules to `var(--token)` (still zero visual change — a pure refactor),
(3) THEN tune token values to consolidate, verifying each on a light page. Gate
every step with `bash tests/run.sh` + the full Playwright suite.

---

## SHIPPED — 2026-06-11 (PD.491–494) — the single-source system is live

Done exactly on the "recommended shape" above. Every step value-preserving (zero
visual change) and gated by the full Node + Playwright suite (55 passed, 3 skip).

- **PD.491 — Phase 0 + 1.** Dropped a 29→32-token `:root` block at the *real*
  dominant values (audit estimates were corrected against source: dominant border is
  `#ddd` not `#e8e8e8`; primary ink `#111`). **Property-aware AND context-aware:**
  border tokens kept distinct from equal-valued bg/ink tokens (so the `#f0f0f0`
  border-vs-bg and `#111` text-vs-button-vs-border collisions can't collapse).
  Migrated the main `<style>` block — 714 `color`/`background`/`border` → `var()`.
- **PD.492 — Phase 2.** Shared `.btn` system: `.btn` + `.btn-top` (black, top-level)
  / `.btn-primary` (blue, in-trip) / `.btn-soft` / `.btn-danger` / `.btn-sm`. The
  intentional two-tier primary is preserved. Home action buttons migrated to it.
- **PD.493 — Wave A (app-wide colors).** Context-aware var()-ize of **1,641** color
  literals inside `style="…"` attrs + `cssText` across index.html body + ~20 JS view
  files. **Critically: only CSS contexts** — SVG `fill=`, canvas `fillStyle`, and the
  pin/role color DATA (`pinColorForRole` still returns `#1a5fa8`) were left as hex,
  because `var()` does NOT resolve in canvas/SVG. Proven: no hex changed outside
  `style=`/`cssText`; all 27 JS files still parse.
- **PD.494 — Phase 3.** Semantic type scale (`--fs-micro`→`--fs-xl` at current px)
  and radius tokens; 326 font-sizes + 50 on-scale radii in the stylesheet → `var()`.
  Zero-visual (token px == original px).

**Net:** ~2,370 `var()` refs app-wide. Colors / type / radius / button-colors now
have a single definition. Tooling: `dev.sh` (serve/check/stop) + `dev.config`
(single-source port, read by `dev.sh` and `playwright.config.js`).

**Deliberately NOT done (needs eyes on each view — do with the user navigating):**
1. **Button MARKUP → `.btn` classes beyond home.** Buttons are heterogeneous (7+
   font sizes, 3 radii incl. `50%`) and `var(--c-primary)` is also used by NON-buttons
   (circular badges, dot indicators). A blind sweep would mis-convert badges and
   restyle ~159 buttons across unseen views. Migrate per-view, visually.
2. **Aesthetic CONSOLIDATION (the audit's original Phase 1/3 intent).** Actually
   *reducing* 17 font sizes → ~6 and 14 radii → 3 by snapping values. This is a real
   visual change (text reflow, corner shifts), so it needs per-view review. The
   tokens/scale are in place to make it a one-line-per-token change when ready.
