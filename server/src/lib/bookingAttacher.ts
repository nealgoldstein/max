// Booking attacher — given a parsed booking from pending_emails,
// figure out which of the user's trips it belongs to and push it
// into that trip's body. Falls back to "unassigned" (no trip_id
// recorded) if no clear match.
//
// Design:
//   - Run AFTER the LLM parser succeeds. Called from emailParser
//     once parse_status flips to 'parsed' and parsedJson is set.
//   - Match a trip by date overlap (booking.depDate within
//     trip.dateFrom..trip.dateTo). If exactly one trip qualifies →
//     attach. If multiple → leave unassigned (user picks via the
//     Profile tray we'll build in Chunk 6).
//   - Once matched to a trip, the booking lands in the same shape
//     Phase 1's client-side save paths produce:
//       car      → trip.body.tripBookings[]
//       flight   → trip.body.tripBookings[] (legs treated separately,
//                  Phase 1b)
//       hotel    → destination.hotelBookings[] for the best-matching
//                  destination (by date overlap)
//       restaurant / tour / ticket / etc. → destination.generalBookings[]
//   - Modifies trip.body in place, writes it back via Drizzle.

import { eq } from 'drizzle-orm';
import { initDb } from '../db/client.js';
import * as schema from '../db/schema.js';
import { randomUUID } from 'node:crypto';

type Env = {
  TURSO_URL: string;
  TURSO_AUTH_TOKEN: string;
};

interface Booking {
  type?: string;
  carrier?: string | null;
  name?: string | null;
  address?: string | null;
  from?: string | null;
  to?: string | null;
  depDate?: string | null;
  depTime?: string | null;
  arrDate?: string | null;
  arrTime?: string | null;
  confirmationNumber?: string | null;
  price?: number | null;
  currency?: string | null;
  url?: string | null;
  cancelType?: string | null;
  cancelDeadline?: string | null;
  notes?: string | null;
  number?: string | null;
}

interface Destination {
  id?: string;
  place?: string;
  label?: string;
  dateFrom?: string;
  dateTo?: string;
  hotelBookings?: unknown[];
  generalBookings?: unknown[];
}

interface TripBody {
  destinations?: Destination[];
  tripBookings?: unknown[];
  brief?: { startDate?: string; endDate?: string };
  dateFrom?: string;
  dateTo?: string;
}

// The trips.body column wraps the actual trip in `{trip: {...}}`.
// This helper unwraps to the inner object, falling back to the raw
// body if there's no wrapper (older data shape). Both reads and
// writes should go through this.
function _unwrap(body: unknown): TripBody {
  if (!body || typeof body !== 'object') return {} as TripBody;
  const b = body as { trip?: TripBody };
  return (b.trip || (body as TripBody));
}

// v359.60.95: look up whether an existing booking on this trip has
// the same (kind, confirmationNumber). Returns the colliding
// booking's id (string) if found, otherwise null. Used to dedupe at
// attach time so re-forwarded emails don't pile up duplicates.
//
// Walks all three buckets a booking might live in:
//   - trip.tripBookings[]              (top-level: flights, cars)
//   - destinations[i].hotelBookings[]
//   - destinations[i].generalBookings[]
//
// kind matching: 'flight' / 'car' / 'hotel' all match record.kind
// directly. Other types are stored on generalBookings with .type
// instead of .kind, so we match against either field.
function _hasBookingWithSameConfirmation(
  unwrapped: TripBody,
  type: string,
  confirmation: string,
): string | null {
  const want = confirmation.trim().toLowerCase();
  if (!want) return null;

  function _matches(b: Record<string, unknown> | unknown): string | null {
    if (!b || typeof b !== 'object') return null;
    const rec = b as Record<string, unknown>;
    const conf = typeof rec.confirmationNumber === 'string' ? rec.confirmationNumber.trim().toLowerCase() : '';
    if (conf !== want) return null;
    const kind = (rec.kind as string) || (rec.type as string) || '';
    if (kind !== type) return null;
    return (rec.id as string) || '';
  }

  const tripBookings = Array.isArray(unwrapped.tripBookings) ? unwrapped.tripBookings : [];
  for (const b of tripBookings) {
    const hit = _matches(b);
    if (hit) return hit;
  }
  const dests = Array.isArray(unwrapped.destinations) ? unwrapped.destinations : [];
  for (const d of dests) {
    const hotels = Array.isArray(d?.hotelBookings) ? d.hotelBookings : [];
    for (const b of hotels) {
      const hit = _matches(b);
      if (hit) return hit;
    }
    const generals = Array.isArray(d?.generalBookings) ? d.generalBookings : [];
    for (const b of generals) {
      const hit = _matches(b);
      if (hit) return hit;
    }
  }
  return null;
}

