// v356.4: server-side port of engine-trip.js's computePendingActions.
//
// Why a port and not a shared module: engine-trip.js is a browser
// IIFE that hangs everything off `window` and `global.MaxEngineTrip`.
// Bundling that into a Workers TS build would drag in db.js, picker
// state, etc. The pure helper itself is small and stable enough that
// a hand-port is cheaper than the build plumbing.
//
// Contract MUST stay byte-equivalent with the browser version. If
// you change the rules, change BOTH this file and engine-trip.js
// → MaxEngineTrip.computePendingActions, and re-run
// `node tests/engine-tests.js`.

export type PendingItem = {
  kind: 'hotel' | 'transport' | 'daytrip' | 'pending' | 'sights';
  summary: string;
  severity: 'high' | 'medium' | 'low';
};

export type PendingActions = {
  daysUntilDeparture: number | null;
  items: PendingItem[];
};

// The trip body is opaque JSON on the server side; we type it loosely
// and access fields defensively. This mirrors what engine-trip.js does.
type LooseTrip = {
  destinations?: Array<{
    id?: string;
    place?: string;
    label?: string;
    nights?: number;
    dateFrom?: string;
    hotelBookings?: Array<{ status?: string }>;
    dayTrips?: Array<{
      place?: string;
      name?: string;
      n?: string;
      note?: string;
      booking?: unknown;
      bookings?: unknown[];
    }>;
    suggestions?: Array<{ iconic?: boolean; approx?: boolean }>;
  }>;
  legs?: Record<string, { mode?: string }>;
  pendingActions?: Array<{
    cleared?: boolean;
    actionType?: string;
    eventName?: string;
    name?: string;
  }>;
};

export function computePendingActions(
  trip: LooseTrip | null | undefined,
  now: Date = new Date(),
): PendingActions {
  const dests = (trip && trip.destinations) || [];

  let daysUntilDeparture: number | null = null;
  const first = dests[0];
  const firstFrom = first && first.dateFrom;
  if (firstFrom) {
    const depDate = new Date(firstFrom);
    if (!isNaN(depDate.getTime())) {
      daysUntilDeparture = Math.floor((depDate.getTime() - now.getTime()) / 86400000);
    }
  }

  const items: PendingItem[] = [];

  // Hotel gaps
  for (const dest of dests) {
    if (!dest) continue;
    const nights = typeof dest.nights === 'number' ? dest.nights : 0;
    if (nights < 1) continue;
    const bks = Array.isArray(dest.hotelBookings) ? dest.hotelBookings : [];
    const hasBooked = bks.some((b) => b && b.status === 'booked');
    if (!hasBooked) {
      const place = dest.place || dest.label || 'unknown';
      items.push({
        kind: 'hotel',
        summary: `Book hotel for ${place} (${nights} night${nights === 1 ? '' : 's'})`,
        severity: 'high',
      });
    }
  }

  // Transport gaps
  const legs = (trip && trip.legs) || {};
  for (let i = 0; i < dests.length - 1; i++) {
    const from = dests[i];
    const to = dests[i + 1];
    if (!from || !to) continue;
    const key = `${from.id || ''}>${to.id || ''}`;
    const leg = legs[key];
    if (!leg || !leg.mode) {
      items.push({
        kind: 'transport',
        summary: `Plan how to get from ${from.place || from.label || 'previous'} to ${to.place || to.label || 'next'}`,
        severity: 'high',
      });
    }
  }

  // Day-trip arrangements
  for (const dest of dests) {
    if (!dest) continue;
    const dts = Array.isArray(dest.dayTrips) ? dest.dayTrips : [];
    for (const dt of dts) {
      if (!dt) continue;
      const hasNote = !!(dt.note && String(dt.note).trim().length);
      const hasBooking = !!(dt.booking || (Array.isArray(dt.bookings) && dt.bookings.length));
      if (!hasNote && !hasBooking) {
        const dtName = dt.place || dt.name || dt.n || 'destination';
        const hub = dest.place || dest.label || 'hub';
        items.push({
          kind: 'daytrip',
          summary: `Arrange day trip to ${dtName} from ${hub}`,
          severity: 'medium',
        });
      }
    }
  }

  // Open pending actions
  const pending = (trip && Array.isArray(trip.pendingActions)) ? trip.pendingActions : [];
  for (const pa of pending) {
    if (!pa || pa.cleared) continue;
    const actionType = pa.actionType || 'review';
    const eventName = pa.eventName || pa.name || 'item';
    items.push({
      kind: 'pending',
      summary: `${actionType.charAt(0).toUpperCase() + actionType.slice(1)} — ${eventName}`,
      severity: 'high',
    });
  }

  // Iconic+approx sights bundle
  let approxIconic = 0;
  for (const dest of dests) {
    if (!dest) continue;
    const sugs = Array.isArray(dest.suggestions) ? dest.suggestions : [];
    for (const s of sugs) {
      if (s && s.iconic && s.approx) approxIconic++;
    }
  }
  if (approxIconic > 0) {
    items.push({
      kind: 'sights',
      summary: `${approxIconic} must-see sight${approxIconic === 1 ? '' : 's'} still missing an address`,
      severity: 'low',
    });
  }

  // Stable sort: severity then kind
  const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => {
    const da = sevRank[a.severity] ?? 99;
    const db = sevRank[b.severity] ?? 99;
    if (da !== db) return da - db;
    if (a.kind < b.kind) return -1;
    if (a.kind > b.kind) return 1;
    return 0;
  });

  return { daysUntilDeparture, items };
}
