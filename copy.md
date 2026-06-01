# Max — surface copy

Every user-visible string, grouped by where it appears. Edit freely. Tell me when you want changes applied and I'll push them into `index.html` / other files at the correct locations.

The deep philosophy already lives in `MAX_ABOUT_TEXT` (the "How it works" modal). This file is the **surface** — button labels, headings, microcopy. Voice should track the philosophy: traveler-as-planner, AI-as-collaborator, plans-vs-planning, no marketing-speak.

---

## 1. Page title + metadata

| Where | Current | New |
|---|---|---|
| Browser tab `<title>` | `Max — The Existential Traveler` |  |
| OG `og:site_name` | `Max — The Existential Traveler` |  |
| OG `og:title` | `Max — The Existential Traveler` |  |
| OG `og:image:alt` | `Max — The Existential Traveler` |  |
| Twitter title | `Max — The Existential Traveler` |  |

---

## 2. Home page

### 2.1 Header block
| Where | Current | New |
|---|---|---|
| Brand name | `Max` |  |
| Tagline (under brand) | `The Existential Traveler` |  |
| "Install" button label | `⊕ Install` |  |
| "Welcome" button label | `Welcome` |  |
| "How it works" button label | `How it works` |  |
| "Profile" button label | `⚙ Profile` |  |
| "API key" button label | `🔑 API key` |  |
| "Signed in" pill | `✓ Signed in` |  |
| "Sync" pill (signed out) | `⇄ Sync` |  |

### 2.2 Trips list (when trips exist)
| Where | Current | New |
|---|---|---|
| Section label | `YOUR TRIPS` |  |
| Card "Copy" button | `Copy` |  |
| Card delete tooltip | (× icon, no text) |  |
| Confirm delete prompt | `Delete "<name>"?` |  |
| Confirm duplicate prompt | `Make a copy of "<name>"?` |  |

### 2.3 Empty state (no trips yet)
| Where | Current | New |
|---|---|---|
| Headline | `Where would you like to go?` |  |
| Subline | `No trips yet. Start one — or just look around.` |  |

### 2.4 Action buttons (the four-path row)
| Where | Current | New |
|---|---|---|
| Primary action | `+ Start a new trip` |  |
| Secondary | `Discover where to go →` |  |
| Tertiary 1 | `Paste a list` |  |
| Tertiary 2 | `Load from file` |  |
| Footer line | `Max gathers; you evaluate, edit, add. How it works →` |  |

---

## 3. Trip brief overlay

### 3.1 Heading
| Where | Current | New |
|---|---|---|
| Title (brief, place mode) | `Tell Max about your trip` |  |
| Step subtitle (sentence selector) | `What's the sentence that started this trip?` |  |
| Sub-explanation | `Select as many as feel true. The way you say it reveals what's actually driving the trip.` |  |
| "Different" deep-dive title | `Let's find the right distance` |  |
| "Different" subtitle | `You said you need something different. Before Max gathers candidates, it needs to understand what different means for you right now.` |  |

### 3.2 Bottom action
| Where | Current | New |
|---|---|---|
| Submit button | `What to see and do →` |  |
| (proposed new: Ask Max button) | — | `Ask Max to suggest places →` |
| (proposed new: Paste-list button) | — | `Paste a list →` |

---

## 4. Discovery picker

### 4.1 Chrome + page title
| Where | Current | New |
|---|---|---|
| Page title (build) | `Discovery — what to see and do in <Region>` |  |
| Page title (edit) | `Discovery — edit your picks` |  |
| Footer count | `<N> kept` |  |
| Primary CTA (build) | `Create a plan →` |  |
| Primary CTA (edit) | `Apply changes →` |  |
| Bottom toggle | `Hide entry points` / `Show entry points` |  |

### 4.2 Loading states
| Where | Current | New |
|---|---|---|
| Spinner caption (initial) | `Building your trip…` |  |
| Sub-caption | `This usually takes 20–40 seconds. Max is shaping your picks into a sequenced itinerary.` |  |
| Caption (must-dos pass) | `Finding the iconic things to do in <Region>…` |  |
| Sub-caption (must-dos) | `Max is building a soft architecture, a scaffolding, from your first thoughts. You'll shape it from here.` |  |
| Caption (candidates with anchors) | `Describing <N> required stop<s> from what your trip includes and finding more places worth visiting.` |  |
| Caption (candidates without anchors) | `Searching for places that fit your trip.` |  |

### 4.3 Search + section labels
| Where | Current | New |
|---|---|---|
| Search input placeholder | `Search places and notes…` |  |
| "What's here" TOC label | `What's here` |  |
| "Discovery notes" header button | `🔬 Discovery notes` |  |
| "Print" header button | `🖨 Print` |  |
| "Share" header button | `🔗 Share` |  |
| "Clipper" header button | `🔖 Clipper` |  |
| Bulk-select toggle | `☑ Select` / `✓ Selecting` |  |
| Rejected section header | `Rejected` |  |
| Recommended overnight stays | `Recommended overnight stays` |  |
| Synthetic activity description | `Cities and towns you flagged as overnight stays. These anchor the trip's geography — they're where you sleep and the bases for day trips.` |  |
| Other stays to consider | `Other stays to consider` |  |
| Synthetic activity description | `Places Max thinks are worth considering as overnight stays based on your list. Check the ones that fit your trip; ignore the rest.` |  |
| "Single-sight" banner heading | `<N> single-sight place<s> to assign` |  |
| Banner body | `Tap each 👁 pin on the map (or its card below) and pick: along the way, or day trip from a hub. Max identified these — you decide how to fit them.` |  |