// Return the trip's start/end dates from whichever shape they live
// on. Different vintages of trip data put them in different places.
// Current shape (v359+): dates live on the FIRST destination's
// dateFrom and the LAST destination's dateTo. Older shapes may use
// trip.brief.startDate / trip.dateFrom / etc.
function _tripDateRange(unwrapped: TripBody): { from: string | null; to: string | null } {
  let from: string | null =
    (unwrapped.brief && unwrapped.brief.startDate) ||
    unwrapped.dateFrom ||
    null;
  let to: string | null =
    (unwrapped.brief && unwrapped.brief.endDate) ||
    unwrapped.dateTo ||
    null;
  if ((!from || !to) && Array.isArray(unwrapped.destinations) && unwrapped.destinations.length) {
    const dests = unwrapped.destinations;
    const first = dests[0];
    const last = dests[dests.length - 1];
    if (first) from = from || first.dateFrom || null;
    if (last)  to   = to   || last.dateTo   || null;
  }
  return { from, to };
}

// Date overlap: does `d` fall within `from`..`to` (inclusive)? All
// strings are YYYY-MM-DD; lexicographic comparison works.
function _dateInRange(d: string | null | undefined, from: string | null, to: string | null): boolean {
  if (!d || !from || !to) return false;
  return d >= from && d <= to;
}

// Find the destination within the trip whose date range covers the
// booking's depDate. Used for hotels + general bookings that anchor
// to a specific destination. Returns the destination index, or -1.
function _findDestForBooking(unwrapped: TripBody, bk: Booking): number {
  if (!Array.isArray(unwrapped.destinations)) return -1;
  for (let i = 0; i < unwrapped.destinations.length; i++) {
    const d = unwrapped.destinations[i];
    if (!d) continue;
    if (_dateInRange(bk.depDate, d.dateFrom || null, d.dateTo || null)) {
      return i;
    }
  }
  if (bk.address || bk.from) {
    const needle = ((bk.address || '') + ' ' + (bk.from || '')).toLowerCase();
    for (let i = 0; i < unwrapped.destinations.length; i++) {
      const d = unwrapped.destinations[i];
      if (!d) continue;
      const placeName = String(d.place || d.label || '').toLowerCase();
      if (placeName && needle.indexOf(placeName) >= 0) return i;
    }
  }
  return -1;
}

