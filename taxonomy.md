# Activity taxonomy — planning + execution

Two parallel taxonomies for two different surfaces of the app:
- **Planning mode** → drives the brief's chips, the picker's section grouping,
  and the LLM prompts that generate trip activities.
- **Execution mode** → drives the destination detail page when you're on
  the ground and need infrastructure, not inspiration.

These are independent — an activity might be "ride the Glacier Express"
(planning) and an everyday user need might be "find a 24-hour pharmacy"
(execution). Different mental modes, different categories.

## Guiding principle

**The job is to help the user discover what they don't know they don't
know.** Travelers know what they like in the abstract — history, food,
trains. What they don't know is what's specifically *at this place* worth
their attention: Lavaux wine terraces, Reichenbach Falls, the Centovalli
Express, sentō neighborhood baths, the Aletsch viewpoint at Bettmeralp.

This principle decides what UI we build and don't build:

- **Yes**: surface a comprehensive set of activities for each place,
  organized by category, and let the user pick visually. The user
  reacts to what they see.
- **No**: ask the user to declare interests upfront via chips/checklists.
  That filters by *known knowns* and hides the unknown unknowns —
  exactly the wrong direction.
- **Yes**: a "?" popup per place with a Max-voiced description and
  specific things to look for. Surfaces depth.
- **Yes**: a breadth-discovery panel ("Other places worth considering")
  that surfaces places adjacent to the brief that the activity picks
  missed.
- **No**: filtering UI on the picker that lets the user only show
  certain categories. Same problem — narrows the surface to what they
  already know they want.

The categories in this taxonomy are an *organizing scheme for what we
surface*, not a *checklist for the user to declare interest in*.

## What this taxonomy IS and ISN'T

This is a **delivery scheme** for the suggestions Max makes — an
organizing shape for what gets surfaced in the picker, on the brief
chip list, and on the destination detail page. It is **not a complete
classification** of everything a traveler might do.

People with niche interests (ham-radio operator gatherings, specific
collector circuits, obscure pilgrimages, very specialized hobbies)
already know about those things. If a niche activity isn't in the
LLM's suggestions, the user adds it via the picker's **+ Add a place**
or **+ Add an experience** panels, and Max plans around it.

So when stress-testing this taxonomy, the question isn't "does every
imaginable activity have a clean home?" — it's "does the shape we
deliver to most users feel coherent?" Long-tail activities are handled
by manual add. The taxonomy just needs to be good enough as a
suggestion scheme.

## Implementation guidance (prefer, don't enforce)

When wiring this taxonomy into prompts and code, the rule is:

- **Prompts should *prefer* the 6 categories**, not require them. The
  LLM's instruction reads like "pick the closest of these 6 for each
  activity" — not "fail if you can't fit." If something genuinely
  doesn't belong (a one-off Mongolian throat-singing class), the LLM
  picks the closest fit and the user can re-categorize via manual add.
- **Code consuming activity output should not reject** items missing a
  category or with an unrecognized one. Treat missing/unknown as a
  generic bucket; render normally.
- **Don't write a validator that throws on category drift**. The
  "+ Add" paths in the picker are the safety net — users add what we
  don't suggest, and Max plans around it.
- **The taxonomy is for shaping suggestions**, not for enforcing
  conformity on what users can plan.

Put this comment near the categorization code so future maintainers
don't over-engineer enforcement.

---

## Planning mode — 6 categories

Each activity in the picker / build belongs to one (rarely two) of these.
Seasonality is **metadata** on the activity, not a category.

### 1. Outdoor activities
*Activities done in motion, outside, or with the landscape as the
medium.* Includes hiking, cycling, water sports, beaches, mountain
summits, scenic transport experiences (the journey IS the activity —
trains through the Alps, ferries across fjords), adventurous pursuits
(canyoning, paragliding, climbing), and outdoor spectator sport (a
match at a stadium, a Tour de France stage from the roadside).
Photography workshops where the *subject* is landscape or wildlife
also belong here, even though they're a "learning" mode.

