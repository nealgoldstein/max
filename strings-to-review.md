# UI Strings — review and mark up

Mark each line you want to change with the new text below it, like:

    Original: "Edit destinations"
    Changed:  "Change destinations"

Or strike through if you want to delete it. Send back the marked-up file
and I'll do all the find-replace in one round.

Skipping LLM prompt content — those are paragraphs of structured
instruction; we'll edit those separately if you want a voice pass on
how Max talks.

---

## Home screen

- "Name this trip"
- "Start your first trip"
- "Pick up where you left off"
  - sub: "Continue working on one of your trips"
- "Start something new"
  - sub: "A trip that is still a sentence in your head"
- "Browse"
  - sub: "I'm not planning yet, just looking at where I might go"
- "Untitled trip"
- "No destinations yet."
- "What do you want to do today?"
- "Not planning yet? That's fine. Tell me what you're in the mood for — a feeling, a climate, a kind of place. Even something vague. I'll take it from there."
- "Max is thinking…"
- "(Max couldn't respond just now. Try again in a moment.)"
- "✓ API key saved"
- "T-3 days" / "Today!" / "In progress · day N" / "Past"  *(countdown chip — leave alone unless you want different copy)*

## Brief / new trip flow

- "Where do you want to go?"
- "A city, country, region, national park — anywhere Max can map out. Next we'll cover the trip's shape (dates, party, pace) so the activities Max suggests fit your time window."
- placeholder: "e.g. Kyoto, the Scottish Highlands, Oaxaca"
- placeholder: "e.g. first time there, traveling with parents, want to avoid the obvious tourist stuff"
- "Travel details →"
- "Type a place above to continue."
- "← Back"
- "🔑 Set API key"
- "Tell Max where you want to go."
- "Step 1 of 3" / "Step 2 of 3" / "Step 3 of 3"

## Picker (activity ↔ place table)

- "Step 3 of 3" / "Editing your trip"
- "Pick what you actually want to do" / "Edit your picks"
- "What you can do in [Place]"
- "Tap what you actually want to do. Anything you leave unchecked won't shape the trip. Add your own below."
- "+ Add a place"
  - placeholder: "A city/town not in the list"
  - button: "+ Add place"
- "+ Add an experience"
  - placeholder: "What you want to do"
  - placeholder: "Where (e.g. Zürich, Geneva)"
  - button: "+ Add"
- "Other places worth considering" *(breadth-discovery panel)*
  - "Cities or towns Max thinks fit your trip but aren't tied to anything you've picked above. Optional."
  - button: "Discover more places →"
  - "Max is finding more places…"
  - "↻ Get different suggestions"
  - "+ Add" / "✓ Added"
- "Arrival / Departure — optional, but at some point you'll need to set (or change) it on the trip page"
  - label: "Arriving at"
  - label: "Departing from"
  - placeholder: "e.g. Zurich"
  - "Buffer night in your departure city before flying home"
  - "(default — uncheck to fly directly from your last destination)"
- "▸ Add arrival/departure details" / "▿ Hide arrival/departure details"
- form labels: "Arrival" / "Departure" / "Carrier" / "Number" / "Arrives at" / "Departs at" / "Confirmation #" / "Notes"
- placeholders: "e.g. Lufthansa, SBB" / "e.g. LH 730, IC 524, route" / "optional" / "optional, e.g. terminal, seat"
- "Saved as you type. You can edit these later on the trip page."
- mode pills: "Fly" / "Train" / "Drive" / "Bus" / "Boat"
- "+ more like this" *(per section)*
- "+ try again"
- transit chip: "⚠ transit"
  - tooltip: "This stop is typically a transit point (cable-car summit, train terminus). You can still pick it, but most travelers don't stay overnight here."
- info button: "?"
  - tooltip: "What is this place?"
