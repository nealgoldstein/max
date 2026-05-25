# Test plan — May 23, 2026 session

What to verify before considering today's work shipped. Group by feature; expected behavior is the success criterion.

Run the full Playwright suite first:

```
cd ~/Desktop/max/tests/playwright && npm test -- trip-view.spec.js
```

Should be **16/16 green**. If any fail, paste error-context.md and we fix before manual testing.

Then deploy and walk through the manual cases below.

```
cd ~/Desktop/max && bash deploy.sh
```

---

## 1. Trip view layout

### 1.1 Arrival/Departure panel placement
Open an existing trip. Look at the top of the trip view.

**Expected:**
- Dates strip + phase chips render at the very top
- Immediately below: Arrival/Departure panel (or "⚠ Set arrival and departure to lock in the calendar" if not set)
- Then: Trip-level Bookings section
- Then: conditional banners (over-budget, etc.)
- Then: Spark intake (✨ "What else might matter on this trip?")
- Then: Destinations list

The arrival/departure block should be visible without scrolling on any trip.

### 1.2 Migration toast on trip load
Open a trip that has existing waysides on routes (e.g. the Iceland trip).

**Expected:**
- Brief toast appears in the bottom corner about 1 second after the trip loads
- Toast reads something like `✓ Updated this trip: moved 2 waysides to a better leg · fixed 3 destination pin locations`
- Toast auto-dismisses after ~6 seconds
- On second load of the same trip, no toast (migration flags set)

---

## 2. Map rendering

### 2.1 Pin shapes for accessibility (#109)
Open a trip with mixed pin kinds (Iceland trip is ideal).

**Expected:**
- **Overnight destinations**: circles with numbers, blue
- **Day-trip stops**: rounded-square pins with letter abbreviations, purple
- **Waysides**: hexagons, purple (lighter)
- **Considered/set-aside**: dashed-ring circles, grey
- All four shapes are distinguishable without color (squint test — close your eyes halfway and you should still see distinct silhouettes)

### 2.2 Wayside-detour route visibility
On the Iceland trip, look at segments that have waysides (e.g. Reykjavik → Vík with multiple stops).

**Expected:**
- Each wayside-bearing leg shows a dashed purple route line bending through the waysides
- Route has a white halo for contrast on the satellite tiles
- Non-wayside legs show the direct dashed blue route line
- No segments are missing a route

### 2.3 Wayside-destination dedup
Look closely at each numbered destination pin. None should have a smaller purple shape inside or overlapping it.

**Expected:** No "purple bullseye in blue ring" effect. If a wayside resolves to the same name or coords as a destination, it should be suppressed entirely (not rendered).

### 2.4 No white wayside-label boxes
Scan the map for floating white rectangles with text in them.

**Expected:** Zero. Waysides are dots only. Hover or tap to see the name in a tooltip.

### 2.5 Wayside geometry sanity-check
Look at Friðheimar Greenhouse (or similar wayside that was previously on the wrong leg).

**Expected:** It's on the leg whose chord it sits closest to — likely Reykjavík → Gullfoss, not Gullfoss → Seljalandsfoss. On first load post-deploy, the migration toast confirms `moved N waysides to a better leg`.

---

## 3. Role popover

### 3.1 Opens with all role options
Tap any destination pin on the trip map (or click "↺ Change role" on a destination card).

**Expected:**
- Popover opens centered with header `ROLE ON THIS TRIP` + place name
- Four options visible: Overnight stay (current), Day trip, Wayside, See
- Current role is highlighted with a blue border + "(current)" tag
- Cancel and Apply buttons at the bottom

### 3.2 "What's here" block on a destination
Open the popover for a destination that has discovery items / activities tied to it (e.g. Reykjavik with linked mdcItems).

**Expected:**
- Purple-tinted "What's here" block appears between the place name and the role options
- Lists up to 6 activities, each with a ✨ icon, name, optional description
- "+ N more" appears if there are more than 6

### 3.3 "What's here" block on a wayside
Tap a wayside pin (e.g. Þingvellir National Park as a wayside).

**Expected:**
- Popover header shows the wayside's name
- "What's here" block shows: place name · duration (e.g. `1h 30m`) · distance from start (e.g. `~45 km from Blue Lagoon`) · LLM-written description

### 3.4 Wayside gate by sight count
Find a destination that has more than 2 mdcItems linked to it. Open its role popover.

**Expected:** The "Wayside" option is hidden. Day trip / Overnight stay / See are still offered.

For a destination with 2 or fewer mdcItems, the Wayside option appears.

### 3.5 Reverse direction still available
Tap a wayside (e.g. Akureyri). Open the popover. Pick "Overnight stay". Apply.

**Expected:**
- Popover closes
- Akureyri appears as a destination card in the trip view
- An amber pulse flashes on that card briefly
- No `[Max]` console warnings (open DevTools to verify)

---

## 4. Role conversion visual continuity

### 4.1 See → Overnight flash
Find a destination set to "See" (0 nights). Open its role popover. Pick "Overnight stay". Apply.

**Expected:** The same destination card pulses with an amber glow for ~2 seconds. Card scrolls into view if offscreen.

### 4.2 Overnight → Wayside flash
Open the popover for a middle destination (has prev + next). Pick "Wayside" (the natural prev → next route should appear in the dropdown). Apply.

**Expected:**
- Destination card disappears from the list
- The route chip between the two adjacent destinations pulses amber