Existing chips: hike in nature, get into the mountains, cycle somewhere,
get out on the water, get to the beach, do something adventurous, watch
or play a sport, ride iconic trains, sail scenic lake circuits, ride
mountain railways to summits.

LLM picker sub-sections (verb-phrased):
- Walk in the mountains
- Cycle the routes
- Get on the water
- Sail scenic lake circuits
- Travel on iconic trains
- Ride mountain railways to summits
- Do something adventurous
- Take to the beach
- Watch or play a sport

### 2. Scenery & nature
*Standing in front of, photographing, or otherwise absorbing the natural
world and the landscape.* Includes wildlife viewing (zoos, aquariums,
safaris, whale watching), botanical gardens, parks, dark-sky and aurora
nights, panoramic viewpoints, scenic vista drives where the
*destination* is the view (not the driving). Distinguished from
"Outdoor activities" by mode: in *Scenery* you're mostly looking; in
*Outdoors* you're moving.

Existing chips: see spectacular scenery, see wildlife, visit magnificent
gardens, take great photos, chase dark skies & aurora.

LLM picker sub-sections:
- Visit natural wonders
- See wildlife
- Catch the aurora
- Stand in front of great views
- Visit magnificent gardens
- Take great photos

### 3. Culture & history
*Built environment, art, ideas, ritual, and the production of culture.*
Broad category — covers museums, historic sites, architecture, literary
and film trails, pilgrimage and sacred sites, but also:

- **Craft & heritage shopping** — buying the cultural output of a place
  (Murano glass, Portuguese tile, Moroccan rugs, Japanese ceramics,
  Persian carpets, Florentine leather, Tuscan ceramics). The act of
  bringing home a regional craft is cultural participation.
- **Hands-on workshops** — kintsugi in Kyoto, calligraphy classes,
  pottery, weaving, tile-painting, language immersion, dance lessons
  (tango in Buenos Aires, salsa in Cuba, flamenco in Seville),
  instrument lessons, painting workshops. Anywhere you're absorbing or
  practicing a regional tradition.
- **Personal services that ARE the culture** — a Hong Kong tailored
  suit, a Bangkok shirt fitting, a Tokyo neighborhood barber. These
  blur with Daily essentials but if a service IS a tradition, it lives
  here.

Existing chips: dig into history, see great art & museums, explore
architecture, explore small towns, follow a literary or film trail,
make a pilgrimage.

LLM picker sub-sections:
- See historic sites
- Visit world-class museums
- Explore cities and towns
- Follow the literary trail
- Visit sacred sites
- Trace cinematic landmarks

### 4. Food & drink
*Tasting, learning, harvesting, shopping for food.* Includes restaurants
(from holes-in-the-wall to destination dining), street food, food
markets (food bazaars, fish markets, spice markets — distinct from
craft markets which go in Culture), wineries / breweries / distilleries,
cooking classes, producer visits (cheesemakers, chocolatiers, olive oil
mills, salt flats), regional food specialties as a planning anchor
(truffle hunting in Piedmont, jamón in Andalusia, sushi in Toyosu).

Existing chips: eat and drink well, wander markets & street food, take a
cooking class or workshop.

LLM picker sub-sections:
- Taste the local food
- Wander markets
- Cook with locals
- Drink the regional wine / beer / spirits
- Visit producers (cheese, chocolate, oil, etc.)

