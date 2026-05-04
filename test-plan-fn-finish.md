# Finish the test plan — what's left after the day-trip detour

Five tests left: **3.3, 3.5, 3.6, 4.2, 4.4**. Each has a tight DO/VERIFY
block. ~25 minutes.

---

## SETUP (1 min)

1. Hard-reload (Cmd+Shift+R) to pick up max-v192.
2. DevTools → Network → **Disable cache** still checked.
3. You should still be on your existing trip with arrival logistics set
   on A (KLM, KL1234, conf TEST-EDITED, etc. from 3.1/3.4). If not, just
   re-set them — the values aren't critical.

---

## CLARIFYING THE LOGISTICS FORM

Important: there is **NO per-card logistics form**. There's ONE form,
in a banner at the top of the trip view:

```
[ Trip view banner: Arriving in {first dest} | Departing from {last dest} ]
                   ↑                          ↑
                   ARRIVAL form (A)           DEPARTURE form (E)
                   left column                right column
```

To set departure logistics for E, scroll up to that banner and use the
**right column**. The form auto-saves on input — no Save button. Click
outside the field to commit.

---

## SECTION 3 — LOGISTICS FORM (remaining)

### Test 3.3 — Mode switch label updates (FN.4)
**Target: A — left column of the banner**

DO:
1. Scroll to the arrival/departure banner at the top of the trip view.
2. In the **left** (Arrival) column, the mode pill row should still
   show **🚂 Train** selected from the earlier test (or whatever you
   left it on).
3. Click **🚌 Bus** mode pill.

VERIFY:
- [ ] The "Train number" label switches to "Route / bus #"
- [ ] The placeholder example updates (e.g. `FlixBus 123`)
- [ ] All other fields (carrier, conf, time, URL) stay populated
- [ ] No errors in console

Then click back to **🚂 Train** (or whichever you want for the rest of
the tests) so A's logistics matches what you expect later.

**RESULT: ___**

---

### Test 3.5 — Time format (24h) on departure
**Target: E — right column of the banner**

DO:
1. Same banner. In the **right** (Departure) column.
2. If no mode is selected yet, click **✈️ Fly**.
3. Carrier: `Lufthansa`
4. Flight number: `LH 1100`
5. Departs at: `23:45` (just type 23:45 directly into the time input,
   or use the up arrow from the default value)
6. Click outside to commit.
7. Reload (Cmd+R).

VERIFY:
- [ ] After reload, E's destination card (the last one in the list)
      shows a Departure logistics line with `LH 1100` and the time
- [ ] Time renders correctly (24-hour or 12-hour with PM, depending on
      locale — both are fine, just noting the value persisted)
- [ ] No errors

**RESULT: ___**

(If the time picker rejects `23:45` specifically, paste back what
behavior you see — that's a separate bug worth investigating.)

---

### Test 3.6 — Long notes on departure
**Target: E — right column of the banner**

DO:
1. Reopen the banner if it's collapsed (click ▸ Add arrival/departure
   details if hidden).
2. In the **right** (Departure) column, find the Notes field.
3. Type: `Gate B22, terminal 3, leave hotel by 4am, two-hour security buffer`
4. Click outside to commit.

VERIFY:
- [ ] Notes appear on E's destination card logistics line (likely
      truncated)
- [ ] Hovering shows full text via title attribute, OR the line wraps
- [ ] No errors

**RESULT: ___**

---

## SECTION 4 — SPOT CHECKS (remaining)

### Test 4.2 — Itinerary → Routing tab nav
**Target: any destination with a transport chip on its Itinerary**

DO:
1. Open any destination's detail (click the card).
2. Click the **Itinerary** tab.
3. Find a transport chip — the auto-injected "Arrive from X" or
   "Depart to Y" chip at the top or bottom of a day. (If you're on the
   first destination, the arrival chip uses what you set in 3.1.)
4. Click the transport chip.

VERIFY:
- [ ] Auto-jumps to that destination's **Routing** tab
- [ ] Routing tab shows the matching section (Arrive from X / Depart
      to Y) for that leg
- [ ] No errors

**RESULT: ___**

(Bonus: if this destination has day-trip chips, click "→ Plan transport"
on a day-trip item in the Itinerary. Should jump to Routing tab and
show the new "Day trip · {hub} ↔ {place} (round trip)" section.)

---

### Test 4.4 — Tracking tab structure
**Target: any destination, then specifically D if you set a hotel cancellation in 2.5**

DO:
1. Open any destination's detail. Click the **Tracking…** tab.

VERIFY:
- [ ] **Coming up** section at top
- [ ] **Trip diary** section at bottom (may be empty)
- [ ] Per-list add inputs for "Want to see" (an Add button you can
      click + an input to type a sight name)
- [ ] If you have any open Provider action needed entries, the
      Tracking… tab has a red badge with the count
- [ ] If you set a cancellation deadline on a hotel (in 2.5 or
      anywhere), it shows in **Cancellation deadlines** with date AND
      time
- [ ] Each Cancellation deadline row has a **Cancel booking** action
      button next to the date (FN.6)
- [ ] No errors

DO (one quick sanity check on Want to see — clarifies how items get there):
2. Type something in the "Want to see" input, click Add.

VERIFY:
- [ ] Item appears in the Want to see list immediately
- [ ] No errors

**RESULT: ___**

---

## When done

Paste back any line that's not ✅ in the format:

```
3.3 ✅
3.5 ❌ — short reason
3.6 ✅
4.2 ✅
4.4 ✅
```

Or paste the whole file with inline results.
