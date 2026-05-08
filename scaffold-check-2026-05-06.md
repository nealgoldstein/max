# SCAFFOLD UI verification — May 6, 2026 (scheduled run)

**Caveat up front:** this is a code-review verification, not a visual one. The
scheduled run has no browser session and no access to your localStorage, so I
can't confirm what's actually rendering on your screen with the trip you seeded
yesterday. What I *can* confirm is that each surface is wired up in the source.
If something looks off when you actually open the trip view, that's a runtime/
data issue (likely the seed trip), not a missing implementation.

## 1. Today banner (v300) — wired correctly

`_renderTodayBanner` in `trip-ui.js:770`. Renders only when
`currentTripStatus(trip).phase === "during"`. Markup matches the spec:

- Top line: `📍 You're on day {n} of {total}` (uppercase, blue)
- Bottom line: `In {place} · {dayLbl} · {N} days left after today` (or
  `last day of the trip`, or `Between destinations` if no current dest)
- Right side: `Today's plan →` button, blue, click → `selectDest` + scroll
  to `dy-{dayId}` with amber pulse

Container injection happens in the trip-overview coordinator at line 1032,
above pre-arrival. Should be the topmost colored strip on the trip view.

## 2. Now/Next widget (v303) — wired correctly

Two pieces:

- `_buildNowNextWidgetHtml` at `index.html:22266` — produces the HTML from
  `currentDayItems(day)` output.
- Insertion point in `MaxTripUI.renderDay` at `trip-ui.js:688` — drops the
  HTML between the day header (`hdr`) and items list (`list`).

The widget gates on `status.phase === "during" && status.currentDayId === day.id`
(index.html:22246), so it only appears on today's day card. Lines emitted, in
order:

- `RIGHT NOW · {name} · {N} min left` (or `Hh Mm left`)
- `NEXT · {name} at {time} · in {duration}`
- `LATER TODAY · A, B, C`
- `All scheduled items today are done.` — only when there's no current/next
  but past items exist
- `{N} untimed items on today — see list below.` — when untimed coexist
  with timed

Will only show meaningful content if items have `timeStart`/`timeEnd` set.
If you didn't add times to today's items, expect the widget to render only
the untimed-summary line or nothing at all. To exercise it: open today's
day card, click `+ add time` on two or three items, and refresh.

## 3. Item-level time states (v304) — wired correctly

The map is built in `index.html:22249-22253` using `currentDayItems(day)`'s
past/current/next/later arrays, keyed by item id, only on today's day. Map
is passed through `opts.itemTimeStates` to `renderItinItemFull`
(`trip-ui.js:146`), which adds a `time-{state}` class to the row.

CSS lives in `index.html:570-575`:

- `.srow.time-past` → `opacity:0.5` + `.sname` line-through, color #999
- `.srow.time-current` → light blue background, 3px blue left border, name
  bold + dark blue
- `.srow.time-next` → very light blue background, `→` prefix on name
- later → no class, normal styling

Implementation goes slightly beyond what the task description listed:
current and next-up also get a soft background tint, not just the border/
prefix. Read as polish, not a bug.

Other days do not get the map (gated on `status.currentDayId === day.id`),
so they should render without time-state classes — confirmed.

## 4. Pre-arrival banner (v304) — wired correctly, with one scope difference

`_renderPreArrivalBanner` in `trip-ui.js:827`. Gates: 'before' phase,
`daysUntilStart <= 21`, at least one item. Won't fire today since the trip
already started. To see it: edit the trip to start in 5 days.

**Scope discrepancy worth flagging.** The task description says pre-arrival
shows up to N click-through lines including:

- `No hotel booked for X` ✓ (`item.kind === "hotelMissing"`)
- `Transit not booked: A → B` ✓ (`item.kind === "transitMissing"`)
- `Day N in X has no plan yet` — **no longer in pre-arrival**

Per `sw.js:118`: *"preArrivalActions() no longer returns emptyDay items.
Those are CONTENT decisions (what to do that day) and belong in
summarizeDecisionsDeferred (the SCAFFOLD-3 panel). Pre-arrival is now
purely LOGISTICS: hotels, transit."*

So empty-day items moved into the decisions-deferred chip and the two
surfaces no longer overlap. Either the task description is stale, or this
move was intentional and the description didn't get updated. Worth
double-checking that's the model you want.

Also: header copy is now `📅 {when} — {N} bookings & logistics to firm up`
(or `1 thing to firm up`), and is collapsible with localStorage-persisted
expand state under `max-prearrival-expanded`. Reads cleaner than the older
chip wording.

## 5. Decisions-deferred chip (v296) — wired correctly, copy diverges

`_renderDecisionsDeferredPanel` in `trip-ui.js:906`. The chip copy in code
is:

> 🔧 **N** suggestions to review (keep, edit, or skip)

Task description expected:

> 🔧 N things to decide ▸

If the new copy is intentional, ignore. If it drifted, it's a one-line edit
at `trip-ui.js:938`.

The `(still gathering…)` indicator is in place (line 939), appended when
any destination has `_generatedCityData[place].loading === true` or no
suggestions yet. That part matches.

Items rendered: `tentative` (placeholders needing yes/no) and `emptyDay`
(`{dayLbl} in {destPlace} — nothing planned yet`). The latter is what
moved over from pre-arrival.

## Summary

All five surfaces are present in the source and wired into the trip-overview
coordinator in canonical order: dates → today banner → pre-arrival → decisions-
deferred → FQ geo banner. The only things to look at:

1. **Verify on screen** — open the trip view, see whether the today banner,
   now/next widget, and item time states render as expected. The widget and
   item states need timed items to show anything interesting.
2. **Decide on the pre-arrival vs. decisions-deferred split** — empty-day
   items moved out of pre-arrival into decisions-deferred. Confirm that's
   still the intended model; if so, the SCAFFOLD-4 description in your task
   reminder is out of date.
3. **Decisions-deferred copy** — current text reads `N suggestions to
   review (keep, edit, or skip)`, not `N things to decide ▸`. Pick whichever
   wording you want to keep.

## Architectural cleanup

Did not touch design-notes items 12–16. The task framed it as something
already underway needing a check-in, not a fresh start, and the item list
wasn't included in the run prompt. When you're back, point me at the
specific item to pick up and I'll continue.
