// helpers/seed-trip.js — pre-built trip seeds for tests.
//
// Loading via the picker requires the LLM. For tests that exercise
// trip-view behavior (mutators, rendering, day-trip placement on
// existing chips), we skip the picker entirely and inject a finished
// trip directly into localStorage via the same envelope shape that
// `serializeTrip()` produces. The app loads it on next navigation.
//
// Each seed is a function returning { id, envelope }. The envelope
// matches what MaxDB.trip.write expects:
//   { trip, activeDest, destCtr, sidCtr, bkCtr, activeDmSection }
//
// Add new seeds here as test scenarios need them. Keep them small —
// just enough destinations / days to exercise the behavior under test.

const ICELAND_RING = (() => {
  const tripId = 'pw-iceland-' + Date.now();
  const trip = {
    name: 'Iceland Test Trip',
    destinations: [
      {
        id: 'd1',
        place: 'Reykjavik',
        intent: 'Capital + Golden Circle base',
        nights: 3,
        lat: 64.14, lng: -21.94,
        dateFrom: '2026-08-01', dateTo: '2026-08-04',
        days: [
          { id: 'dy_d1_0', lbl: 'Aug 1', note: 'arrival', items: [] },
          { id: 'dy_d1_1', lbl: 'Aug 2', note: '', items: [] },
          { id: 'dy_d1_2', lbl: 'Aug 3', note: '', items: [] },
        ],
        suggestions: [],
        restaurantSuggestions: [],
        hotelBookings: [], generalBookings: [], locations: [],
        execMode: false, todayItems: [], discoveredItems: [],
        attachedEvents: [],
        trackerItems: { booked: [], see: [], visited: [] },
        trackerCat: 'booked',
        storyState: 'idle',
      },
      {
        id: 'd2',
        place: 'Vik',
        intent: 'South coast — black sand beach + Reynisfjara',
        nights: 2,
        lat: 63.42, lng: -19.01,
        dateFrom: '2026-08-04', dateTo: '2026-08-06',
        days: [
          { id: 'dy_d2_0', lbl: 'Aug 4', note: '', items: [] },
          { id: 'dy_d2_1', lbl: 'Aug 5', note: '', items: [] },
        ],
        suggestions: [],
        restaurantSuggestions: [],
        hotelBookings: [], generalBookings: [], locations: [],
        execMode: false, todayItems: [], discoveredItems: [],
        attachedEvents: [],
        trackerItems: { booked: [], see: [], visited: [] },
        trackerCat: 'booked',
        storyState: 'idle',
      },
      {
        id: 'd3',
        place: 'Höfn',
        intent: 'Glacier lagoon + east coast',
        nights: 2,
        lat: 64.25, lng: -15.20,
        dateFrom: '2026-08-06', dateTo: '2026-08-08',
        days: [
          { id: 'dy_d3_0', lbl: 'Aug 6', note: '', items: [] },
          { id: 'dy_d3_1', lbl: 'Aug 7', note: '', items: [] },
        ],
        suggestions: [],
        restaurantSuggestions: [],
        hotelBookings: [], generalBookings: [], locations: [],
        execMode: false, todayItems: [], discoveredItems: [],
        attachedEvents: [],
        trackerItems: { booked: [], see: [], visited: [] },
        trackerCat: 'booked',
        storyState: 'idle',
      },
    ],
    legs: {},
    candidates: [],
    pendingActions: [],
    brief: { region: 'Iceland', when: 'August 2026', duration: '7 nights' },
    trackSpending: false,
  };
  return {
    id: tripId,
    envelope: {
      trip,
      activeDest: 'd1',
      destCtr: 3,
      sidCtr: 100,
      bkCtr: 0,
      activeDmSection: 'sights',
    },
  };
})();

module.exports = {
  ICELAND_RING,
};
