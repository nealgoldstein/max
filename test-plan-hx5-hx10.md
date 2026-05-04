# Manual test plan — HX.5 through HX.10 picker refactor

**Status:** ready for execution against `max-v282`.

**Scope:** 6 rounds (HX.5–HX.10) extracting pure logic + DOM out of `renderCandidateCards` (~24kloc index.html → engine-picker.js + picker-ui.js). Adds 12 engine APIs, 4 picker-ui APIs, 60 engine tests. Plus a latent ReferenceError fix on the activity lens (the default lens) — likely cause of recent picker crashes.

**Format:** every test has a **DO** list and a **VERIFY** checklist. Mark each ✅ / ⚠ / ❌ / 🤔 as you go. Don't fix during testing — just observe and note.

**Terminology note:** the engine code still calls things "must-dos" (the original internal name) but the user-facing copy renamed them to "your trip includes" / "your picks." The test plan uses the visible copy throughout — if you see "experiences" or "what you want to do" or "your picks" in the UI, that's the same data the engine calls "mdcItems" / "mustDoOrder."

---

## ALREADY VERIFIED (programmatic, by Claude)

These don't need a re-run — confirming for the record:

- [x] **Engine test suite:** 140/140 passing.
- [x] **API surface in browser:** all 15 functions exist (11 engine + 4 picker-ui) — verified by both Playwright smoke and direct console run on your machine ("function / function / →").
- [x] **HX.6 bug fix:** `groupCandidatesByMustDo` returns `mustDoOrder` correctly. The activity-lens ReferenceError that was blocking the default view is gone.
- [x] **Activity / Region / Commitment lenses:** all three render `renderCandidateCards` against synthetic candidate data without throwing.

What's left is the parts that need a human eye on the actual running app.

---

## SETUP — once before starting

1. **Restart localhost** so the new SW (`max-v282`) is what serves the page:
   ```
   lsof -ti:8000 | xargs kill -9 2>/dev/null
   cd ~/Desktop/max
   python3 -m http.server
   ```
2. Open `http://localhost:8000/index.html` in your browser. (No trailing dot.)
3. DevTools → **Console**. Leave it open the entire time so JS errors are visible.
4. Hard-refresh: ⌘⇧R. If the SW is older than `max-v282`, you'll see network requests for the bundle; if it's already current, you may not. Either way the console snippet from "ALREADY VERIFIED" tells you the truth.

(Engine tests also run with `node tests/engine-tests.js` if you want to run them locally; needs Node installed via `brew install node`. Optional — they passed when Claude ran them.)

---

## SECTION 1 — Picker overlay opens (HX.6 bug fix)

This is the highest-priority manual test. Before HX.6 the activity lens crashed silently on a stale `mustDoOrder` reference, which is the most likely cause of "review thread keeps crashing."

### 1.1 — New trip → picker opens

**DO:** Start a new trip from the home screen. Walk through the brief flow, get to the picker page where candidate cards appear.

**VERIFY:**

- [ ] Picker page opens; you see candidate cards.
- [ ] **No console error.** (Especially no `ReferenceError: mustDoOrder is not defined` from `renderCandidateCards`.)
- [ ] Below the page header you see an **"Organize by:"** lens bar with three chips: **Activity** / Region / Status. Activity chip is highlighted (default).

### 1.2 — Existing trip → "Edit your picks" reopens picker

**DO:** From a trip view, find whatever reopens the candidate explorer. (Look for "Edit destinations", "Edit your picks", or similar — the wording may have shifted.)

**VERIFY:**

- [ ] Picker reopens with prior selections preserved (kept ones still marked ✓).
- [ ] No console error.

---

## SECTION 2 — Activity lens (default)

### 2.1 — "Your trip includes" summary block (HX.9 picker-ui move)

This block only renders if your trip has explicit picks beyond the basic discovery. If your trip is "free-form Iceland" with no specific routes/activities you anchored, this block won't appear at all — that's correct behavior, **not** a bug.

**DO:** Look near the top of the activity lens. Quick console probe:
```js
(window._mdcItems || []).filter(m => m && m.name && m.name !== '__manual__').length
```
If that prints `0`, skip 2.1 entirely (no data to summarize). If `>0`, look for the block:

