# Test plan (Round FN/FN.1) — destination card mutations

What this exercises: the core mutating operations on the destination card in
the trip view — × Remove, Edit dates, Logistics. These are the execution-mode
primitives the mobile app will be built on, so they need to be solid.

The plan assumes you've created a fresh trip accepting all suggestions, so
the destination list is predictable. Tests are anchored to indexes, not place
names — so it works regardless of where you go.

---

## SETUP (5 min)

1. Open a fresh tab at `http://localhost:8000/`.
2. **Hard-reload** (Cmd+Shift+R). DevTools → Network → ensure **Disable cache**
   is checked.
3. **Open DevTools → Console.** Keep it visible.
4. **Create a fresh trip:**
   - From home, click **+ New trip**.
   - Sentence: `I want to spend two weeks in Switzerland in July` (or whatever
     destination you prefer — Switzerland gives a predictable structure).
   - Click through every step accepting defaults. Don't add custom anchors,
     don't toggle activity chips off, don't override anything.
   - On the picker, click **Choreograph my trip** without modifying the
     suggested destinations.
   - Wait for the build.
5. **Capture baseline.** Paste in the Console:
   ```javascript
   trip.destinations.forEach((d,i) => console.log(i, d.place, "nights="+d.nights, d.dateFrom+"→"+d.dateTo));
   ```

   **BASELINE (paste output here):**
   ```
   ___
   ```

6. **Define five reference destinations.** Pick these from your baseline,
   then write down the index (0, 1, 2…) and the place name. The tests below
   refer to them by letter (A, B, C, D, E).

   | Label | Which destination | Index | Place |
   |-------|-------------------|-------|-------|
   | A | the very first (arrival) | 0 | ___ |
   | B | the second one | 1 | ___ |
   | C | one near the middle of the list | ___ | ___ |
   | D | the second-to-last one | ___ | ___ |
   | E | the very last one (departure) | ___ | ___ |

   Example, for a 15-destination trip: C ≈ index 7, D = index 13, E = index 14.
   For a 6-destination trip: C ≈ index 3, D = index 4, E = index 5.

   For each section below, "Target: C" means "do this on the destination
   you wrote down as C."

---

## SECTION 1 — × REMOVE (10 min)

### Test 1.1 — Basic remove, no bookings
**Target: B**

DO:
1. In trip view, find B's card.
2. Click **× Remove** on its card.
3. Confirm dialog → click **OK**.

VERIFY:
- [ ] B's card disappears immediately
- [ ] Total trip nights drops by B's nights count
- [ ] Dates strip end date moves earlier
- [ ] Run baseline command again — every destination after B has `dateFrom`
      shifted earlier by B's nights count, no calendar gap
- [ ] No errors in console

**RESULT: ___**

---

### Test 1.2 — Remove with bookings (cascade)
**Target: C**

DO (setup, ~3 min):
1. Click C's card to open destination detail.
2. Click the **Stay** tab.
3. On the first hotel suggestion, click **Book**. Fill in:
   - Confirmation #: `H-TEST`
   - Total paid: `200`, Currency: `EUR`
   - Notes: `cascade test`
   - Reservation URL: `https://example.com/h-test`
   - Cancellation policy: click **Cancel by date**, set date = 2 days before
     C's dateFrom, time `18:00`
   - Click **Save booking**.
4. Click the **Tracking…** tab.
5. Scroll to **Activities & other** subsection. Click **+ Book**.
6. Fill in:
   - Label: `Test activity`
   - Date: pick any date in C's range
   - Confirmation #: `A-TEST`
   - Price: `50`, EUR
   - Click **Save booking**.
7. Click the **Trip** mode button at the top to return to trip view.

DO (remove):
8. On C's card, click **× Remove** → **OK**.

VERIFY:
- [ ] C's card disappears
- [ ] Open D's detail → click **Tracking…** tab
- [ ] **Provider action needed** section appears with **two** entries:
      - [ ] "Contact provider to adjust or cancel — Hotel" with hotel name and `H-TEST`
      - [ ] "Contact provider to adjust or cancel — Booking" with `Test activity` and `A-TEST`
