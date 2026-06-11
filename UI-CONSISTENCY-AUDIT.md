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