**VERIFY (only if data exists):**

- [ ] Header reads `"Your trip includes · N"` where N matches the count from above.
- [ ] Each row shows a colored badge prefix (🚂 Scenic travel / ✨ Activity / ⚠ Condition / 📌 Place).
- [ ] Routes show a second-line endpoint pair like `Chur → Tirano` (forward arrow); if a route's `direction` is `either` it shows `↔`; reverse shows `←`.
- [ ] Each row has a × toggle on the right. Click × on one row.
- [ ] Row turns gray and shows " off". Toggle becomes ↺. The candidate cards belonging to that pick disappear or dim.
- [ ] Click ↺ to restore. Row goes back to dark, candidates return.

### 2.2 — Section type ordering (HX.7)

**DO:** With multiple types in your trip (mix of route + activity + condition + custom chip), look at the umbrella headers on the activity lens.

**VERIFY:**

- [ ] Sections render in this order: **Scenic travel** (routes) → **Activities** → **Conditions** → **Places you added** (manual).
- [ ] Empty types are skipped EXCEPT route + activity, which render their header even with no candidates yet (with a "places will appear below as they load" hint inside the empty section).

### 2.3 — Section title format (HX.10)

**DO:** Look at any section's header.

**VERIFY:**

- [ ] Routes specifically read `{name} · scenic travel` (e.g. `Bernina · scenic travel`), not `· route`.
- [ ] Other types pass the raw word through (`activity`, `condition`).
- [ ] Untyped chips show just the name (no separator).

### 2.4 — "+ more like this" depth-discovery button (HX.6's bestPickFirstSort)

The blue "+ more like this" chip on each section asks Max for additional candidates where that section's activity / route / theme is iconic. The refactor didn't touch the chip itself, but it did promote the per-section sort it relies on (`bestPickFirstSort`) into the engine — so when new candidates come back from the LLM, they slot in the right order.

**DO:** Click the blue **"+ more like this"** button on any section.

**VERIFY:**