### 4.3 Day-trip → Overnight flash
Tap a day-trip pin (purple rounded square). Pick "Overnight stay". Apply.

**Expected:** New destination card appears in the list with an amber pulse.

### 4.4 Overnight → Day-trip flash
On a destination near a larger hub, open popover. Pick "Day trip", select the hub. Apply.

**Expected:** The hub destination card pulses (because the day-trip chip now lives there).

---

## 5. Per-leg honesty surface

### 5.1 Drive time + stop count
Look at any "Routing →" chip between two destinations on the trip view.

**Expected:**
- Above the Routing button, a small grey line reads `~Xh drive` (e.g. `~2h45 drive`)
- If the leg has waysides, it reads `~Xh drive · N stops along the way` (e.g. `~2h45 drive · 3 stops along the way`)
- The drive estimate is computed via haversine ÷ 60 km/h; the "~" prefix marks it as ballpark

---

## 6. Spark intake → Discovery panel

### 6.1 Capture a wisp
Type something into the ✨ Spark intake at the top of the trip view (e.g. "puffins"). Press Enter or click Capture.

**Expected:**
- Input clears
- Toast appears: `✨ Captured — Max will consider this next time Discovery runs`
- The Discovery panel below the intake pulses (~1.5s amber pulse, 2 cycles)
- Counter increments (e.g. "Discovery: 3 new ideas to evaluate")

---

## 7. "How Max thinks" philosophy modal

### 7.1 From home screen footer
Open Max → home screen. Find the small "How it works →" link in the footer action bar.

Click it.

**Expected:**
- Modal opens, titled "How Max works" / "The philosophy behind the tool"
- Opening content: river metaphor (currents, eddies, flicker of light on the surface)
- Includes Eisenhower quote: "Plans are useless, but planning is everything."
- Middle section: wisp → living → travel → real → lineage 5-state arc
- Includes Faulkner quote: "The past is never dead. It's not even past."
- Closes via × or "Got it" button

### 7.2 From trip view More menu
Open any trip. Scroll down to the "More" section. Expand it.

**Expected:**
- "🌊 How Max thinks" row visible
- Clicking it opens the same modal as 7.1
- Modal renders correctly even though `#home-screen` is hidden (the modal re-parents to `body` on open)

---

## 8. Wayside from discovery (Phase 3+4+5 vertical)

### 8.1 Mark a candidate as "Along the way"
Open the picker (Discovery phase) on a trip that has at least 2 overnight hubs kept. Find a candidate that geographically sits between two of those hubs (e.g. a place along the Ring Road between Reykjavik and Vík).

Click the candidate's role chip / "Change role" affordance.

**Expected:**
- Popover opens with the candidate's name
- Three options visible: Overnight stay, Day trip from <hub>, **Along the way**
- The "Along the way" option shows the chord it sits on (e.g. `A stop on the drive from Reykjavik → Vík · ~12 km off the line`)

Pick "Along the way" → Apply.

**Expected:**
- Candidate is marked as wayside (close popover; card may show a small badge or no longer show the day-trip role)

### 8.2 Publish the trip
After marking one or more candidates as waysides, complete the picker flow and publish the trip.

**Expected:**
- The trip view shows the wayside-marked candidates as hexagonal pins on the right legs
- The wayside doesn't appear as a destination in the destinations list
- Console shows `[Max publishTrip] wayside commits: N attached, 0 dropped`

### 8.3 Verify the wayside is on the correct route
On the trip view, look at the route chip between the two hubs that flanked the wayside.

**Expected:** The leg's `~Xh drive · N stops along the way` count includes the new wayside. Tapping the hexagon pin opens the popover with "What's here" showing duration + distance + description.

---

## 9. Defensive / edge-case paths

### 9.1 Day-trip chip silent no-op
This is hard to trigger artificially — it only fires if `ungroupDayTripByRouteStop` is undefined when a chip is clicked. Skip unless you can reproduce.

**Expected if reproduced:** Toast `⚠ Day-trip action unavailable in this build — please reload.` (not silence).

### 9.2 localStorage full
Hard to trigger without filling up storage. If you happen to hit it:

**Expected:** Blocking alert: `⚠ Your edits aren't being saved on this device.` with two suggested actions (sign in, or export a backup).

---

## 10. Regression sweep

After all the above, do a quick general regression sweep:

- [ ] Home screen renders trip cards correctly
- [ ] Clicking a trip card opens the trip view
- [ ] Trip name visible and editable
- [ ] Destinations can be reordered via drag or ↑↓ arrows
- [ ] Date editor opens via clicking the dates strip
- [ ] "+ Add destination" form works
- [ ] Reverse trip order button works
- [ ] Trip map renders with all expected pins (3 shape kinds)
- [ ] Picker can be re-opened from the trip view
- [ ] No `[Max]` console warnings during normal use (other than the filtered known-noise patterns: `fetchRegionEntryPoints`, `No API key`, `MaxSync`, `scheduleSave`)

---

## Known follow-ups (not in scope today)

- Dedicated "Along the way" section in the picker (aggregates wayside-fit candidates instead of requiring popover-per-candidate)
- AutoSave reassurance for new users ("Your work is being kept")
- Wayside generation progress UI (callback exists; surface is minimal)
- Sign-in celebratory moment ("Connected · trips synced")
- Cross-trip lineage (#111) — the wisp inheritance from the philosophy modal isn't actually built yet

Report anything failing against this plan and I'll iterate.