- popup section: "What to do here"
- "Build trip →"
- "Add arrival and departure to build →" / "Add arrival city to build →" / "Add departure city to build →"  *(only shown if you re-gate the build button — currently optional)*
- "Save changes →"  *(when editing an existing trip's picks)*
- "← Cancel" / "← Back to travel details"
- "Pick at least one thing you want to do — and the place(s) you'd do it. That's the trip."

## Trip view (left panel)

- "Destinations"
- "[N] days · [N] nights · [N] destinations"
- "No destinations yet."
- "✎ Edit destinations"
  - tooltip: "Re-open the picker with your current keep/reject decisions"
- "+ Destination"
- "Arrival / Departure" *(uppercase header on the panel)*
- "⚠ Set arrival and departure to lock in the calendar"
- mode pills: "Fly" / "Train" / "Drive" / "Bus" / "Boat"
- "Apply"
- "Already rebuilding…" / "Rebuilding…" / "No change."
- "Couldn't rebuild: …"
- "Buffer night in your departure city before flying home"
- "▸ Add arrival/departure details" / "▿ Hide arrival/departure details"
- destination card tags:
  - "✈ Arrival into [city]"
  - "✈ Departure from [city]"
  - "✈ Arrival · Departure"  *(when single-destination trip)*
- "ARRIVAL" / "DEPARTURE" *(detail page banners)*
  - "Lands [HH:MM]" / "Arrives [HH:MM]" / "Departs [HH:MM]" *(verb depends on transport mode)*
  - "into [city]" / "from [city]"
- day-trip chips: "📍 [Place]"
  - tooltip: "[Place] · [N]km from [hub] · click to ungroup"
  - section header: "Day trips:" / "📍 Day trips from [hub]"
- restoration confirm: 'Restore "[Place]" as its own destination?\n\nIt'll be inserted right after [hub] with [N] night(s). Other destinations' dates will shift forward.'

## Destination detail page

- back button: "← Destinations"
- "+ Destination"
- tabs: "Itinerary" / "Explore" / "Stay" / "Eat" *(tab labels — verify in app, may differ)*
- "Stay" sub-pane: "Booked", lodging chips
- "Eat" sub-pane: restaurant suggestions
- story button: "story: [Place] ↗" / "story: [Place] ✓"
  - "Dig deeper ↗"
  - "Hide"
- "Max is generating data…"
- "⌛ Max is generating suggestions for [Place] — see the Explore tab once ready."
- "→ Go to the Explore tab to browse sights and restaurants, then add them to your days."
- "Day" / "Evening" *(per-day slots)*
- "Add a sight…" *(input placeholder)*
- "Suggest restaurants" *(button)*
- "Sight or activity…" *(placeholder)*
- "Restaurant or evening activity" *(placeholder)*
- arrival/departure transit chips: "Arrival" / "Flight home" / "Departure"
- "Add details on the trip page" *(empty state in flight chip)*
- day-trip menu options:
  - "Add to Day [N] ([date])"
  - "✓ On Day [N] ([date])"
  - "Remove from itinerary (keep as day-trip option)"
  - "Restore as own destination"
- empty state: "No arrival/departure details added yet. Add them →"
- empty state for first/last destination logistics card: "📍 Day trips from [hub]"

## Hero map (top of trip view)

- "🗺 View larger →"
- new-window title: "[Trip name] — route"
- new-window subtitle: "[N] destinations"

## Picker info popup

- header: place name only
- close button: "×"
- loading: "Max is writing about [Place]…"
- error: "Max couldn't generate a description right now."
- section: "What to do here"

## Booking forms (Stay/Eat tab)

- "Book" / "Close"
- "Save booking" / "Cancel"
- "Save changes" / "Edit" / "Close"
- "Cancel booking" / "✕ Delete"
- "✓ Booked · [date]"
- "Cancel by: [date]" / "Non-cancellable"

## Status / toast messages

- "Adding…"
- "+ Add"
- "Looking up…"
- "Couldn't add: [error]"
- "Added [Place]"
- "+ Add place"
- "thinking…"
- "+ try again"
- "+ more like this"
- "Plan" / "Execute"
- "🗺 Map"
- "+ Add destination"

## Errors / API key

- "API key required — enter your Anthropic API key in the form above."
- "No API key — click Settings to add your key"
- "API timeout"
- "✓ Shared review key loaded.\nDon't share this URL — it had a key in it. The key is now in your browser only."

---

## How to mark this up

Edit the lines you want to change. For each, write the new version below
the original. Or use a simple notation:

    Edit destinations  →  Change destinations
    Build trip →  →  Plan the trip →
    "Pick up where you left off"  →  "Continue an existing trip"

Send the file back when done. I'll do all the find-replace in one round.