- [ ] Button shows a loading state while Max thinks.
- [ ] New candidate cards appear in the section (or a polite "no more iconic options found" if there aren't any).
- [ ] Within the section, kept cards stay first; new arrivals slot in by required → other.
- [ ] No console error.


### 2.5 — Discoveries / "Other places worth considering"

**DO:** If your trip has discovery candidates (places that aren't anchored to anything you specifically asked for), they should appear after the umbrella sections.

**VERIFY:**

- [ ] Section header reads "Other places worth considering" if anything rendered above; otherwise just "Places".
- [ ] In best mode, the discoveries don't render cards but their pins still show on the map (grayed).

---

## SECTION 3 — Region lens (HX.7 + HX.8)

### 3.1 — Switching to region

**DO:** Click the **Region** chip in the lens bar.

**VERIFY:**

- [ ] Cards re-render. No console error.
- [ ] Sections are now country headers (e.g. `Switzerland · 5 places`, `Italy · 2 places`).
- [ ] Countries are ordered by candidate count, descending. Ties break alphabetically.
- [ ] Within each country: kept candidates appear first, then alphabetical by place name.
- [ ] Unknown / missing-country candidates land in an "Unknown" bucket.

---

## SECTION 4 — Status (commitment) lens (HX.8)

### 4.1 — Switching to status

**DO:** Click the **Status** chip in the lens bar.

**VERIFY:**

- [ ] Cards re-render. No console error.
- [ ] Two sections: **"Kept — already in your trip · N"** (green-ish) and **"Undecided — still open · M"** (black).
- [ ] Kept count matches your green-checkmark cards.
- [ ] Empty bucket sections don't render at all (no headerless block).

---

## SECTION 5 — "Your picks" stay-total summary (HX.5)

### 5.1 — Stay range computation

**DO:** With kept candidates whose stay ranges sum to a known total (e.g. `2-3 nights` + `3 nights` → `5–6 nights`), look at the picker header for the stay-total line.

**VERIFY:**

- [ ] Line reads `Your picks: 5–6 nights · Trip: {trip duration}` if your duration is parseable, otherwise just `Your picks: 5–6 nights`.
- [ ] If kept total exceeds trip max → text shows in **red** (#c05020).
- [ ] If kept total is below trip min → text shows in **green** (#2a7a4e).
- [ ] If within range → **gray** (#555).
- [ ] Single-value range formats without a dash (e.g. `7 nights` not `7–7 nights`).

### 5.2 — Reactive update

**DO:** Click "Keep" on a candidate that wasn't kept before. Then "Reject" on a kept one.

**VERIFY:**

- [ ] Stay-total line updates immediately, with the kept-count footer.
- [ ] No console error.

---

## SECTION 6 — "Maybe later" rejected section (HX.8)

### 6.1 — Rejected section appears

**DO:** Reject 1–2 candidates by clicking × on the cards.

**VERIFY:**

- [ ] At the foot of the picker a **"Maybe later · N"** collapsible appears, expanded by default.
- [ ] Each rejected place has a single-line entry with a **Restore** button.
- [ ] Clicking Restore returns the card to the active section above.

### 6.2 — Toggle persists across re-renders

**DO:** Click the toggle to **collapse** the section. Then click any candidate's Keep/Reject button (which re-renders the picker).

**VERIFY:**

- [ ] After re-render, the Maybe-later section is **still collapsed** (state preserved via `_ceRejectedExpanded`).

---

## SECTION 7 — Lens bar (HX.7 picker-ui move)

### 7.1 — Lens switching round trip

**DO:** Click each lens chip in turn: Activity → Region → Status → back to Activity.

**VERIFY:**

- [ ] Each click flips the active chip to highlighted (black background, white text).
- [ ] Cards re-render correctly for each lens.
- [ ] No console error on any switch.

---

## SECTION 8 — Build trip (the picker → trip handoff)

The refactor reorganized many call sites that feed publishTrip. Worth confirming the build still works.

### 8.1 — Build a fresh trip

**DO:** With kept candidates and entry/exit cities filled in, close the picker overlay (which silently materializes the trip per Round CT — no separate "Build trip" button).

**VERIFY:**

- [ ] Trip materializes. Trip view renders.
- [ ] Destinations match the kept candidates.
- [ ] No console error.
- [ ] If geocoding fails on some places (Nominatim 429 / CORS — see deferred item 11), the pins may be missing but the **trip itself still builds**. Pins missing = expected; trip not building = bad.

### 8.2 — Edit destinations from trip view

**DO:** From the trip view, reopen the picker.

**VERIFY:**

- [ ] Picker reopens with prior selections.
- [ ] Reject one place, click "Apply changes →".
- [ ] Trip rebuilds with that place removed.

---

## ROLLBACK

If anything in Sections 1–8 fails:

1. The new files are untracked — git won't touch them.
2. `index.html` and `sw.js` are modified-but-not-committed.
3. To revert just those two: `git checkout -- index.html sw.js`. The new engine + picker-ui files stay around for a future attempt.

---

## SCORING

- All ✅ → ship it (commit the call-site migrations + new files).
- One or two ⚠ in low-stakes sections (e.g. color shade off by one) → fix-forward.
- Any ❌ in Sections 1–2 (smoke + activity lens) → rollback or hot-fix; the activity lens is the default and any crash there is user-blocking.

---

## CHANGES IN THIS REVISION

- Reflected the "must-do" → "your trip includes" / "your picks" rename in user-facing prose. Engine API names left alone (still `mustDoOrder`, `partitionMustDosByType`, etc. — internal-only).
- Marked four sections as **already verified by Claude** (engine tests, API surface, HX.6 fix, all-three-lenses smoke render) — those don't need a re-run.
- Made `node tests/engine-tests.js` optional (you don't have Node installed; they passed when Claude ran them).
- Updated 2.1 with a console probe so the test isn't a false negative when the trip happens to have no anchored picks (the block correctly hides in that case).
- Updated 8.1 to reflect that closing the picker silently builds the trip (no separate Build button per Round CT).
- Pointed 8.1 at the deferred Nominatim issue (item 11 in design-notes.md) so a missing pin isn't mistaken for a refactor regression.
