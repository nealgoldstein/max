// User inbox API — endpoints powering Phase 2's email auto-import
// UI on the Profile page.
//
// Endpoints:
//   GET    /user/inbox                       — current user's inbox token + last-received timestamp.
//                                              Mints a token on first call if none exists.
//   POST   /user/inbox/rotate                — generate a fresh token, invalidate the old one.
//                                              Useful if the user's address leaks (spam, etc.).
//   GET    /user/unassigned-bookings         — list parsed emails not yet attached to a trip.
//   POST   /user/unassigned-bookings/:id/attach  { tripId, destinationId? }
//                                              user-chosen attach for a parsed booking.
//   POST   /user/unassigned-bookings/:id/dismiss — mark a parsed email ignored so it
//                                                  stops appearing in the tray.

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '../db/client.js';
import { requireAuth, type AuthContext } from '../lib/auth.js';

const inboxApi = new Hono<AuthContext>();
inboxApi.use('*', requireAuth);

// Generate a short, URL-safe token. 8 chars from a-z0-9 is ~36^8 =
// 2.8 trillion — non-guessable enough that an attacker can't bulk-
// spray addresses to inject bookings into random users' accounts.
function _mintToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// Build the full forwarding address — clients display it but don't
// hardcode the domain anywhere. If we ever swap domains, this
// changes in one place.
function _addressFor(token: string): string {
  return 'bookings+' + token + '@travelingwithmax.app';
}

// GET /user/inbox — return current token + freshness indicator.
// Lazy-creates the row on first call so the client doesn't need a
// separate "claim my inbox" call.
inboxApi.get('/inbox', async (c) => {
  const user = c.get('user');
  let row = await db
    .select()
    .from(schema.userInboxes)
    .where(eq(schema.userInboxes.userId, user.id))
    .get();
  if (!row) {
    const token = _mintToken();
    await db.insert(schema.userInboxes).values({ userId: user.id, inboxToken: token }).run();
    row = await db
      .select()
      .from(schema.userInboxes)
      .where(eq(schema.userInboxes.userId, user.id))
      .get();
  }
  if (!row) return c.json({ error: 'failed to provision inbox' }, 500);
  return c.json({
    inboxToken: row.inboxToken,
    address: _addressFor(row.inboxToken),
    lastReceivedAt: row.lastReceivedAt ? row.lastReceivedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
  });
});

// POST /user/inbox/rotate — mint a new token. Used when the
// existing address has been compromised (spam, leaked). The OLD
// address will start rejecting emails immediately because the
// Email Worker validates against the live token.
inboxApi.post('/inbox/rotate', async (c) => {
  const user = c.get('user');
  const newToken = _mintToken();
  // UPSERT: insert if missing, otherwise overwrite the token.
  const existing = await db
    .select()
    .from(schema.userInboxes)
    .where(eq(schema.userInboxes.userId, user.id))
    .get();
  if (!existing) {
    await db.insert(schema.userInboxes).values({ userId: user.id, inboxToken: newToken }).run();
  } else {
    await db
      .update(schema.userInboxes)
      .set({ inboxToken: newToken })
      .where(eq(schema.userInboxes.userId, user.id))
      .run();
  }
  return c.json({ inboxToken: newToken, address: _addressFor(newToken) });
});

// GET /user/unassigned-bookings — parsed emails that haven't been
// auto-attached to a trip. The client renders these as a tray on
// the Profile page where the user picks a trip + destination.
inboxApi.get('/unassigned-bookings', async (c) => {
  const user = c.get('user');
  // Find this user's inbox token, then pull pending_emails for it
  // where parse_status='parsed' AND trip_id IS NULL.
  const inbox = await db
    .select()
    .from(schema.userInboxes)
    .where(eq(schema.userInboxes.userId, user.id))
    .get();
  if (!inbox) return c.json({ unassigned: [] });
  const rows = await db
    .select()
    .from(schema.pendingEmails)
    .where(
      and(
        eq(schema.pendingEmails.inboxToken, inbox.inboxToken),
        eq(schema.pendingEmails.parseStatus, 'parsed'),
        isNull(schema.pendingEmails.tripId),
      ),
    )
    .all();
  return c.json({
    unassigned: rows.map((r) => ({
      id: r.id,
      from: r.fromAddress,
      subject: r.subject,
      receivedAt: r.receivedAt.getTime(),
      parsed: r.parsedJson,
    })),
  });
});