- [ ] No errors in console

**RESULT: ___**

---

### Test 1.3 — Remove first destination (arrival)
**Target: A (now index 0 — was the trip's arrival before tests 1.1 and 1.2)**

DO:
1. On the destination at index 0, click **× Remove** → **OK**.

VERIFY:
- [ ] Index 0 destination disappears
- [ ] What was at index 1 is now at index 0
- [ ] That destination shows **✈ Arrival** tag at the top of its card
      (it didn't before)
- [ ] All remaining dests' `dateFrom` shifted earlier by removed dest's nights
- [ ] No errors in console

**RESULT: ___**

---

### Test 1.4 — Remove last destination (departure)
**Target: index length−1 (whatever the current last is)**

DO:
1. Click **× Remove** on the last card → **OK**.

VERIFY:
- [ ] Last destination disappears
- [ ] New last destination shows **✈ Departure** tag
- [ ] Dates strip end date moves earlier
- [ ] If a buffer-night banner was visible, it re-evaluates correctly
      (might disappear if no buffer needed; might stay if still applicable)
- [ ] No errors in console

**RESULT: ___**

---

### Test 1.5 — Remove all destinations
DO:
1. Keep clicking **× Remove** + **OK** on the top card until the list is empty.

VERIFY:
- [ ] List becomes empty
- [ ] Trip view shows a sensible empty state (no destination cards)
- [ ] In console, `trip.destinations.length` is 0
- [ ] No errors

**RESULT: ___**

---

After 1.5 your test trip is gone. **Reload the page**, accept any "abandon
this trip" prompts, then **rebuild a fresh trip** with the same setup as
before for Section 2.

---

## SECTION 2 — EDIT DATES (10 min)

Rebuild your trip if you nuked it in 1.5. Re-capture the baseline:

```
BASELINE 2:
___
```

Re-fill the table:

| Label | Which destination | Index | Place |
|-------|-------------------|-------|-------|
| A | the very first | 0 | ___ |
| C | one near the middle | ___ | ___ |
| D | the second-to-last | ___ | ___ |

---

### Test 2.1 — Idempotent save
**Target: C**

DO:
1. On C's card, click **Edit dates**.
2. The date inputs appear with current values. Click **Save** without
   changing anything.

VERIFY:
- [ ] Dates display unchanged
- [ ] No errors in console
- [ ] No "are you sure" dialog

**RESULT: ___**

---

### Test 2.2 — Shrink C by 1 night
**Target: C**

DO:
1. On C's card, click **Edit dates**.
2. Change the "to" date to 1 day earlier.
3. Click **Save**.

VERIFY:
- [ ] C's nights count drops by 1
- [ ] All destinations after C shift their `dateFrom` 1 day earlier
- [ ] Trip total nights drops by 1
- [ ] No errors in console

**RESULT: ___**

---

### Test 2.3 — Forward overlap (extend C past next dest)
**Target: C**

DO:
1. On C's card, click **Edit dates**.
2. Change the "to" date to extend 2 days past the next destination's
   `dateFrom`.
3. Click **Save**.

VERIFY:
- [ ] A confirmation dialog warns about overlap with the next destination
- [ ] Confirming shifts the next destination later AND propagates the shift
      to all subsequent destinations
- [ ] Trip total nights goes up by 2
- [ ] No errors in console

**RESULT: ___**

---

### Test 2.4 — ⚠ CRITICAL: Backward overlap (extend C earlier than prev dest)
**Target: C**

DO:
1. On C's card, click **Edit dates**.
2. Change the "from" date to 2 days earlier than C's previous destination's
   `dateTo`.
3. Click **Save**.

VERIFY:
- [ ] A confirmation dialog warns about backward overlap with the previous
      destination
- [ ] Confirming applies the change without silent data corruption
- [ ] In console, run `trip.destinations.forEach((d,i)=>console.log(i,d.place,d.dateFrom,d.dateTo))` —
      no destination has `dateTo > nextDest.dateFrom`
- [ ] No errors in console

**RESULT: ___**

---

### Test 2.5 — Edit dates with active hotel booking
**Target: D**

DO (setup):
1. Open D's detail → Stay tab → book the first hotel with conf `H2-TEST`,
   fill all fields including URL `https://example.com/h2`.
2. Return to trip view.

DO (edit):
3. On D's card, click **Edit dates**.
4. Change the "to" date to 1 day earlier (which makes the hotel's checkout
   fall outside D's window).
5. Click **Save**.

VERIFY:
- [ ] Confirmation dialog explicitly warns that the hotel booking dates are
      now outside D's stay window
- [ ] Confirming generates a "Provider action needed" entry on the
      Tracking tab (open any dest's Tracking → Coming up → Provider action
      needed)
- [ ] D's dates updated correctly
- [ ] No errors in console

**RESULT: ___**

---

### Test 2.6 — Cancel mid-edit
**Target: any destination, your pick**

DO:
1. Click **Edit dates** on any card.
2. Change a date.
3. Click **Cancel** instead of Save.

VERIFY:
- [ ] Dates revert to pre-edit values
- [ ] No data changes
- [ ] No errors in console

**RESULT: ___**

---

## SECTION 3 — LOGISTICS FORM (10 min)

### Test 3.1 — Persist after reload
**Target: A (the arrival destination)**

Note: the logistics form has no date inputs — the date is implied (arrival
day = A's `dateFrom`, departure day = E's `dateTo`). The form captures
mode, carrier, number, time, conf, notes, URL.

DO:
1. On A's card, click the **Logistics** affordance (button or row).
2. Click the **✈️ Fly** mode pill.
3. Carrier: `KLM`
4. Flight number: `KL1234`
5. Arrives at: `12:00`
6. Confirmation #: `KL-CONF-001`
7. Notes: `gate D14`
8. Booking URL: `https://klm.com/test`
9. The form auto-saves on input — there's no Save button. Click anywhere
   outside the form to commit.
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

### Test 3.3 — Mode switch preserves data
**Target: A**

DO:
1. Reopen A's logistics form.
2. Change mode from **Flight** to **Train**.
3. Check the form: operator, conf, dates, times, URL should still be in
   the inputs.
4. Save.

VERIFY:
- [ ] Mode chip on A's card switches from ✈ to 🚂
- [ ] All other fields preserved
- [ ] No errors in console

**RESULT: ___**

---

### Test 3.4 — Confirmation field round-trip
**Target: A**

DO:
1. Reopen A's logistics form.
2. The "Conf #" field should still have `KL1234`.
3. Change it to `TEST-EDITED`. Save.
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
6. Click outside to save.
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
3. Click outside to save.

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

### Test 4.4 — Tracking tab structure
DO:
1. Open any destination's **Tracking…** tab.

VERIFY:
- [ ] **Coming up** section at top
- [ ] **Trip diary** section at bottom (may be empty)
- [ ] Per-list add inputs for Want to see, etc.
- [ ] If you have a hotel with a cancellation deadline (from 1.2 or 2.5),
      it shows in **Cancellation deadlines** with date AND time
- [ ] No errors

**RESULT: ___**

---

## Result reporting

When done, paste back any line that's not ✅. Format:

```
1.1 ✅
1.2 ❌ — provider action needed didn't appear
1.3 ✅
2.4 ⚠️ — partial: dialog showed but did not propagate shift
...
```

Or paste the whole file with your inline result fields filled in. Either
works.

---

## What's been fixed since the last test plan (FL → FN/FN.1)

- × Remove now redraws the trip view (was no-op visually)
- × Remove recomputes dates of surviving destinations (no calendar gap)
- × Remove re-evaluates the over-budget banner
- Hotel records on the Tracker now lead with the hotel name
- Cancelled hotels can be re-booked (Book button reappears)
- Edit hotel form now includes cancellation policy (was missing)
- Cancellation deadline now captures + displays time, not just date
- Transport records now have an Edit button (was Cancel + Delete only)
- "Add to day" on restaurant suggestions no longer crashes (FM)

Round FL.1 (× Remove confirm() → undo-toast) is queued — will ship after
this round of testing settles.