// Build the booking record in the same shape Phase 1's client-side
// save paths produce. Different shape per type so the existing
// renderers display them correctly without changes.
function _buildBookingRecord(bk: Booking, source: string): Record<string, unknown> {
  const id = 'bk-' + randomUUID();
  const cancelType = bk.cancelType || 'unknown';
  const cancelDeadline = bk.cancelType === 'deadline' ? bk.cancelDeadline || null : null;

  if (bk.type === 'car') {
    return {
      id,
      kind: 'car',
      vendor: bk.carrier || '',
      pickup: {
        location: bk.from || '',
        date: bk.depDate || null,
        time: bk.depTime || null,
      },
      dropoff: {
        location: bk.to || bk.from || '',
        date: bk.arrDate || null,
        time: bk.arrTime || null,
      },
      confirmationNumber: bk.confirmationNumber || '',
      pricePaid: typeof bk.price === 'number' ? bk.price : null,
      currency: bk.currency || 'USD',
      notes: bk.notes || '',
      url: bk.url || null,
      status: 'booked',
      source,
      cancelType,
      cancelDeadline,
      cancelDeadlineTime: null,
    };
  }
  if (bk.type === 'flight') {
    // v360.0.1: multi-leg support. If the LLM returned a legs[]
    // array, use it directly; otherwise build a single-leg from the
    // flat carrier/from/to/depDate/etc. fields.
    const parsedLegs = (bk as Record<string, unknown>).legs;
    const legs = Array.isArray(parsedLegs) && parsedLegs.length
      ? (parsedLegs as Array<Record<string, unknown>>).map((lg) => ({
          from:         (lg.from as string) || '',
          to:           (lg.to as string) || '',
          depDate:      (lg.depDate as string) || null,
          depTime:      (lg.depTime as string) || null,
          arrDate:      (lg.arrDate as string) || null,
          arrTime:      (lg.arrTime as string) || null,
          carrier:      (lg.carrier as string) || '',
          flightNumber: (lg.flightNumber as string) || (lg.number as string) || '',
        }))
      : [{
          from: bk.from || '',
          to: bk.to || '',
          depDate: bk.depDate || null,
          depTime: bk.depTime || null,
          arrDate: bk.arrDate || null,
          arrTime: bk.arrTime || null,
          carrier: bk.carrier || '',
          flightNumber: bk.number || '',
        }];
    return {
      id,
      kind: 'flight',
      legs,
      confirmationNumber: bk.confirmationNumber || '',
      pricePaid: typeof bk.price === 'number' ? bk.price : null,
      currency: bk.currency || 'USD',
      notes: bk.notes || '',
      url: bk.url || null,
      status: 'booked',
      source,
      cancelType,
      cancelDeadline,
      cancelDeadlineTime: null,
    };
  }
  if (bk.type === 'hotel') {
    return {
      id,
      name: bk.name || bk.carrier || 'Untitled hotel',
      area: '',
      checkIn: bk.depDate || null,
      checkInTime: bk.depTime || null,
      checkOut: bk.arrDate || null,
      checkOutTime: bk.arrTime || null,
      confirmationNumber: bk.confirmationNumber || '',
      pricePaid: typeof bk.price === 'number' ? bk.price : null,
      currency: bk.currency || 'USD',
      notes: (bk.notes || '') + (bk.address ? '\nAddress: ' + bk.address : ''),
      url: bk.url || null,
      status: 'booked',
      source,
      cancelType,
      cancelDeadline,
      cancelDeadlineTime: null,
      lat: null,
      lng: null,
    };
  }
  // generalBookings shape — restaurant / tour / ticket / unknown
  return {
    id,
    type: bk.type || 'ticket',
    label: bk.name || 'Untitled booking',
    date: bk.depDate || null,
    time: bk.depTime || null,
    timeEnd: bk.arrTime || null,
    confirmationNumber: bk.confirmationNumber || '',
    pricePaid: typeof bk.price === 'number' ? bk.price : null,
    currency: bk.currency || 'USD',
    notes: (bk.notes || '') + (bk.address ? '\nLocation: ' + bk.address : ''),
    url: bk.url || null,
    status: 'booked',
    source,
    cancelType,
    cancelDeadline,
    cancelDeadlineTime: null,
  };
}

