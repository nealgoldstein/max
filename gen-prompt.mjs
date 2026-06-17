// @ts-check
// gen-prompt.js — PD.402: the activity-generation PROMPT assembly.
//
// Extracted verbatim from _generateActivitiesForPlaceImpl in index.html
// (the build/generation flow). PURE and DOM-free: given the trip's
// structured inputs it returns the exact prompt string the LLM receives.
// The orchestrator (index.html) still gathers the inputs (brief bits,
// budget days, user list, chips, personal context) and performs the LLM
// call, parse, verify, and merge — this module owns ONLY the string.
//
// Keeping it pure makes the prompt Node-testable and gives the parked
// #80 "slim the prompt" work a single, covered place to live.
//
//   MaxGenPrompt.detectCompleteness(text) -> bool   (the every-stop signal)
//   MaxGenPrompt.build({ place, ctx, briefBits, budgetDays,
//                        completeness, userList, pmChips, personalContext })
//     -> string
//
// build() reproduces the inline assembly byte-for-byte; the only changes
// are reading from the opts above instead of _tb / app helpers directly.

const global = /** @type {any} */ (globalThis);
  "use strict";

  // The geographic-completeness signal regex (moved verbatim from the
  // inline _completenessRe). The caller joins ctx + intent + context +
  // activityDesc and passes the haystack; we lowercase + test.
  var _completenessRe = /(complete|every stop|all the way|all the stops|whole loop|entire loop|whole circuit|entire circuit|every town|all towns|ring road|grand tour|full circuit|loop the|round trip the|cover the entire|every major)/;
  function detectCompleteness(text){
    return _completenessRe.test(String(text || "").toLowerCase());
  }

  function build(opts){
    opts = opts || {};
    var place           = opts.place || "";
    var ctx             = opts.ctx || "";
    var briefBits       = opts.briefBits || [];
    var budgetDays      = opts.budgetDays;
    var completeness    = !!opts.completeness;
    var userList        = opts.userList || [];
    var pmChips         = opts.pmChips || [];
    var personalContext = opts.personalContext || "";
    // PD.404 (#80): when true, the listed places are captured + themed by a
    // SEPARATE theming pass, so generation must NOT be asked to re-emit them
    // (re-emitting a long list is what makes the model drop places). The
    // softened block tells the model the list is handled and to suggest
    // complementary things AROUND it. Default false = the original
    // hard-constraint, re-emit-every-place block (unchanged behavior).
    var listHandledSeparately = !!opts.listHandledSeparately;

  var _userListBlock = "";
  if (Array.isArray(userList) && userList.length) {
    var _ulLines = userList.map(function(d){
      var stay = d.isStay || (typeof d.nights === "number" && d.nights > 0);
      return "  - " + d.place + (stay ? (" — OVERNIGHT STAY" + (d.nights ? " (" + d.nights + " nights)" : "")) : " — see/do");
    }).join("\n");
    if (listHandledSeparately) {
      // PD.404 (#80): the list is captured + themed by a separate pass.
      // Don't make generation responsible for re-emitting it.
      _userListBlock = "\nTHE TRAVELER'S OWN LIST — already captured, do NOT re-list these:\n"
        + _ulLines + "\n"
        + "  - These places are ALREADY in the traveler's plan; a separate step files each one into the right section. You do NOT need to output them as requiredPlaces, and you must NOT treat this as a list to reproduce.\n"
        + "  - Your job is to suggest COMPLEMENTARY activities, routes, and condition-dependent experiences AROUND this list — things that pair well with these places but that the traveler hasn't already named.\n"
        + "  - You MAY name a listed place inside an activity when it is genuinely the spot for that activity, but never pad your output by re-listing the whole set.\n\n";
    } else {
      _userListBlock = "\nTHE TRAVELER'S OWN LIST — HARD CONSTRAINT, this overrides every clustering and selectivity rule above:\n"
        + _ulLines + "\n"
        + "  - EVERY place on this list MUST appear in your output as a requiredPlace (use the canonical full name a map service resolves).\n"
        + "  - Places marked OVERNIGHT STAY MUST have overnight:true and at least the listed nights — do NOT demote them to day trips or sights; the traveler explicitly chose to sleep there.\n"
        + "  - Do not drop, rename beyond canonical form, or merge away any listed place. Add your own suggestions AROUND this list, never instead of it.\n\n";
    }
  }

  var _briefBlock = briefBits.length
    ? "\nTRIP CONTEXT (filter and tune suggestions to this \u2014 e.g. omit aurora outside Sep\u2013Mar, omit summer-only routes in winter, skip multi-day vertical hikes for limited-mobility parties, weight slow-pace itineraries when pace is loose):\n  - " + briefBits.join("\n  - ") + "\n\n"
    : "";

  var _budgetBlock = "";
  if (budgetDays && budgetDays > 0) {
        var _budgetDays = budgetDays;
        var _budgetNights = Math.max(1, _budgetDays - 1);
        var _targetUniqueNights = Math.round(_budgetNights * 1.3);
        _budgetBlock = "\nHARD BUDGET CONSTRAINT \u2014 read this carefully:\n"
          + "  - The traveler has " + _budgetDays + " day" + (_budgetDays !== 1 ? "s" : "") + " (" + _budgetNights + " night" + (_budgetNights !== 1 ? "s" : "") + ") for this trip. This is a CEILING, not a target.\n"
          + "  - The sum of nights across all UNIQUE overnight:true places in your output should be approximately " + _budgetNights + "\u2013" + _targetUniqueNights + " nights \u2014 not more. Headroom (~30%) lets the user accept/reject, but exceeding it forces the user to either drop content or extend their dates.\n"
          + "  - If you cannot honestly fit the iconic experiences this region offers within that budget, SAY SO in your output: include one activity-style item with name 'This trip is tight on time' and a description explaining what would have to drop or what dates would need to extend. Don't pad the list to hide the constraint; tell the user the truth.\n"
          + "  - Day trips (overnight:false places) do NOT count toward the budget \u2014 they absorb into hubs. Use them liberally where geography allows.\n\n";
  }

  var _completenessBlock = "";
  if (completeness) {
      _completenessBlock = "\nGEOGRAPHIC COMPLETENESS — HARD CONSTRAINT, read carefully:\n"
        + "  - The traveler explicitly asked for a complete / every-stop / whole-loop trip. This is NOT a vague preference; it's a list-every-major-town requirement.\n"
        + "  - Enumerate EVERY major town, gateway, and waypoint along the route or loop they're asking about — not just the iconic headliners. Include regional hubs, fjord-base towns, ring-road stopovers, and gateway villages that travelers actually sleep in along the route, even if they aren't on the canonical tourist circuit.\n"
        + "  - For Iceland's Route 1 specifically, that means including (at minimum) every major town with lodging that's a legitimate overnight base along the ring — west, north, east, and south. Don't skip the east-fjord gateway or any other multi-hour-drive-from-the-next-town hub.\n"
        + "  - Mark these waypoint towns overnight:true ONLY if they're real multi-night bases. For pass-through towns that the traveler will actually stop at for a meal / photo / break, mark overnight:false but still include them.\n"
        + "  - The traveler's words override the usual 'cluster ruthlessly' rule. They've explicitly chosen breadth over selectivity.\n\n";
  }

  var prompt = "A traveler wants to go to " + place + ".\n"
    + (ctx ? "Context about this trip: " + ctx + "\n" : "")
    + _briefBlock
    + _budgetBlock
    + _completenessBlock
    + _userListBlock
    + (pmChips.length ? "General interests they tagged (use these to bias what you surface, but don\u2019t shoehorn): " + pmChips.join(", ") + "\n" : "")
    + "\nThey haven\u2019t told you what they want to do yet \u2014 they chose a place and want you to map out what\u2019s actually there, so they can decide what matters. Surface the routes, the condition-dependent experiences, and the activities that make this place worth the trip. Be honest about the best of what\u2019s there; don\u2019t pad with generic items.\n\n"
    + "There are three types.\n\n"
    + "TYPE 1 \u2014 ROUTE: a scenic travel leg between specific places (a named train, a scenic road, a long-distance hike, a lake steamer). IMPORTANT: routes are TRANSPORTATION, not activities. They are how the traveler MOVES between destinations while seeing great scenery — functionally the same as a car trip or a bus. A route does NOT count as a destination and does NOT eat activity time at its endpoints; the endpoints are where the real time is spent.\n"
    + "  Required fields: endpoints: ordered array [{place,country},{place,country}]; requiredPlaces (same as endpoints); direction (\"either\"/\"forward\"/\"reverse\"); durationHours (TRAVEL time only, i.e. the ride itself — not padded with endpoint time); modeOptions (\"tourist\"/\"regional\"/\"both\"); alternatives (if both, describe the ordinary version — relevant because the traveler is choosing between branded and plain-rail for the same journey); reservationNotes (if applicable); endpointHighlights (object keyed by place name, short list of the things the traveler can actually do at that place — this is the real content).\n\n"
    + "TYPE 2 \u2014 CONDITION: something that depends on weather, season, daylight, or circumstance (Northern Lights, whale watching, cherry blossoms, wildflowers, migration).\n"
    + "  Required fields: viableLocations: array of {place,country}; requiredPlaces: same; recovery (\"low\"/\"moderate\"/\"high\"); frequencyRequirement (min nights in viable locations); conditionNote (one sentence about what the traveler needs to understand).\n\n"
    + "TYPE 3 \u2014 ACTIVITY: anything else worth doing in this place \u2014 sights, experiences, food, culture. An activity is pursued across one or more specific places where it\u2019s especially worthwhile.\n"
    + "  Required fields: requiredPlaces: array of {place,country} where this activity is especially good; durationHours (rough total for a committed traveler); description (specific, concrete sentence).\n\n"
    + "ACCURACY RULE \u2014 read this first, it overrides convenience: WRONG INFORMATION IS WORSE THAN NO INFORMATION. If you\u2019re not certain about a route\u2019s endpoints, a place\u2019s exact location, a price, a schedule, or any other specific fact, OMIT THE ITEM rather than guess. A traveler who arrives at a station that doesn\u2019t exist, or boards a train that doesn\u2019t run on that route, will lose trust in everything else Max says. Confidently wrong specifics \u2014 a famous train asserted on a route it doesn\u2019t serve, a sight placed in the wrong country, a festival in the wrong month \u2014 are exactly the failure mode to avoid.\n\n"
    + "VERB-PHRASE NAMES: every item\u2019s name reads as a thing the traveler DOES, not a noun. Use action verbs at the start: \"Visit the waterfall\" not \"The waterfall\"; \"Walk the trail\" not \"The trail\"; \"Taste at the source\" not \"Tasting\"; \"Ride the named train\" not the train's name alone. The user is choosing actions, so the names should be actions.\n\n"
    + "CATEGORIES \u2014 every item gets a `category` field, one of these six. PREFER this list, don\u2019t enforce it: pick the closest fit when something doesn\u2019t belong cleanly. If genuinely none fit, pick the closest and the user will reclassify manually.\n"
    + "  1. \"outdoors-active\" \u2014 Outdoor activities. Moving, outside, landscape-as-medium. Hiking, cycling, water sports, beaches, mountain summits, scenic transport experiences (the journey IS the activity), adventurous pursuits, outdoor spectator sport.\n"
    + "  2. \"scenery-nature\" \u2014 Scenery & nature. Standing in front of, photographing, absorbing the natural world. Wildlife, gardens, dark skies/aurora, panoramic viewpoints, scenic vista drives where the destination is the view.\n"
    + "  3. \"culture-history\" \u2014 Culture & history. Built environment, art, ideas, ritual, production of culture. Museums, historic sites, architecture, literary trails, pilgrimage, sacred sites. Also: heritage shopping (Murano glass, Moroccan rugs), hands-on craft workshops, language/dance/instrument lessons, personal services that are themselves traditions (Hong Kong tailoring).\n"
    + "  4. \"food-drink\" \u2014 Food & drink. Restaurants, food markets (distinct from craft markets), street food, wineries/breweries/distilleries, cooking classes, producer visits, regional food specialties as a planning anchor.\n"
    + "  5. \"connection-gatherings\" \u2014 Connections & gatherings. Social/shared/performative. Nightlife, festivals, concerts, religious feasts, theme parks, casinos, big shows (Cirque, Broadway, Vegas), opera/ballet performances, indoor stadium spectator sports, meeting locals, visiting friends/family.\n"
    + "  6. \"wellness-growth\" \u2014 Wellness & personal growth. Tending to the self. Spa, thermal baths, hammams, onsen, ayurvedic, temazcal. Yoga retreats, meditation/silent retreats, ayahuasca/vision quests, intensive practice (yoga teacher training), language immersion when framed as identity-shift, voluntourism when framed as personal change.\n"
    + "\nSECTION GROUPING: every item also gets a section field \u2014 a verb-phrased SUB-CATEGORY header that groups related items WITHIN ITS CATEGORY. Examples by category:\n"
    + "  outdoors-active: \"Walk in the mountains\", \"Cycle the routes\", \"Get on the water\", \"Sail scenic lake circuits\", \"Travel on iconic trains\", \"Ride mountain railways to summits\", \"Do something adventurous\", \"Take to the beach\".\n"
    + "  scenery-nature: \"Visit natural wonders\", \"See wildlife\", \"Catch the aurora\", \"Stand in front of great views\", \"Visit magnificent gardens\".\n"
    + "  culture-history: \"See historic sites\", \"Visit world-class museums\", \"Explore cities and towns\", \"Follow the literary trail\", \"Visit sacred sites\", \"Take a craft workshop\".\n"
    + "  food-drink: \"Taste the local food\", \"Wander markets\", \"Cook with locals\", \"Drink the regional wine/beer\", \"Visit producers\".\n"
    + "  connection-gatherings: \"Catch live music\", \"Go out at night\", \"Attend festivals & events\", \"Meet the locals\".\n"
    + "  wellness-growth: \"Soak in thermal baths\", \"Retreat and rest\", \"Practice yoga or meditation\", \"Build a new skill\".\n"
    + "UNIQUENESS: each section name appears at most once. If two items belong together, give them the same section string. NEVER emit two identical section names. Section header order: routes/transit first, condition items last, activities in the middle. Multiple items per section is the goal \u2014 DON\u2019T put one item in its own section.\n\n"
    + "ICONIC FLAG: every item gets an iconic boolean. Mark iconic:true on items a first-time visitor to this region would be disappointed to miss \u2014 the canonical experiences that define the place. Err toward fewer iconic flags rather than more \u2014 over-flagging shoehorns; under-flagging at least lets the traveler opt in.\n\n"
    + "COVERAGE: surface a FULL canonical set for the region, not a short list. The user is choosing which items to keep \u2014 don't pre-prune to fit a token budget. The traveler should see the iconic things every first-time visitor would consider, plus enough secondary options to make real choices. For a country-sized region, expect roughly 10\u201316 items spanning all six categories.\n\n"
    + "MULTIPLE SECTIONS PER MAJOR CITY: every major city in the region should appear in MULTIPLE activity sections (e.g. museums, food, historic sites, water/parks, neighborhoods), not just one 'Explore the cities' bucket. A city has many facets; surface each one as its own item under its own section. A city showing only under 'Explore the cities' is a failure mode \u2014 go back and add the missing facets.\n\n"
    + "PD.206 \u2014 DO NOT LIST A DESTINATION AS A REQUIRED PLACE FOR AN ACTIVITY INSIDE THAT DESTINATION. The traveler's list separates destinations (where they stay/visit as stops) from sights (things to do AT a destination). If \"Reykjav\u00edk\" is a destination, do NOT emit \"Reykjav\u00edk\" as a requiredPlace under an activity \u2014 emit the SIGHT (e.g., \"Harpa Concert Hall\", \"Hallgr\u00edmskirkja\") that the activity actually visits. Activities should point at the specific thing the traveler does or sees, not back at the destination itself.\n\n"
    + "DISAMBIGUATION: use the full place name a map service would resolve correctly. Always set the country field. If a name could resolve to two different places in different countries (a town in country A whose name is one letter off from a town in country B, or a landmark whose first word matches an unrelated place), prefer the canonical full form and verify the lat/lng. If you are not certain a name resolves where you think, OMIT the item rather than guess.\n\n"
    + "FACTUAL ACCURACY for named items (routes, trains, hikes, festivals, sights): only include an item if you are confident in its specifics \u2014 endpoints, location, season, schedule. Confidently wrong specifics destroy the traveler's trust in the rest of the output. If you are unsure of the exact endpoints of a named scenic train, the right months for a phenomenon, the right village for a craft, or the right gateway for a national park, OMIT the item. The traveler is better served by a shorter list of correct items than a longer list with mistakes mixed in.\n\n"
    + "PLACES PER ACTIVITY \u2014 better to list many than few. The traveler wants to see options, not commit to a tight set. For a broad activity like \"mountain scenery\" or \"beach time,\" list 4\u20136 places. For a narrower one like \"specific craft\" or \"specific cuisine,\" list 3\u20135 spots. For routes, requiredPlaces is the endpoint pair (and any major intermediate stops on multi-modal circuits).\n\n"
    + "PLACE NAMES \u2014 use the full disambiguating name a map service would resolve correctly. Prefer the canonical landmark form when it could collide with a city of the same first word. If a landmark sits near a town and the town is the actual base for staying, use the town as the requiredPlace; if the landmark IS the requiredPlace, use its full name. Always set the country field correctly \u2014 the geocoder filters by it.\n\n"
    + "OVERNIGHT FLAG \u2014 BE AGGRESSIVE ABOUT FALSE. Every place object (in requiredPlaces, endpoints, viableLocations) MUST include an `overnight` boolean. The default should be FALSE; only mark TRUE for places that are genuinely worth a multi-night base. The traveler will visit overnight:false places as day trips from a nearby hub. A region-sized trip (a country, a state) should yield ~4\u20138 overnight:true bases TOTAL across all activities you generate \u2014 not 15+. Cluster ruthlessly.\n"
    + "  Mark overnight:false for:\n"
    + "    \u2022 Transit-only nodes: cable-car summits, cogwheel termini, scenic viewpoints, ferry terminals.\n"
    + "    \u2022 Small villages or single-attraction towns within ~45min of a larger hub.\n"
    + "    \u2022 Wine villages, craft villages, photography spots that are walking-distance from each other or from a real town \u2014 pick the ONE most logical hub and mark the rest false.\n"
    + "    \u2022 Sister mountain villages in the same valley/cable-car system: pick ONE as the base, mark the rest false.\n"
    + "  Mark overnight:true ONLY for:\n"
    + "    \u2022 Major cities and proven multi-night bases with real lodging, dining, and a useful day-trip radius.\n"
    + "    \u2022 Remote bases that have no closer hub serving a unique area.\n"
    + "  When in doubt, mark FALSE. The downstream code clusters overnight:false places into day trips from the nearest overnight:true base. Marking too many places overnight:true produces a fragmented \"new bed every 1.5 nights\" trip.\n"
    + "  Routes (type=\"route\") may have overnight:false endpoints because routes ARE transit; their endpoints are reached by traveling, not stayed at.\n\n"
    + "NIGHTS PER PLACE \u2014 each entry in requiredPlaces gets a nights field with a sensible default range for doing this activity well at that place. Activities: typical nights to do the activity well there. Routes: 0 (route is transit, not a stay; days are spent at the endpoints). Conditions: nights needed to give the condition a real chance.\n\n"
    + "COORDINATES PER PLACE \u2014 IMPORTANT: every entry in requiredPlaces (and endpoints, viableLocations) MUST include lat and lng fields with the place\u2019s approximate latitude and longitude as numbers. Use 4 decimal places. These coordinates are used to plot the place on a map without external geocoding, so they must be reasonably accurate (within ~5km is fine; do not invent coordinates for places you don\u2019t know \u2014 for those, omit the entire item). Do NOT use 0,0.\n\n"
    + (personalContext || "")
    + "Return ONLY a JSON array (no markdown). Aim for 10\u201316 items for large/varied regions; 8\u201312 for tighter ones. Cover a real range \u2014 don\u2019t silently drop a category. Include routes and condition items whenever they genuinely apply.\n\n"
    + "[\n"
    // SCHEMA EXAMPLES — placeholders, not real content. Names, places,
    // and coordinates are illustrative only; the LLM should replace
    // them with real items for the user's destination. Each row shows
    // one of the three types (activity / route / condition).
    + '  {"name":"<Verb-phrase activity name>","type":"activity","category":"<one of the six categories>","section":"<verb-phrase section header>","description":"<concrete sentence about why this matters>","iconic":<true|false>,"requiredPlaces":[{"place":"<City or landmark>","country":"<Country>","nights":2,"lat":0.0,"lng":0.0,"overnight":true}],"durationHours":4},\n'
    + '  {"name":"<Ride / Walk / Sail / Drive the named route>","type":"route","category":"<closest category>","section":"<verb-phrase section header>","description":"<concrete sentence>","iconic":<true|false>,"endpoints":[{"place":"<Endpoint A>","country":"<Country>","lat":0.0,"lng":0.0,"overnight":true},{"place":"<Endpoint B>","country":"<Country>","lat":0.0,"lng":0.0,"overnight":true}],"requiredPlaces":[{"place":"<Endpoint A>","country":"<Country>","nights":0,"lat":0.0,"lng":0.0,"overnight":true},{"place":"<Endpoint B>","country":"<Country>","nights":0,"lat":0.0,"lng":0.0,"overnight":true}],"direction":"either","durationHours":6,"transportModes":["train"],"modeOptions":"both"},\n'
    + '  {"name":"<Catch the seasonal phenomenon>","type":"condition","category":"scenery-nature","section":"<verb-phrase section header>","description":"<concrete sentence>","viableLocations":[{"place":"<Place>","country":"<Country>","lat":0.0,"lng":0.0,"overnight":true}],"requiredPlaces":[{"place":"<Place>","country":"<Country>","nights":3,"lat":0.0,"lng":0.0,"overnight":true}],"recovery":"moderate","frequencyRequirement":3,"conditionNote":"<what depends on this>"}\n'
    + "]\n\n"
    + "CRITICAL: requiredPlaces, endpoints, and viableLocations are ARRAYS OF OBJECTS. Each needs: place (string), country (string), nights (number on requiredPlaces; 0 for routes/transit), lat/lng (4 decimals), AND overnight (boolean \u2014 true for real overnight bases, false for transit-only summits / cable-car endpoints). Even for a single-country place, always include country, coordinates, and overnight.\n\n"
    + "CATEGORIES: every item also gets a `category` field, one of: \"outdoors-active\", \"scenery-nature\", \"culture-history\", \"food-drink\", \"connection-gatherings\", \"wellness-growth\". Pick the closest fit. If genuinely none fit, pick the closest \u2014 do NOT invent new categories. Users can manually re-add anything we miss.";
  return prompt;
  }

  // PD.404 (#80): the THEMING pass prompt. Runs AFTER generation, mirroring
  // the completeness pass: it hands the model the traveler's listed places
  // plus the sections generation already produced, and asks ONLY for a
  // section/category assignment per listed place. Output is one compact
  // object per place (no descriptions, no nights, no endpoints), so even a
  // 40-place list stays well inside the token budget and nothing is dropped.
  //   opts: { place, ctx, userList:[displayName,...], sections:[name,...],
  //           categories?:[id,...] }
  var _SIX_CATEGORIES = ["outdoors-active", "scenery-nature", "culture-history",
    "food-drink", "connection-gatherings", "wellness-growth"];
  function buildThemingPrompt(opts){
    opts = opts || {};
    var place      = opts.place || "";
    var ctx        = opts.ctx || "";
    var userList   = opts.userList || [];
    var sections   = opts.sections || [];
    var categories = opts.categories || _SIX_CATEGORIES;
    var _targetThemes = Math.max(4, Math.min(8, Math.round((userList.length || 0) / 4) + (sections.length || 0)));
    return "A traveler is planning a trip to " + place + ".\n"
      + (ctx ? "Their context: " + ctx + "\n" : "")
      + "\nThey listed these specific places they want included in the trip:\n"
      + userList.map(function(p){ return "  - " + p; }).join("\n") + "\n\n"
      + "I have already organized the rest of the trip into these themed sections:\n"
      + (sections.length ? sections.map(function(s){ return "  - " + s; }).join("\n") : "  (no sections yet)") + "\n\n"
      + "This is a SORTING task, not a generation task. Sort EVERY listed place into a themed section so I can file it alongside the rest of the trip.\n"
      + "  - COVER EVERY PLACE. Return EXACTLY one entry per listed place — no more, no fewer. Every place above MUST appear in your output. Do NOT add places the traveler didn't list. Do NOT drop any.\n"
      + "  - USE FEW, BROAD THEMES. Reuse the sections above wherever they fit; only invent a new section when several places need it. Aim for about " + _targetThemes + " themes TOTAL across everything — group similar places into the SAME theme (e.g. ALL waterfalls under one \"Chase waterfalls,\" ALL museums/landmarks under one \"Explore culture & history\"). Do NOT create a separate one-place theme for each sight — that is the main failure to avoid.\n"
      + "  - A good theme holds 3+ places. If you're about to put a single place in its own theme, find the broader theme it shares with others instead.\n"
      + "  - Keep the place name EXACTLY as the traveler wrote it (so I can match it back).\n\n"
      + "Return ONLY a JSON array (no markdown), one object per listed place:\n"
      + '[{"place":"<exact listed place>","section":"<broad theme name>","category":"<one of the six>","iconic":false,"lat":0.0,"lng":0.0,"country":"<country>"}]\n\n'
      + "Categories: " + categories.join(", ") + ".\n"
      + "Coordinates: 4 decimals, accurate within ~5km; use 0,0 only if you genuinely don't know the place. Set iconic:true only for a place a first-time visitor would be disappointed to miss.";
  }

  var api = { build: build, detectCompleteness: detectCompleteness, buildThemingPrompt: buildThemingPrompt };
  global.MaxGenPrompt = api;

export default api;

/* #2 Stage 2 interim: expose this module's non-colliding top-level bindings
   as globals (restores pre-ESM flat-script behavior for bare-global + window.*
   consumers, incl. app-main.js boot refs). esbuild isolates each .mjs to an IIFE;
   any-cast keeps it tsc-valid; the import-rewiring phase removes this. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._completenessRe = _completenessRe;
  __expg.detectCompleteness = detectCompleteness;
  __expg._SIX_CATEGORIES = _SIX_CATEGORIES;
  __expg.buildThemingPrompt = buildThemingPrompt;
}
