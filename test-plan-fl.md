# Manual test plan — destination card functions

**Status:** ready for execution against `max-v177`.

**Format:** every test has a **DO** list and a **VERIFY** checklist. Mark each as ✅ / ⚠ / ❌ / 🤔 as you go. Don't fix anything during testing — just observe and note.

---

## SETUP — do this once before starting

1. Open the app in your browser.
2. Open DevTools (Cmd+Opt+I) and switch to the **Console** panel. Keep it open the entire time so JS errors are visible.
3. DevTools → **Application** → **Service Workers**. Confirm controller version reads `max-v177`. If not, click "Unregister", then reload the page (Cmd+Shift+R for a hard refresh).
4. Confirm or build a test trip with these properties:
   - 4+ destinations
   - At least one **booked hotel** (any destination)
   - At least one **booked transport leg** (between two destinations)
   - At least one **booked general booking** (Activities & other — could be a tour or restaurant reservation)
   - The first destination has **logistics filled in** (Arrival carrier, number, time, confirmation, URL, notes)

If you don't have such a trip, the fastest setup is:
- Build a Zurich → Bern → Lucerne → Zermatt → Zurich round-trip
- Book any hotel in Lucerne (Stay tab → click Book on any listed hotel)
- Book a train on the Zurich → Bern leg (Routing tab → Book)
- Add a general booking on Lucerne ("Activities & other" → + Book → restaurant or tour)
- Fill the Arrival logistics form on the trip view: carrier "Lufthansa", number "LH 730", time "10:30", confirmation "ABC123", URL "https://lufthansa.com/abc123", notes "Terminal 2"

5. Note your starting state by running this in the console:

```javascript
console.log("destCount:", trip.destinations.length, "totalNights:", trip.destinations.reduce((s,d)=>s+(d.nights||0),0));
console.log("destinations:", trip.destinations.map(d => ({place: d.place, nights: d.nights, dateFrom: d.dateFrom, dateTo: d.dateTo})));
```

Save the output somewhere — you'll compare against it after destructive tests.

---

## SECTION 1 — × REMOVE

### Test 1.1 — Basic remove (no bookings)

**DO:**
1. Pick any destination that has **zero** bookings (no hotel, no transport leg booked, no general bookings).
2. Click the **× Remove** button on its card.
3. When the confirm() dialog shows "Remove {place} from this trip? This cannot be undone." — click **OK**.

**VERIFY:**
- [ ] Destination disappears from the list immediately.
- [ ] Total trip nights drops by exactly that destination's nights count.
- [ ] Dates strip at the top updates (date range shortens, day count drops).
- [ ] No JS errors in console.

**RESULT: ___**

---

### Test 1.2 — Remove with bookings (the cascade)

**DO:**
1. Pick a destination with at least one booked hotel + one general booking.
2. Note the destination name (e.g. "Lucerne") and the booking confirmation number(s).
3. Click **× Remove** → **OK**.
4. Open another destination's detail and click the **Tracking…** tab.

**VERIFY in Tracking… → Coming up → To-dos:**
- [ ] At least one entry "Contact provider to adjust or cancel — Hotel" with the hotel name + dest "Lucerne" + confirmation #.
- [ ] At least one entry "Contact provider to adjust or cancel — Booking" for the general booking, same details.
- [ ] If the destination had a transport leg, an entry "Contact provider to adjust or cancel — Transport" with operator name + confirmation #.
- [ ] No JS errors in console.

**RESULT: ___**

---

### Test 1.3 — Remove the first (arrival) destination

**DO:**
1. Click **× Remove** on the destination at index 0 (the first / arrival).
2. Click **OK**.

**VERIFY:**
- [ ] The next destination is now at index 0.
- [ ] That destination's card now shows the **✈ Arrival** tag at the top (it didn't before).
- [ ] Dates of all remaining destinations have shifted earlier by the removed destination's nights count.
- [ ] If the trip had a buffer night at the end (Buffer-night banner was visible), it's still there OR has updated correctly. Re-check via console:

