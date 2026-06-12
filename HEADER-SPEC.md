# Header redesign spec — trip / destination / discovery

**Status:** DRAFT for Neal's approval. No code changed yet.
**Goal:** one consistent, predictable header across all three views, with each
control in exactly one place.

---

## 1. Current state (what's actually rendered)

### Trip view
- **Nav chrome** (`index.html`, `.lp-hdr-unified` ~L2546): trip-name *label* (rename
  just removed) · · · `← Home` · `← Discovery` · `💬 Ask` · `✎ Profile` · `···`
- **Content header** (`trip-ui.js` ~L7749): **big trip name + ✎** (the *canonical*
  trip rename) + **"Trip profile" chip** (opens the same editor as nav "Profile") +
  date range + "21 days · 20 nights · 40 destinations".
- Then: budget banner, "Search this trip…" box.

### Destination view (drill-in)
- Same nav chrome as trip view.
- `dm-hdr` → `dm-hdr-nav` → **`← Destinations` back button** (`trip-detail-render.js`
  ~L1576). **This row is NOT sticky** — it scrolls out of sight.
- **Destination name + ✎** (canonical *destination* rename — prominent blue box).
- Dates + 📍 pin, then tabs (See and Do / Stay and Eat / On the ground / Bookings).

### Discovery / picker view
- **Different header entirely**: trip name + ✎ · · · `← Home` · `💬 Ask` · `Save` ·
  `Profile` · `⚙` · `🔑`, plus a "40 dest · 20 nights" chip
  (`menubar-phase.js` / `picker-hero-sidebar.js`).

---

## 2. Problems (yours + confirmed in code)

1. **Trip name shown twice** in the trip view (small in nav + big in content header).
2. **"Profile" duplicated** — nav `✎ Profile` and content `Trip profile` chip do the
   same thing.
3. **Trip rename offered in too many places** — nav corner (removed), content header,
   *and* Discovery. The destination view also exposes trip-level rename it shouldn't.
4. **`← Destinations` back link isn't sticky** — scrolls away; you must scroll to the
   top to escape the destination view.
5. **Discovery header is a different shape** — no shared structure with the others.

---

## 3. Proposed design — one header, everywhere

### 3a. Shared chrome bar (identical + STICKY in all three views)
```
[ Trip name — plain label ]            [ ← Home ]  [ ← Back-to-context ]  [ 💬 Ask ]  [ ✎ Profile ]  [ ··· ]
```
- **Always pinned to the top** (`position:sticky`), so navigation never scrolls away.
- **Trip name here is a LABEL only** — never a rename target (it's just the "which trip
  am I in" cue).
- **"Back-to-context"** is contextual: `← Discovery` in the trip view, `← Destinations`
  in the destination view. This *replaces* the separate non-sticky back row.
- **One `✎ Profile`** entry, here. (The content-header "Trip profile" chip is removed.)
- Discovery's extras (`Save`, `⚙`, `🔑`) fold into the `···` overflow — see Q3.

### 3b. Where each rename lives (exactly one place each)
- **Rename the TRIP** → only the big trip name in the **trip-view content header**.
  Removed from: nav corner (done), destination view, and the Discovery name block
  becomes a label.
- **Rename a DESTINATION** → only the **destination-view title** (keep as-is; it already
  has the clear blue-box treatment).

### 3c. Context line (consistent placement + format)
- One line directly under the chrome bar in every view:
  `21 days · 20 nights · 40 destinations` (trip) / same shape in Discovery (replacing
  the "40 dest · 20 nights" chip).

### 3d. Per-view summary after the change
| | Chrome bar (sticky) | Below it |
|---|---|---|
| **Trip** | name label · Home · Discovery · Ask · Profile · ··· | big name + ✎ (rename) · dates/counts · search |
| **Destination** | name label · Home · Destinations · Ask · Profile · ··· | dest name + ✎ (rename) · dates · pin · tabs |
| **Discovery** | name label · Home · Destinations · Ask · Profile · ··· | dates/counts · picks |

---

## 4. Implementation map (files to touch)
- `index.html` `.lp-hdr-unified` — make sticky; trip-name stays a label; ensure the
  contextual back + Profile live here.
- `trip-ui.js` (~L7749) — keep big name + ✎ as the trip rename; **remove the "Trip
  profile" chip** (now redundant with nav Profile).
- `trip-detail-render.js` (~L1576) — drop the separate `dm-hdr-nav` back row; the
  sticky chrome bar's contextual back replaces it. Keep the dest title rename.
- `menubar-phase.js` / `picker-hero-sidebar.js` — reshape the Discovery header to the
  shared chrome bar; fold `Save/⚙/🔑` into `···`; trip name → label.

---

## 5. Decisions — RESOLVED (Neal, this session)
1. **Trip name in the chrome bar** → small **label** (no rename).
2. **Profile** → in the **trip + Discovery** bars only; **removed from the destination
   drill-in** (profile drives Discovery suggestions + the trip budget/pacing readout, so
   it's relevant there but not inside a single stop).
3. **API key `🔑`** → **Home only**. **`Save` → REMOVED** from Discovery (autosave
   already covers every change; the off-device copy is `··· → Download backup (.json)`,
   re-imported via Home → Load from file). **`⚙` settings → `···` overflow.**
4. **`💬 Ask`** → stays in the bar across all views.
5. **Trip rename** → **trip-view header only** (removed from nav corner [done],
   destination view, and Discovery becomes a label).

**Spec is LOCKED. Implement view-by-view (trip → destination → Discovery), Neal
reviewing each screen.**