// POST /user/unassigned-bookings/:id/attach
// Body: { tripId, destinationId? }
// Manually attach a parsed booking to a user-chosen trip (+ optional
// destination for hotels / general bookings). Same insertion logic
// as the auto-attacher but trusts the user's choice over date matching.
const attachSchema = z.object({
  tripId: z.string().min(1),
  destinationId: z.string().optional(),
});
inboxApi.post('/unassigned-bookings/:id/attach', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = attachSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'tripId required' }, 400);
  }
  const { tripId, destinationId } = parsed.data;

  // Validate the row exists, belongs to this user (via inbox token),
  // and is still in 'parsed' status.
  const row = await db
    .select()
    .from(schema.pendingEmails)
    .where(eq(schema.pendingEmails.id, id))
    .get();
  if (!row) return c.json({ error: 'not found' }, 404);
  const inbox = await db
    .select()
    .from(schema.userInboxes)
    .where(eq(schema.userInboxes.userId, user.id))
    .get();
  if (!inbox || row.inboxToken !== inbox.inboxToken) {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (row.parseStatus !== 'parsed') {
    return c.json({ error: 'booking not in parsed state' }, 409);
  }
  if (!row.parsedJson) {
    return c.json({ error: 'booking has no parsed data' }, 409);
  }

  // Load the target trip and verify ownership.
  const trip = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.id, tripId))
    .get();
  if (!trip || trip.userId !== user.id) {
    return c.json({ error: 'trip not found' }, 404);
  }

  // Manual attach: same booking-record shapes as the auto-attacher,
  // but the user-chosen trip + destination instead of automatic
  // date-overlap inference.
  const bk = row.parsedJson as Record<string, unknown>;
  const bkType = String(bk.type || 'unknown');
  const bookingId = 'bk-' + randomUUID();
  const cancelType = (bk.cancelType as string) || 'unknown';
  const cancelDeadline = bk.cancelType === 'deadline' ? (bk.cancelDeadline as string | null) || null : null;

  function buildCar(): Record<string, unknown> {
    return {
      id: bookingId,
      kind: 'car',
      vendor: (bk.carrier as string) || '',
      pickup: { location: (bk.from as string) || '', date: (bk.depDate as string) || null, time: (bk.depTime as string) || null },
      dropoff: { location: (bk.to as string) || (bk.from as string) || '', date: (bk.arrDate as string) || null, time: (bk.arrTime as string) || null },
      confirmationNumber: (bk.confirmationNumber as string) || '',
      pricePaid: typeof bk.price === 'number' ? bk.price : null,
      currency: (bk.currency as string) || 'USD',
      notes: (bk.notes as string) || '',
      url: (bk.url as string) || null,
      status: 'booked',
      source: 'email-forward-manual',
      cancelType, cancelDeadline, cancelDeadlineTime: null,
    };
  }
  function buildFlight(): Record<string, unknown> {
    return {
      id: bookingId,
      kind: 'flight',
      legs: [{
        from: (bk.from as string) || '',
        to: (bk.to as string) || '',
        depDate: (bk.depDate as string) || null,
        depTime: (bk.depTime as string) || null,
        arrDate: (bk.arrDate as string) || null,
        arrTime: (bk.arrTime as string) || null,
        carrier: (bk.carrier as string) || '',
        flightNumber: (bk.number as string) || '',
      }],
      confirmationNumber: (bk.confirmationNumber as string) || '',
      pricePaid: typeof bk.price === 'number' ? bk.price : null,
      currency: (bk.currency as string) || 'USD',
      notes: (bk.notes as string) || '',
      url: (bk.url as string) || null,
      status: 'booked',
      source: 'email-forward-manual',
      cancelType, cancelDeadline, cancelDeadlineTime: null,
    };
  }
  function buildHotel(): Record<string, unknown> {
    return {
      id: bookingId,
      name: (bk.name as string) || (bk.carrier as string) || 'Untitled hotel',
      area: '',
      checkIn: (bk.depDate as string) || null,
      checkInTime: (bk.depTime as string) || null,
      checkOut: (bk.arrDate as string) || null,
      checkOutTime: (bk.arrTime as string) || null,
      confirmationNumber: (bk.confirmationNumber as string) || '',
      pricePaid: typeof bk.price === 'number' ? bk.price : null,
      currency: (bk.currency as string) || 'USD',
      notes: ((bk.notes as string) || '') + ((bk.address as string) ? '\nAddress: ' + bk.address : ''),
      url: (bk.url as string) || null,
      status: 'booked',
      source: 'email-forward-manual',
      cancelType, cancelDeadline, cancelDeadlineTime: null,
      lat: null, lng: null,
    };
  }
  function buildGeneral(): Record<string, unknown> {
    return {
      id: bookingId,
      type: bkType || 'ticket',
      label: (bk.name as string) || 'Untitled booking',
      date: (bk.depDate as string) || null,
      time: (bk.depTime as string) || null,
      timeEnd: (bk.arrTime as string) || null,
      confirmationNumber: (bk.confirmationNumber as string) || '',
      pricePaid: typeof bk.price === 'number' ? bk.price : null,
      currency: (bk.currency as string) || 'USD',
      notes: ((bk.notes as string) || '') + ((bk.address as string) ? '\nLocation: ' + bk.address : ''),
      url: (bk.url as string) || null,
      status: 'booked',
      source: 'email-forward-manual',
      cancelType, cancelDeadline, cancelDeadlineTime: null,
    };
  }

  // Unwrap the trip body (`{trip: {...}}`) for mutation.
  const rawBody = trip.body || {};
  const wrap = (rawBody as { trip?: unknown }).trip as Record<string, unknown> | undefined;
  const inner = (wrap || rawBody) as Record<string, unknown>;

  if (bkType === 'car') {
    if (!Array.isArray(inner.tripBookings)) inner.tripBookings = [];
    (inner.tripBookings as unknown[]).push(buildCar());
  } else if (bkType === 'flight') {
    if (!Array.isArray(inner.tripBookings)) inner.tripBookings = [];
    (inner.tripBookings as unknown[]).push(buildFlight());
  } else if (bkType === 'hotel') {
    if (!destinationId) return c.json({ error: 'destinationId required for hotel bookings' }, 400);
    const dests = (inner.destinations as Array<Record<string, unknown>>) || [];
    const destIdx = dests.findIndex((d) => d.id === destinationId);
    if (destIdx < 0) return c.json({ error: 'destination not found on this trip' }, 404);
    const dest = dests[destIdx];
    if (!dest) return c.json({ error: 'destination not found on this trip' }, 404);
    if (!Array.isArray(dest.hotelBookings)) dest.hotelBookings = [];
    (dest.hotelBookings as unknown[]).push(buildHotel());
  } else {
    if (!destinationId) return c.json({ error: 'destinationId required for this booking type' }, 400);
    const dests = (inner.destinations as Array<Record<string, unknown>>) || [];
    const destIdx = dests.findIndex((d) => d.id === destinationId);
    if (destIdx < 0) return c.json({ error: 'destination not found on this trip' }, 404);
    const dest = dests[destIdx];
    if (!dest) return c.json({ error: 'destination not found on this trip' }, 404);
    if (!Array.isArray(dest.generalBookings)) dest.generalBookings = [];
    (dest.generalBookings as unknown[]).push(buildGeneral());
  }

  // Write back the trip + mark the pending email attached.
  const toWrite = wrap ? rawBody : inner;
  await db
    .update(schema.trips)
    .set({ body: toWrite as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(schema.trips.id, tripId))
    .run();
  await db
    .update(schema.pendingEmails)
    .set({ tripId, bookingId })
    .where(eq(schema.pendingEmails.id, id))
    .run();

  return c.json({ ok: true, tripId, bookingId });
});