```javascript
trip.destinations.forEach((d,i) => console.log(i, d.place, "nights="+d.nights, d._exitStop?"← BUFFER":""));
```

- [ ] No JS errors.

**RESULT: ___**

---

### Test 1.4 — Pending actions content + Email list

**DO (depends on having run 1.2):**
1. Open Tracking… on any destination.
2. Locate the To-dos section in the "Coming up" header.
3. Click the **✉ Email list** button at the top of the To-dos block.

**VERIFY:**
- [ ] Mailto opens (in your default email client).
- [ ] Subject contains the cancellation context.
- [ ] Body lists all the pending actions with type, name, dest, confirmation #.
- [ ] Cancel the mailto draft — go back to the app.
- [ ] Click the **circle/check** mark on one pending action.
- [ ] That action's row visually clears (strikethrough or "done" state).
- [ ] The badge count on the Tracking tab decreases by 1 (if visible).

**RESULT: ___**

---

### Test 1.5 — Edge case: remove all destinations

**DO:**
1. Remove destinations one by one until none remain. Use × Remove + OK each time.

**VERIFY:**
- [ ] Trip view falls back gracefully — shows "No destinations yet." or similar.
- [ ] Dates strip disappears or shows empty state.
- [ ] Hero map disappears (or shows empty state).
- [ ] No JS errors in console at any point.
- [ ] Refresh the page — the empty trip persists (it's still a valid trip with zero destinations).

**RESULT: ___**

**STOP HERE if you want to keep the trip for later tests.** If 1.5 left you empty, rebuild a fresh test trip before continuing.

---

## SECTION 2 — EDIT DATES

### Test 2.1 — Save with no change (idempotent)

**DO:**
1. Click **Edit dates** on any middle destination.
2. Don't change either date. Click **Save**.

**VERIFY:**
- [ ] No dialog appears.
- [ ] Edit row collapses.
- [ ] No JS errors.

**RESULT: ___**

---

### Test 2.2 — Shrink the destination

**DO:**
1. Pick a destination with no bookings, currently 3 nights.
2. Click **Edit dates**.
3. Change dateTo to be 1 day earlier (so it becomes 2 nights).
4. Click **Save**.

**VERIFY:**
- [ ] No dialog (no bookings to flag).
- [ ] Destination's nights drops from 3 to 2.
- [ ] Subsequent destinations' dateFrom and dateTo shift earlier by 1 day.
- [ ] Total trip nights drops by 1.
- [ ] Last destination's dateTo is 1 day earlier than before.

**RESULT: ___**

---

### Test 2.3 — Extend forward into next destination's slot

**DO:**
1. Pick a 2-night destination at idx 2.
2. Click **Edit dates**.
3. Extend its dateTo by 1 day so it overlaps the next destination's dateFrom.
4. Click **Save**.

**VERIFY:**
- [ ] A dialog opens, NOT a silent apply.
- [ ] Dialog shows the next destination as the overlap victim.
- [ ] Dialog lists any of next destination's bookings (hotel/transport/general) needing provider contact.
- [ ] Click **Confirm** in the dialog.
- [ ] The destination's nights extend to 3.
- [ ] The next destination is now shifted (or removed if its window is fully consumed — verify which behavior you see).
- [ ] Pending actions appear in Tracking… for the overlap victim's bookings.

**RESULT: ___**

---

### Test 2.4 — Extend backward into previous destination's slot ⚠ CRITICAL

**DO:**
1. Pick a destination at idx 2 (so there's a previous destination at idx 1).
2. Click **Edit dates**.
3. Move its dateFrom **earlier** by 1 day, so it overlaps the previous destination.
4. Click **Save**.

**VERIFY:**
- [ ] A dialog opens (NOT silent apply).
- [ ] Dialog shows the **previous** destination as the overlap victim — same treatment as 2.3 but in the opposite direction.
- [ ] Previous destination's bookings (if any) are listed.
- [ ] Click **Confirm**. Verify dates apply.

**❌ If no dialog appeared but 2.3 had one** — that's a bug (backward-overlap detection broken). Note carefully.

**RESULT: ___**

---

### Test 2.5 — Edit dates of a destination with a booked hotel

**DO:**
1. Pick a destination with a booked hotel (could be the one from setup).
2. Click **Edit dates**.
3. Change dateFrom or dateTo by any amount.
4. Click **Save**.

**VERIFY:**
- [ ] Dialog opens.
- [ ] Hotel is listed: "Hotel: {name} — Conf: {number} — contact provider to adjust or cancel."
- [ ] Click **Confirm**.
- [ ] Open Tracking… → Coming up → To-dos. The hotel cancellation pending action is there.

**RESULT: ___**

---

### Test 2.6 — Cancel mid-edit

**DO:**
1. Click **Edit dates** on any destination.
2. Change values in the date inputs.
3. Click **Cancel** (NOT Save).

**VERIFY:**
- [ ] Edit row collapses.
- [ ] Original dates restored on the card.
- [ ] No pending actions created.
- [ ] No JS errors.

**RESULT: ___**

---

## SECTION 3 — LOGISTICS FORM

### Test 3.1 — Type and persist

**DO:**
1. On the trip view (the main screen), expand the arrival/departure logistics form (click **▸ Add arrival/departure details** button).
2. On the Arrival side, type:
   - Carrier: `Lufthansa`
   - Number: `LH 730`
   - Time: `10:30`
   - Confirmation #: `ABC123XYZ-456`
   - Notes: `Terminal 2, Seat 14A`
   - Booking URL: `https://lufthansa.com/abc123`
3. **Without** clicking any save button, hard-reload (Cmd+Shift+R).

**VERIFY (after reload):**
- [ ] Logistics form is still expanded (or expandable).
- [ ] All five fields show the values you typed.
- [ ] No JS errors.

**RESULT: ___**

---

### Test 3.2 — Booking URL displays in BOTH places (post-FL)

**DO:**
1. With the URL from 3.1 set, look at the **first destination card** in the trip view (the main list).
2. Inside the destination, click **Open →** and look at the **Itinerary tab**, day 1.

**VERIFY:**
- [ ] The trip-view destination card's logistics line shows `↗ booking` as a clickable blue link, alongside carrier + time + conf + notes.
- [ ] The Itinerary day-1 chip ALSO shows `↗ booking` as a clickable blue link.
- [ ] Click each link; both should open `https://lufthansa.com/abc123` in a new tab.
- [ ] Clicking the link does NOT also open the destination detail (verify card-click doesn't fire underneath).

**❌ If the URL shows on the Itinerary chip but is missing from the trip-view card** — FL didn't take effect. Check SW version is `max-v177`.

**RESULT: ___**

---

### Test 3.3 — Mode switch keeps fields populated

**DO:**
1. With Lufthansa / LH 730 / 10:30 still in the Arrival logistics form, click the **Train** mode pill.

**VERIFY:**
- [ ] Form re-renders without collapsing.
- [ ] Carrier still shows "Lufthansa".
- [ ] Number still shows "LH 730".
- [ ] Time still shows "10:30".
- [ ] All other Arrival-side fields preserved.
- [ ] Click **Fly** mode pill again to revert.

**RESULT: ___**

---

### Test 3.4 — Confirmation field length

**DO:**
1. Type a long confirmation number with hyphens: `ABC123XYZ-456-DEF-789`.
2. Hard-reload.

**VERIFY:**
- [ ] Full string persists, no truncation.
- [ ] Displays correctly on the destination card's logistics line.

**RESULT: ___**

---

### Test 3.5 — Time format (12-hour display)

**DO:**
1. In the Arrival logistics form, set Time to `23:45` (use the time picker — should be 24-hour native).
2. Look at the first destination card in the trip view.

**VERIFY:**
- [ ] Card's logistics line shows the time as **11:45 PM** (12-hour conversion via `_fmtTime12h`).

**RESULT: ___**

---

### Test 3.6 — Notes display

**DO:**
1. With notes "Terminal 2, Seat 14A" set, look at the destination card.

**VERIFY:**
- [ ] Notes appear as a smaller secondary line below the main carrier+time+conf line.
- [ ] Hard-reload — notes still there.

**RESULT: ___**

---

## SECTION 4 — INCONSISTENCY SPOT-CHECKS

### Test 4.1 — Logistics consistency across surfaces

**DO:**
1. With logistics filled in, look at the same destination in three places:
   - Trip view destination card (logistics line, post-FL with URL)
   - Open the destination → Itinerary tab → day 1 (auto-injected chip)
   - Open the destination → Routing tab (booking form)

**VERIFY:**
- [ ] Carrier, number, time, conf, URL are visible and consistent across all three.
- [ ] The Routing tab booking form (separate from arrival/departure logistics) doesn't conflict.

**RESULT: ___**

---

### Test 4.2 — Itinerary chip → Routing tab navigation

**DO:**
1. On a destination's Itinerary tab, locate an "Arrive from {city}" chip on day 1.
2. Click the chip.

**VERIFY:**
- [ ] Tab switches to **Routing** automatically.
- [ ] You're still on the same destination.

**RESULT: ___**

---

### Test 4.3 — Day-trip chip hover (post-FC)

**DO:**
1. Open a destination that has day-trip chips (the small purple `📍 X` chips near the bottom of the card).
2. Hover over a chip.

**VERIFY:**
- [ ] On hover, the chip extends to show `↩ stay overnight` inline.
- [ ] Click the chip.
- [ ] Toast appears: "{place} is now its own destination [Undo]" — 6-second auto-dismiss.

**RESULT: ___**

---

### Test 4.4 — Tracking… tab structure (post-FJ)

**DO:**
1. Open any destination's **Tracking…** tab.

**VERIFY:**
- [ ] Header reads "Tracking…" with the ellipsis.
- [ ] Two top-level section headers visible: **COMING UP** and **TRIP DIARY**.
- [ ] Coming up contains: To-dos (if any pending), Bookings (Hotels/Transport/Activities), Want to see.
- [ ] Trip diary contains: Visited (with its own add input), Spend total (only if `trip.trackSpending` is on).
- [ ] No old "Booked / Want to see / Visited" sub-tab nav at the bottom.

**RESULT: ___**

---

## RESULT REPORTING

When done, send me your results in this format:

```
1.1 ✅
1.2 ❌ — transport pending action missing destName
1.3 ✅
2.1 ✅
2.2 ✅
2.3 ✅
2.4 ❌ — backward overlap dialog didn't fire; just applied silently
2.5 ✅
2.6 ✅
3.1 ⚠ — Notes field didn't persist (other fields did)
3.2 ✅
3.3 ✅
3.4 ✅
3.5 ✅
3.6 (see 3.1)
4.1 ✅
4.2 ✅
4.3 ✅
4.4 ✅
```

I'll triage and queue fixes in priority order. The most likely candidate regardless of findings is **Round FL.1**: replacing × Remove's `confirm()` with the optimistic-action + undo-toast pattern (matching FC). That's queued.

---

## TIME ESTIMATE

- Setup: 5 min
- Section 1 (Remove): 10 min
- Section 2 (Edit dates): 10 min
- Section 3 (Logistics): 10 min
- Section 4 (Spot-checks): 5 min
- **Total: ~40 min**

If short on time, prioritize **Section 1** and **Test 2.4** — those are the highest-risk paths for state corruption.
