# Remaining test plan (Round FN/FN.5) — what's left after your Section 1+2 pass

Section 1 ✅ all clear. Section 2 ✅ all clear except 2.5 (1-night-shrink
silent failure — now fixed in FN.5).

What's left: re-run 2.5, then Sections 3 and 4.

---

## SETUP (1 min)

1. **Hard-reload** (Cmd+Shift+R) to pick up max-v184.
2. Confirm DevTools → Network → **Disable cache** is still checked.
3. You should still be on your existing trip. If not, rebuild it the same
   way as before.

---

## SECTION 2 — RE-RUN 2.5 ONLY

### Test 2.5 — Edit dates with active hotel booking
**Target: any destination with at least 2 nights** (1-night dests can't be
shrunk further — FN.5 now alerts you about that. If you want to verify the
new alert, try shrinking a 1-night dest first; you should see "A destination
needs at least one night..." pop up.)

DO (setup):
1. Open D's detail → Stay tab → book the first hotel with conf `H2-TEST`,
   fill all fields including URL `https://example.com/h2`. Set a
   cancellation policy (date + time `18:00`) — that gives you data for
   Test 4.4 later.
2. Return to trip view.

DO (edit):
3. On D's card, click **Edit dates**.
4. Change the "to" date to 1 day earlier (the booking's checkout now falls
   outside D's window).
5. Click **Save**.

VERIFY:
- [ ] Confirmation dialog explicitly warns that the hotel booking dates
      are now outside D's stay window
- [ ] Confirming generates a "Provider action needed" entry on the
      Tracking tab (open any dest's Tracking → Coming up → Provider action
      needed)
- [ ] Tracking tab shows red badge with the count (FN.3 fix)
- [ ] D's dates updated correctly
- [ ] No errors in console

**RESULT: ___**

---

## SECTION 3 — LOGISTICS FORM (10 min)

The form auto-saves on input — there's no Save button. Click outside the
form to commit, then verify. The form has no date fields; date is implied
by the destination's calendar position.

### Test 3.1 — Persist after reload
**Target: A (the arrival destination)**

DO:
1. On A's card, click the **Logistics** affordance.
2. Click the **✈️ Fly** mode pill.
3. Carrier: `KLM`
4. Flight number: `KL1234`
5. Arrives at: `12:00`
6. Confirmation #: `KL-CONF-001`
7. Notes: `gate D14`
8. Booking URL: `https://klm.com/test`
9. Click outside to commit.
10. **Reload the page** (Cmd+R).

VERIFY:
- [ ] After reload, A's card logistics line shows the carrier, flight
      number, time, and a `↗ booking` link
- [ ] All fields you entered are preserved
- [ ] No errors in console

**RESULT: ___**

---

### Test 3.2 — URL displayed in two places (FL fix)
**Target: A (relies on 3.1 having succeeded)**

DO:
1. Look at A's card on the trip view.
2. Click A to open detail → **Itinerary** tab.

VERIFY:
- [ ] Trip view destination card shows `↗ booking` link on logistics line
- [ ] Itinerary tab's auto-injected arrival chip ALSO shows a booking link
- [ ] Clicking either opens `https://klm.com/test` in a new tab

**RESULT: ___**

---

### Test 3.3 — Mode switch (label updates after FN.4)
**Target: A**

DO:
1. Reopen A's logistics form.
2. Click the **🚂 Train** mode pill.

VERIFY:
- [ ] The "Flight number" label switches to "Train number"
- [ ] The placeholder example updates (e.g. `IC 524, ICE 71`)
- [ ] Carrier, conf, time, URL stay populated
- [ ] Mode chip on A's card switches from ✈ to 🚂 after you click outside
- [ ] No errors in console

**RESULT: ___**

(Optional: cycle through 🚌 Bus, ⛴ Boat, 🚗 Drive — labels should adapt to
"Route / bus #", "Vessel / route", "Vehicle / plate".)

---

### Test 3.4 — Confirmation field round-trip
**Target: A**

DO:
1. Reopen A's logistics form.
2. Confirmation # should still have your earlier value.
3. Change it to `TEST-EDITED`. Click outside to commit.
4. Reload.

VERIFY:
- [ ] After reload, conf shows `TEST-EDITED` on A's card
- [ ] No errors

**RESULT: ___**

---

### Test 3.5 — Time format (24h)
**Target: E (departure)**

DO:
1. Open E's logistics form.
2. Click the **✈️ Fly** mode pill.
3. Carrier: `Lufthansa`
4. Flight number: `LH 1100`
5. Departs at: `23:45`
6. Click outside to commit.
7. Reload.

VERIFY:
- [ ] Time renders as `23:45` (24-hour) on E's card
- [ ] No errors

**RESULT: ___**

---

### Test 3.6 — Long notes
**Target: E**

DO:
1. Reopen E's logistics form.
2. Notes: `Gate B22, terminal 3, leave hotel by 4am, two-hour security buffer`
3. Click outside to commit.

VERIFY:
- [ ] Notes appear on E's card logistics line (likely truncated)
- [ ] Hovering shows full text via title attribute, OR the line wraps
- [ ] No errors

**RESULT: ___**

---

## SECTION 4 — SPOT CHECKS (5 min)

### Test 4.1 — Logistics consistency picker ↔ trip view
DO:
1. Click **Edit destinations** to reopen the picker.
2. Verify entry/exit logistics shown match what you set on A and E in
   the trip view.
3. Click **Choreograph my trip** without changes.

VERIFY:
- [ ] Logistics carry through unchanged
- [ ] No duplicate or stale fields

**RESULT: ___**

---

### Test 4.2 — Itinerary → Routing tab nav
DO:
1. On any destination's **Itinerary** tab, click a transport chip
   (e.g. "by train to next destination").

VERIFY:
- [ ] Auto-jumps to that destination's **Routing** tab
- [ ] No errors

**RESULT: ___**

---

### Test 4.3 — Day-trip chip hover/tap
DO:
1. On a hub destination that has day-trip chips, hover one.

VERIFY:
- [ ] Tooltip or visible hint explains the chip is a day trip
- [ ] Clicking opens the day-trip's view
- [ ] No errors

**RESULT: ___**

---

### Test 4.4 — Tracking tab structure (Coming up / Trip diary, badge from FN.3)
DO:
1. Open any destination's **Tracking…** tab.

VERIFY:
- [ ] **Coming up** section at top
- [ ] **Trip diary** section at bottom (may be empty)
- [ ] Per-list add inputs for Want to see, etc.
- [ ] If you have a hotel with a cancellation deadline (from 2.5),
      it shows in **Cancellation deadlines** with both date AND time
- [ ] If pending actions exist, the Tracking… tab itself shows a red
      badge with the count, and the tab label is red (visible from
      any other tab)
- [ ] No errors

**RESULT: ___**

---

## Result reporting

When done, paste back any line that's not ✅. Format:

```
2.5 ✅
3.1 ❌ — short reason
3.2 ✅
...
```