### 4.4 Row affordances
| Where | Current | New |
|---|---|---|
| "Story →" link | `Story →` |  |
| "Things to do →" link | `Things to do →` |  |
| "Tell me more →" inline | `Tell me more →` |  |
| ⋯ menu — toggle | `Mark as overnight stay` / `Mark as just visiting` |  |
| ⋯ menu — remove | `Remove from list` |  |
| Sights here line | `Sights here: <preview>` |  |

### 4.5 Map popup
| Where | Current | New |
|---|---|---|
| Suggestion prefix (Max) | `Max suggests:` |  |
| Suggestion prefix (user committed) | `You selected:` |  |
| History line | `Max had suggested <stay overnight \| just visit>` |  |
| Flip button (to stay) | `Stay overnight` |  |
| Flip button (to see) | `Just visiting` |  |
| Drop link | `Drop from trip` |  |
| Remove link | `Remove from list` |  |
| Find link | `Find in list →` |  |

---

## 5. Paste-list modal

### 5.1 Current (single textarea)
| Where | Current | New |
|---|---|---|
| Modal title | `Paste a list of places` |  |
| Subtitle | `First line is the trip name + region — e.g. Iceland Road Trip 2026 (Iceland). Optional second line for dates — September 17, 17 nights works. Then one place per line. After Open, you'll land in Discovery with your places grouped into activity themes — review, keep/reject, and add what Max missed before committing destinations.` |  |
| Build button | `Open in picker →` |  |
| Cancel | `Cancel` |  |
| Preview prefix | `Will create:` |  |

### 5.2 Proposed (two-section labeled dialog)
| Where | Current | New |
|---|---|---|
| Modal title | — | `What's on your list?` |
| Section 1 label | — | `Places I want to stay` |
| Section 2 label | — | `Things I want to see and do` |
| Helper microcopy | — | `One place per line. Max will fetch details and add suggestions.` |

---

## 6. Research notes (Discovery research card)

| Where | Current | New |
|---|---|---|
| Card header | `KEEP IN MIND FOR YOUR TRIP` |  |
| Card title (trip-level) | `<Region>` |  |
| Card subtitle | `Anything you want to remember — links, gear thoughts, timing, weather, confirmations, packing list, contacts. One place for everything trip-related.` |  |
| Section: Notes | `NOTES` |  |
| + Add document | `+ Add document` |  |
| Section: Source links | `SOURCE LINKS` |  |
| + Add link | `+ Add link` |  |
| Done button | `Done` |  |
| Make destinations | `🪄 Make destinations from this list` |  |

---

## 7. Trip view (drawTripMode)

(filled in as you point me at specific surfaces; I left this thin because there's a lot)

| Where | Current | New |
|---|---|---|
| Header rename tooltip | `Click to rename` |  |
| Save status | `Saved ✓` |  |
| Sync status (signed in) | `saved ✓` |  |
| Sync status (saving) | `saving…` |  |
| Sync status (offline) | `offline — saved locally only` |  |

---

## 8. Modals and dialogs

### 8.1 How it works modal
| Where | Current | New |
|---|---|---|
| Modal title | (no title; intro starts the text) |  |
| Preamble | `A note on what Max can and can't do.` |  |
| Disclaimer | `Max gathers; you evaluate, edit, and add. Max's picture is partial — it can't know everything, and won't always be right about what it does know. Trip planning is yours: the choices, responsibility, and judgment stay with you. Verify times, prices, and availability before you commit.` |  |
| Body | The long `MAX_ABOUT_TEXT` block (Eisenhower, river, etc.) | Edit directly in `index.html:11523` if you want; I can extract it here if you prefer |

### 8.2 AI disclaimer (first-time / new-trip)
(I'll fill this in if/when you want to revise the gate)

---

## 9. Save / sync / errors

| Where | Current | New |
|---|---|---|
| Quota-exceeded alert | `⚠ Your edits aren't being saved on this device. Local storage is full and the IndexedDB fallback isn't available, so changes you make to this trip won't persist when you reload. What to do: Sign in (⇄ in the header) — your trip syncs to the server immediately. Or download a backup via Export → Save as PDF before reloading.` |  |
| Load trip alert (no body) | `Couldn't open that trip — its data isn't on this device. Sign in to sync it from the server.` |  |
| Server unreachable error | `Server unreachable: <detail>` |  |

---

## Process

1. Edit any cell in the "New" column. Leave a cell blank to keep the existing string.
2. When you're ready, just tell me "apply copy.md" (or similar). I'll diff and patch `index.html` / others.
3. If a string belongs in a different bucket, move it. If a string is missing, add a row.
4. If you want to wholesale rewrite a paragraph (like the How it works modal body), paste the new version under that section's heading and I'll wire it in.