### 5. Connections & gatherings
*Social and shared experiences — being with people, attending events
where many people gather, watching a performance.* Includes nightlife,
festivals, concerts, religious feasts, public-square events, **theme
parks** (Disney Paris, Tivoli, Universal — entertainment-as-spectacle
where you go *to be among people*), **casinos** (Macau, Vegas, Monte
Carlo), **big shows** (Cirque du Soleil, Vegas residencies, Broadway,
West End), **opera and ballet performances** (the show, not the
opera house as building — that's Culture), **spectator sports inside
arenas** (Premier League at Camp Nou, NBA at MSG — distinct from outdoor
spectator sport which is Outdoors). Also covers meeting locals through
shared activity (community meals, language exchanges) and visiting
friends/family.

Existing chips: meet locals, catch live music or a festival, enjoy
nightlife & music, visit friends or family.

LLM picker sub-sections:
- Meet the locals
- Catch live music
- Go out at night
- See friends and family
- Attend festivals & events

### 6. Wellness & personal growth
*Tending to the self — rest, recovery, transformation, intentional
change.* Two ends of one spectrum:

**Wellness end** (restoration, slow time):
- Spa days, thermal baths, hammams (Turkish hammams, Japanese onsen,
  Hungarian thermal pools, Icelandic hot springs, Korean jjimjilbang)
- Culturally-rooted wellness (ayurvedic treatments in Kerala, temazcal
  in Mexico, sentō in Tokyo neighborhoods)
- Beach lounging, slow time, therapeutic retreats, healing
- Trip-anchor wellness weeks (week-long ayurvedic, Korean
  spa-and-skincare residencies)

**Personal growth end** (intentional change, transformation):
- Yoga retreats, meditation retreats, silent retreats / Vipassana
- Yoga teacher training, intensive practice
- Ayahuasca ceremonies, vision quests, plant-medicine programs
- Language immersion when it's framed as identity-shift (not just
  cultural curiosity — that's Culture & history)
- Skill-building retreats (writing, photography, art) when the goal is
  becoming-someone-who-does-this, not just seeing the place
- Voluntourism when the framing is personal change (not shared
  experience — that's Connections & gatherings)

The same activity can land in different categories based on intent —
a Spanish immersion week might be Culture & history (for the cultural
curiosity angle) or Wellness & personal growth (for the becoming-someone
angle). Trust the user's framing in the brief to decide.

Existing chips: slow down & recharge, retreat, rest, heal.

LLM picker sub-sections:
- Slow down
- Retreat and rest
- Soak in thermal baths
- Spa / wellness retreat

---

## Seasonality (metadata, not category)

Every activity in any of the 6 categories can carry a `seasonality` field.
The picker / build / UI use this to show season banners, warn when dates
don't fit, and suggest "best time" alongside the activity.

Possible values:
- `any` — no seasonal constraint (most activities)
- `peak: ["May", "Jun", "Sep"]` — months when the experience is best
- `viable: ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]` — broader
  window of when it works at all
- `dates: "April 14-21, 2027"` — specific calendar dates (festivals)
- `conditionType: "weather" | "calendar" | "biological" | "harvest"` —
  drives different UI treatment

Examples that should be tagged:
- Aurora — viable Sep-Mar, peak Oct-Feb, conditionType: weather
- Cherry blossoms — peak early-mid spring, varies by latitude,
  conditionType: biological
- Truffle dinner — peak Oct-Dec, conditionType: harvest
- Carnevale di Venezia — dates: 2027-02-06 to 2027-02-16,
  conditionType: calendar
- Foliage drive — peak Sep-Oct in northern hemisphere,
  conditionType: biological
- Bulgaria rose festival — peak first weekend of June

---

## Execution mode — 6 groups

A parallel taxonomy that lives on the destination detail page. The user
is on the ground; they need infrastructure, not inspiration. Five groups
are about *what's there* (places and services); the sixth is about
*how things work here* (knowledge).

### 1. Getting around
- Public transit (metro, tram, bus) — routes, fares, day passes
- Ride-share apps — surfaced as a STRUCTURED top-level field on the
  execution-mode JSON, separate from the bullet items. The LLM returns
  `{ available, primaryApp, alternativeApps, vsTaxi, notes }` so the
  panel can render a labelled card answering "which app should I install
  before I land, what does it cost vs taxi, and what gotchas?" The
  primary app varies by region (Uber in US/UK/much of Europe; Bolt in
  Eastern Europe and parts of Africa; Grab in SE Asia; DiDi in China;
  Ola in India; Cabify in Spain/LatAm; Free Now in DACH/UK; Yandex Go
  in CIS; Careem in Middle East). When ride-share is restricted or
  not useful, `available:false` and notes explain what to use instead.
- Taxi stands & street-hail norms (meter? app? hail?)
- Airport transfers (express train, shuttle bus, flat-rate taxi)
- Train stations / bus stations (with locker availability)
- Bike share & scooter share apps
- Car rental locations
- Ferries within / to a city
- Funicular / urban cable cars

### 2. Daily essentials
*Everything you need to live out of a suitcase. Specialized needs (dietary,
family, pets, religious practice, etc.) live here too — they're essential
to whoever needs them.*

- Grocery stores & supermarkets (incl. dietary-specific: halal, kosher,
  vegetarian, gluten-free)
- Convenience stores
- Pharmacies (24-hour ones noted)
- ATMs (low-fee banks for the user's card)
- Currency exchange (which to avoid)
- Water (tap-drinkable status, refill stations)
- Laundry / launderettes
- Public restrooms (paid vs. free)
- Luggage storage / lockers
- Post offices
- SIM cards / eSIM where to buy
- Phone repair / accessories
- Family infrastructure (playgrounds, family bathrooms, nursing rooms)
- Pet services (vets, pet supply, pet-friendly cafes)
- Religious practice spaces (active worship spaces with service times)
- Co-working / WiFi cafes for digital nomads

### 3. Help & safety
- Hospitals / urgent care
- Emergency numbers (regional)
- Police stations
- Embassy / consulate (for the user's home country)
- Lost & found

### 4. Getting to know a place
*Orientation and learning when you arrive.*

- Tourist information office
- Self-guided walking tours (printed routes, apps)
- Guided walking tours (free + paid)
- Hop-on-hop-off buses
- Audio guides / city apps
- City maps / printed guides

### 5. Saving money
*Passes, discounts, time-of-day deals — anything that reduces what the
trip costs once you're there.*

- City passes (Swiss Travel Pass, Paris Visite, etc.)
- Museum passes
- Combined transit + attractions cards
- Theater / opera discounts (TKTS booths, day-of rush, standby)
- Restaurant deals (restaurant week, prix-fixe lunch menus)
- Free-day museums (often Sunday or first-of-month)
- Free walking tours (tip-based)
- Happy hours
- Off-peak transit fares
- Where to buy / vending vs. counter

### 6. Cultural norms
*The knowledge layer — how things work here, what's expected, what to
avoid. Not infrastructure (places & services), not inspiration
(activities) — just the hidden rules a local would know.*

- Tipping conventions (10% / 18% / round-up / not at all)
- Currency basics (what bills & coins, rough conversion rate, where
  cards aren't accepted)
- Greetings & social conventions (handshake / cheek kiss / bow; formal
  vs. informal address)
- Dining customs (how to ask for the bill, sharing plates, lingering
  vs. quick turnover, when locals eat dinner)
- Dress codes (for restaurants, religious sites, opera, beaches)
- Bargaining norms (markets vs. shops, expected % off)
- Public holidays & closures (Swiss Sundays, August in Italy, Ramadan,
  Sabbath observance, etc.)
- Daily rhythm (siesta times, market hours, late dinners)
- Language basics (10 key phrases: hello, thank you, please, water,
  where's the bathroom, the bill, sorry, excuse me, yes, no)
- Photography etiquette (religious sites, indigenous communities,
  locked-down monuments)
- Quiet hours (some countries have legal noise rules)
- Drinking culture (toasting customs, drinking ages, social drinking
  norms)
- Smoking norms (where allowed, how common, etiquette)
- Religious observance (Ramadan, Sabbath, Lent — what hours/services
  it affects)
- Personal space / touch / eye-contact norms
- Queue culture (orderly line vs. press-toward-counter)

Note: some items appear in two groups but from different angles —
- Currency: *where to exchange* → Daily essentials. *What they use, rough
  rate, card acceptance* → Cultural norms.
- Religion: *where to worship* → Daily essentials. *How observance affects
  hours and behavior* → Cultural norms.

---

## Accessibility — tag, not category

Accessibility cuts across all 5 execution groups. It's a constraint that
filters items, not its own bucket:

- A transit option can be `accessible: true` (step-free, elevator, ramp).
- A restaurant can be `wheelchair_accessible: true`.
- A walking-tour route can be `step_free: true`.
- A grocery store can be `accessible_entrance: true`.

The brief's existing `_briefPersonalContext` already captures the user's
mobility / disability constraints. The execution-mode UI uses that to
filter — surface only accessibility-tagged items when the user needs
them, but show everything otherwise.

Same model could extend to other "needs filter" cases:
- Family with young kids → highlight playgrounds, nursing rooms,
  kid-friendly cafes
- Dietary restrictions → filter groceries and restaurants by tag
- Religious practice needs → filter or surface worship spaces

These aren't categories. They're filters applied to the categories.

---

## How this lands in code

### Planning side (existing infrastructure)
- **Brief chips** (line 7006): the 28 user-facing chips, optionally
  grouped on the brief page by the 6 categories.
- **LLM picker prompt** (line 5091+): suggested section names match the
  sub-sections above; LLM should pick from this list and not invent new
  ones.
- **Picker rendering** (`_renderPlaceActivityItems`): currently shows
  flat sections; could roll up into 6 collapsible top-level groups.
- **Activity object schema**: add `category` (one of 6) and optional
  `seasonality` fields.

### Execution side (mostly new)
- **Destination detail page**: add an "On the ground" tab or panel with
  the 5 execution groups. Each group expands to show region/city-specific
  results.
- **`geocodeEssentials`** (existing): already pulls atm, bank, grocery,
  tourist-info, pharmacy. Extend the type list to cover more of "Daily
  essentials" + add separate fetches for "Getting to know a place" and
  "Saving money" recommendations.
- **LLM prompt**: a new prompt per destination that generates execution
  recommendations using the 5-group taxonomy, cached per place.

---

## Open decisions

1. **Should the 28 chips be grouped on the brief page** by the 6
   categories, or stay flat? Grouping helps users find chips that match
   their intent; flat is simpler.
2. **Should the LLM be allowed to invent new sub-sections** beyond the
   recommended set, or strictly forced to pick? Strict = consistent;
   flexible = handles edge cases.
3. **Order of the 6 categories** — is Outdoors first or Culture first?
   Probably the order should reflect the trip's drivers (an active person
   sees Outdoors first, a history buff sees Culture first), which means
   personalized sort.
4. **Execution-mode UI placement** — new tab on destination detail?
   Inline below current itinerary? Slide-out panel?
5. **Accessibility tags** — should the brief's mobility constraint
   default-filter all execution items, or just highlight tagged ones?
   First is opinionated, second is permissive.

---

## Next round to ship (when ready)

Both rounds are now shipped:

1. **CZ — wire planning taxonomy into the picker** (✓ shipped). The 6
   categories are threaded into the `generateActivitiesForPlace` prompt,
   activities carry a `category` field (heuristic fallback when LLM
   omits it), and the picker renders sections under category headers
   with emoji.
2. **CY — execution-mode panel** (✓ shipped, max-v59). The "Info" tab on
   the destination detail page is repurposed as **"On the ground"**.
   `_generateExecutionInfo(placeName)` returns a structured 6-group JSON
   payload (Getting around / Daily essentials / Help & safety /
   Getting to know the place / Saving money / Cultural norms), cached
   on `window._placeExecutionCache` and through the existing IDB
   callMax cache. Lazy-loads on first activation of the tab; the
   existing currency/tipping/emergency quick-glance grid and physical
   practical pins (ATMs, banks, etc.) remain. A "Refresh" button forces
   regeneration if the cached output looks off.