// PATCH /user/unassigned-bookings/:id — update the parsed_json on
// an unassigned booking BEFORE the user attaches it. Lets the user
// fix any LLM mis-extraction (wrong date, wrong vendor name, etc.)
// without having to attach-then-edit. Body is the partial parsed
// data; merged into the existing parsed_json (not replaced).
inboxApi.patch('/unassigned-bookings/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'JSON body required' }, 400);
  }
  const row = await db
    .select()
    .from(schema.pendingEmails)
    .where(eq(schema.pendingEmails.id, id))
    .get();
  if (!row) return c.json({ error: 'not found' }, 404);
  const inbox = await db
    .select()
    .from(schema.userInboxes)
    .where(eq(schema.userInboxes.userId, user.id))
    .get();
  if (!inbox || row.inboxToken !== inbox.inboxToken) {
    return c.json({ error: 'forbidden' }, 403);
  }
  // Merge — caller can send just the fields that changed.
  const existing = (row.parsedJson || {}) as Record<string, unknown>;
  const merged = Object.assign({}, existing, body);
  await db
    .update(schema.pendingEmails)
    .set({ parsedJson: merged })
    .where(eq(schema.pendingEmails.id, id))
    .run();
  return c.json({ ok: true, parsed: merged });
});

// POST /user/unassigned-bookings/:id/dismiss — soft-delete an
// unassigned booking. We flip the row to a 'dismissed' status so
// it stops appearing in the tray but stays in the DB for audit.
inboxApi.post('/unassigned-bookings/:id/dismiss', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await db
    .select()
    .from(schema.pendingEmails)
    .where(eq(schema.pendingEmails.id, id))
    .get();
  if (!row) return c.json({ error: 'not found' }, 404);
  const inbox = await db
    .select()
    .from(schema.userInboxes)
    .where(eq(schema.userInboxes.userId, user.id))
    .get();
  if (!inbox || row.inboxToken !== inbox.inboxToken) {
    return c.json({ error: 'forbidden' }, 403);
  }
  await db
    .update(schema.pendingEmails)
    .set({ parseStatus: 'dismissed' })
    .where(eq(schema.pendingEmails.id, id))
    .run();
  return c.json({ ok: true });
});

export { inboxApi };