// Main entry. Returns { tripId, bookingId } when attached, or
// { tripId: null, bookingId: null } when left unassigned.
export async function attachBookingToTrip(
  env: Env,
  userId: string,
  parsed: Booking,
): Promise<{ tripId: string | null; bookingId: string | null; reason: string }> {
  const db = initDb({
    TURSO_URL: env.TURSO_URL,
    TURSO_AUTH_TOKEN: env.TURSO_AUTH_TOKEN,
  });

  // Skip if the LLM couldn't classify.
  if (!parsed.type || parsed.type === 'unknown') {
    return { tripId: null, bookingId: null, reason: 'unknown-type' };
  }
  // Need at least a date to match a trip.
  if (!parsed.depDate) {
    return { tripId: null, bookingId: null, reason: 'no-date' };
  }

  // Pull this user's trips.
  const trips = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.userId, userId))
    .all();

  // v359.60.96: leg-aware trip matching. Multi-leg flights (one PNR,
  // multiple separate segments) can legitimately belong to more than
  // one trip — e.g., a US-Switzerland-Iceland itinerary where the
  // first leg ends in a Switzerland trip and the second leg ends in
  // an Iceland trip. Before this change, we only checked
  // parsed.depDate (the FIRST leg) against trip date ranges, so the
  // booking always attached to whichever trip contained that one
  // date, even when later legs belonged elsewhere.
  //
  // New behavior:
  //   - Collect every leg's depDate (fall back to parsed.depDate for
  //     non-flight bookings or when legs aren't surfaced).
  //   - For each candidate date, find every trip whose date range
  //     contains it. Union the matches across all dates.
  //   - 0 trips → unassigned (no-match).
  //   - 1+ trips → MIRROR the booking onto each: same bookingId on
  //     every trip's tripBookings[], so the user sees "the same PNR
  //     is on both your Switzerland and Iceland trips" rather than
  //     two distinct booking records to reconcile.
  //
  // Hotels and general bookings don't have legs[], so the candidate
  // search is unchanged for them — still uses parsed.depDate.
  // Multiple-trip matches on hotels/general are still ambiguous and
  // bail with 'multiple-matches'.

  // Gather depDates to test. For flights, prefer legs[] when present.
  const legs = Array.isArray((parsed as Record<string, unknown>).legs)
    ? ((parsed as Record<string, unknown>).legs as Array<Record<string, unknown>>)
    : null;
  const depDatesToCheck: string[] = [];
  if (parsed.type === 'flight' && legs && legs.length) {
    for (const lg of legs) {
      const d = (lg.depDate as string) || '';
      if (d && depDatesToCheck.indexOf(d) === -1) depDatesToCheck.push(d);
    }
  }
  if (depDatesToCheck.length === 0 && parsed.depDate) {
    depDatesToCheck.push(parsed.depDate);
  }

  // Find all trips whose date range contains ANY of the candidate
  // depDates. De-duped by trip id so a trip whose range covers two
  // legs only shows up once.
  const matchedTripIds = new Set<string>();
  const candidates: Array<{ trip: typeof trips[number]; rawBody: unknown; unwrapped: TripBody }> = [];
  for (const trip of trips) {
    const rawBody = trip.body || {};
    const unwrapped = _unwrap(rawBody);
    const range = _tripDateRange(unwrapped);
    for (const d of depDatesToCheck) {
      if (_dateInRange(d, range.from, range.to)) {
        if (!matchedTripIds.has(trip.id)) {
          matchedTripIds.add(trip.id);
          candidates.push({ trip, rawBody, unwrapped });
        }
        break;
      }
    }
  }

  if (candidates.length === 0) {
    console.log(
      '[attacher] no trip matched any of depDates=[' + depDatesToCheck.join(',') + '] for user=' + userId,
    );
    return { tripId: null, bookingId: null, reason: 'no-match' };
  }

  // For hotels and general bookings, multiple-match is still
  // ambiguous (we don't have legs to disambiguate). Keep the
  // existing safe behavior.
  if (parsed.type !== 'flight' && candidates.length > 1) {
    console.log(
      '[attacher] multiple trips matched (' + candidates.length + ') — leaving unassigned (non-flight)',
    );
    return { tripId: null, bookingId: null, reason: 'multiple-matches' };
  }

  // Generate the booking record ONCE, then push the SAME record onto
  // every matching trip's tripBookings[]. The shared id makes it
  // obvious to UI surfaces (and any future "show me where this PNR
  // appears" query) that these are mirrors of the same PNR, not two
  // distinct bookings the user has to reconcile.
  const record = _buildBookingRecord(parsed, 'email-forward');
  const bookingId = record.id as string;

  const attachedTo: string[] = [];
  const skippedDuplicateOn: string[] = [];
  for (const cand of candidates) {
    const { trip, rawBody, unwrapped } = cand;

    // Per-trip same-confirmation dedupe. Re-forwards of the same
    // email would otherwise mint a fresh bk-... id and pile on
    // another copy. (See v359.60.95 — Iceland trip ended up with 7
    // copies of BP8P5W before this check landed.)
    if (parsed.confirmationNumber && parsed.type) {
      const conf = parsed.confirmationNumber.trim();
      const collides = _hasBookingWithSameConfirmation(unwrapped, parsed.type, conf);
      if (collides) {
        console.log(
          '[attacher] duplicate skipped on trip', trip.id,
          '— already has', parsed.type, 'with confirmation=' + conf,
        );
        skippedDuplicateOn.push(trip.id);
        continue;
      }
    }

    if (parsed.type === 'car' || parsed.type === 'flight') {
      if (!Array.isArray(unwrapped.tripBookings)) unwrapped.tripBookings = [];
      unwrapped.tripBookings.push(record);
    } else if (parsed.type === 'hotel') {
      const destIdx = _findDestForBooking(unwrapped, parsed);
      if (destIdx < 0) {
        console.log('[attacher] hotel parsed but no destination match — leaving unassigned');
        return { tripId: null, bookingId: null, reason: 'no-destination-match' };
      }
      const dest = unwrapped.destinations![destIdx];
      if (!dest) return { tripId: null, bookingId: null, reason: 'no-destination-match' };
      if (!Array.isArray(dest.hotelBookings)) dest.hotelBookings = [];
      dest.hotelBookings.push(record);
    } else {
      const destIdx = _findDestForBooking(unwrapped, parsed);
      if (destIdx < 0) {
        console.log('[attacher] general booking parsed but no destination match — leaving unassigned');
        return { tripId: null, bookingId: null, reason: 'no-destination-match' };
      }
      const dest = unwrapped.destinations![destIdx];
      if (!dest) return { tripId: null, bookingId: null, reason: 'no-destination-match' };
      if (!Array.isArray(dest.generalBookings)) dest.generalBookings = [];
      dest.generalBookings.push(record);
    }

    // Write back. Same re-wrap dance as before.
    const toWrite = (rawBody && typeof rawBody === 'object' && 'trip' in (rawBody as object))
      ? rawBody
      : unwrapped;
    await db
      .update(schema.trips)
      .set({ body: toWrite as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(schema.trips.id, trip.id))
      .run();

    // Verify the write landed.
    const verifyRow = await db
      .select()
      .from(schema.trips)
      .where(eq(schema.trips.id, trip.id))
      .get();
    const verifyBody = verifyRow && verifyRow.body ? _unwrap(verifyRow.body) : null;
    const verifyTb = (verifyBody && Array.isArray(verifyBody.tripBookings))
      ? (verifyBody.tripBookings as Array<{ id?: string }>)
      : [];
    const verifyFound = verifyTb.some((b) => b && b.id === bookingId);

    console.log(
      '[attacher] attached',
      bookingId,
      'type=' + parsed.type,
      'to trip=' + trip.id,
      'user=' + userId,
      'verify=' + (verifyFound ? 'present' : 'MISSING'),
      'tripBookings.length=' + verifyTb.length,
    );

    attachedTo.push(trip.id);
  }

  if (attachedTo.length === 0) {
    // Every candidate trip already had this booking. Return the most
    // recent skip's tripId so callers have something useful to point
    // at, but flag as duplicate.
    return {
      tripId: skippedDuplicateOn[0] || null,
      bookingId,
      reason: 'duplicate',
    };
  }

  if (attachedTo.length > 1) {
    console.log(
      '[attacher] mirrored booking', bookingId, 'across', attachedTo.length, 'trips:',
      attachedTo.join(', '),
    );
  }

  return {
    tripId: attachedTo[0]!,
    bookingId,
    reason: attachedTo.length > 1 ? 'attached-mirrored' : 'attached',
  };
}
