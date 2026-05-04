# Max — current state & target architecture
> **Update (gallery-v1):** See also `design-notes.md` for the gallery-first template direction,
> which supersedes parts of the "Target architecture" section below. Some items in "Known gaps"
> have shipped since this was written (pick-any-two for dates, Who's traveling, Avoidances).
> This document is preserved as the best single-page onboarding to the codebase's data
> structures, working rules, and original intent.

> **Update (May 2026, post-HX series):** the engine/UI split from
> `architecture-engine-ui-split.md` is partly shipped — Phases 0, 1, 3
> done; Phase 2 in progress; Phase 4 (mobile) not started.
> **Open `path-to-10.md` first** when picking the codebase up after a
> break. That file has the action plan for the remaining architecture
> work, with concrete first-round names for each item, plus a
> definition of "done" so we don't drift.

Single-file HTML travel-planning web app. Everything lives in `index.html`. Deploys to GitHub Pages at `nealgoldstein.github.io/max`. Open the file directly in a browser to test locally.

## What's already built

**Entry flow (the "Why & Where" brief)**
- A sentence: *"Because I want to ___, I'm going to ___."* Scarcity framing — the left blank is something you can't do (or can't do as well) where you live.
- Persistent chips: activities and preferences that define who the traveler is regardless of destination. Separate from the sentence, which is trip-specific.
- Custom chip input lets the user add anything Max didn't pre-populate.
- Step 2 collects additional constraints: region, when, duration, pace, accommodation, compromises, hard limits, how-you-travel.

**Must-dos (`_mdcItems`)**
- Four types: `route` (e.g., specific train), `condition` (e.g., see Northern Lights — condition-dependent), `activity`, `manual`.
- Each has `requiredPlaces` / `endpoints` / `viableLocations` that force certain places onto the trip.
- Currently merged into the same loading pass as the candidate generator (no separate confirmation step).

**Places page (the Candidate Explorer, `renderCandidateCards`)**
- The heart of the app. Shows generated candidates with keep / reject.
- Four lens modes: Activity, Region, Trip order (time lens — default), Status.
- Time lens renders as a draft itinerary: travel legs between stops, day-numbered headers when dates are set, arrival/departure flight info as legs at the endpoints.
- Map on the right with candidate pins; rejected ones are greyed out (darker grey, dashed border).
- Rejected section collapses at the bottom; one click to revisit.
- Smarter cascade on rejection of a required place — warns what it's required for, offers to keep or remove the upstream must-do.
- Inline "Trip details" strip (replaces the old pre-build modal): entry/exit cities, dates, flight numbers, autosave on blur.

**Close is the exit (no more "Build trip" ceremony)**
- Closing the Places overlay silently materializes the trip. No modal in between.
- Trip is always treated as definite but always fluid — keep/reject any time, details editable any time.

**Trip view (`drawTripMode`) — legacy**
- Still exists and is still reachable after first close. Shows day-by-day destinations, map, bookings, per-destination city data.
- Target is to fold this into the Places page so there's one surface. Not done yet.

**Pre-build modal (`showPreBuildModal`) — retired but not deleted**
- Function still present but unreachable from the default flow. Inline Trip Details strip replaces it.

## Key data structures

- `_tb` — trip-brief scratch space. Holds in-flight user inputs (sentence, chips, region, when, duration, pace, entry/exit, arrival/departure info, candidates, requiredPlaces, etc.).
- `trip` — the materialized trip object once built. Holds `destinations`, `legs`, `brief`, `mdcItems`, `candidates` snapshot, `requiredPlaces`.
- `_mdcItems` — must-dos. See types above.
- `_tb.candidates` — candidate list with `status` ("keep" / "reject" / null), `_required`, `_requiredFor`, `stayRange`, coords, etc.
- Module-level flags: `_ceMap`, `_ceBestMode`, `_ceLens` (default "time"), `_ceSectionExpanded`, `_ceCardExpanded`, `_ceEditMode`, `_paceMode`, `_tripDetailsExpanded`.

## Key functions worth knowing

- `showCandidateExplorer(cands, editMode)` — opens the Places overlay.
- `renderCandidateCards(cands)` — the main renderer for the page.
- `_renderTripDetailsStrip(kept)` — inline trip-details form.
- `closePlacesOverlay()` — the new "done planning" action. Silently builds the trip if none exists.
- `buildFromCandidates()` — materializes `trip` from `_tb.candidates`.
- `expandMustDos()` / `runCandidateSearch()` — the LLM-powered generators.
- `orderKeptCandidates(kept, mdcItems, entry, exit)` — event-aware ordering; respects route endpoints, condition viability, recovery days.
- `drawTripMode()` — the legacy trip view. ~30 call sites. Slated for removal once Places owns all its features.
- `callMax(messages, maxTokens, timeoutMs)` — the Anthropic API helper.

## Target architecture (where we're headed)

**Page 1 — Why do you want to travel?** Three modes, user picks one:
1. I know the place and what I want to do there. (The current sentence flow.)
2. I know what I want to do, but not where. Activity-first; Max generates candidate places.
3. I know the place, but not what to do there. Place-first; Max generates activities.

Must-do / can-miss is universal across all three modes.

**Page 2 — Constraints**
- B. When (season or specific date)
- C. How long (days or return date) — B + C interact; set any two, third derives.
- D. How to get in and out — two separate cities/airports, each with its own mode (fly / drive / train / public transport / won't travel). Entry and exit can differ; determines trip direction.
- E. Where to stay (priority order + where not to stay, with requirements like en suite, kitchen, etc.).
- F. Pace.
- G. Who's traveling — count and composition (solo / couple / family with kids (ages) / multi-gen / friends) + physical ability (fit / moderate / limited walking / elderly / mobility aid / other). Shapes activities, pace, accommodation.
- H. What to avoid (altitude, crowds, heat, long drives, cuisines, dietary, safety, anything else).

The sentence/scarcity frame only fits mode 1. Modes 2 and 3 need their own opening copy.

## Known gaps / unfinished work

- **One-page merge is half-done.** The ceremony (Build trip button, pre-build modal) is gone. But `drawTripMode` still exists and is reached on first close. Next: fold the trip view entirely into the Places page so there's one post-sentence surface.
- **Modes 2 and 3 aren't really built.** App optimizes hard for mode 1. Mode 3 has partial support (Place + discover); mode 2 is weakest.
- **"Who's traveling" is not asked.** New field needed (G above).
- **Avoidances beyond accommodation aren't captured.** New field needed (H above).
- **Duration/start/end interaction** is messy — pick-any-two not enforced.
- **drawTripMode cleanup** is ~30 call sites of untangling.

## Working rules

- Edit `index.html` directly. Keep it single-file.
- User commits and pushes from their terminal — the sandbox can't write to `.git`.
- Copy discussions happen inline in chat; keep proposed text tight and match the user's voice (scarcity framing, traveler-vs-tourist, "refined" not "revised," etc.).
- Read the file before making edits. A lot of state is intertwined.
