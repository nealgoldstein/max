// Trips CRUD — sync surface for desktop + mobile.
//
// Endpoints:
//   GET    /trips                — list this user's trips (id, name,
//                                    updatedAt, createdAt; no body)
//   GET    /trips/:id            — one full trip (with body)
//   POST   /trips                — create new trip
//   PUT    /trips/:id            — replace body (sync write)
//   DELETE /trips/:id            — remove
//
// Sync model (last-write-wins):
//   Client sends its local `updatedAt` on PUT. Server compares to
//   the row's existing `updatedAt`. If the client's is newer or
//   equal, the write applies. If the server's is newer, we return
//   409 with the current server state and the client decides whether
//   to overwrite. v1 keeps it simple; per-field merge is a later
//   round if conflicts get common.

import { Hono } from 'hono';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, schema } from '../db/client.js';
import { requireAuth, type AuthContext } from '../lib/auth.js';

const tripsApi = new Hono<AuthContext>();
tripsApi.use('*', requireAuth);

// ─── helpers ─────────────────────────────────────────────────

// Trip body is stored as JSON. The client wraps the trip in
// `{ trip: { ... } }`; older bodies might be flat. This pair of
// helpers handles both shapes so the same merge code works either way.
function _unwrap(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {} as Record<string, unknown>;
  const b = body as { trip?: Record<string, unknown> };
  return (b.trip || (body as Record<string, unknown>));
}
function _rewrap(original: unknown, unwrapped: Record<string, unknown>): Record<string, unknown> {
  if (original && typeof original === 'object' && 'trip' in (original as object)) {
    return { ...(original as Record<string, unknown>), trip: unwrapped };
  }
  return unwrapped;
}

// v359.60.95: preserve email-forwarded bookings that exist on the
// server but are missing from the incoming PUT body. See the long
// comment in PUT /:id for why this is needed. Operates on three
// arrays:
//
//   - tripBookings[]              (top-level: flights, car rentals)
//   - destinations[i].hotelBookings[]
//   - destinations[i].generalBookings[]
//
// Match by booking.id. Anything with source === 'email-forward'
// that's on server but not in incoming is preserved.
//
// Returns the body in the same shape the original was in (wrapped
// or flat). Pure function — doesn't mutate its inputs.
function _preserveEmailForwardedBookings(
  existingBody: unknown,
  incomingBody: unknown,
): Record<string, unknown> {
  // Defensive copies so we never mutate caller-owned objects.
  const incoming = JSON.parse(JSON.stringify(incomingBody)) as Record<string, unknown>;
  const incomingInner = _unwrap(incoming);
  const existingInner = _unwrap(existingBody);

  // ── trip-level bookings ──
  //
  // Preservation rule (v359.60.95): an email-forwarded booking is
  // preserved only when the incoming body has NO booking that
  // matches it by id OR by natural key (kind + confirmationNumber).
  // The natural-key check is what makes client-side dedupe stick:
  // if the user deletes 6 of 7 duplicate United flights locally and
  // saves, the surviving one's (kind=flight, conf=BP8P5W) covers
  // the others' natural key, so we don't restore them. Without
  // this rule the merge would dutifully resurrect every duplicate
  // on the next save, defeating the cleanup.
  function _bookingKeys(b: Record<string, unknown>): { id: string; natural: string | null } {
    const id = String(b.id || '');
    const kind = (b.kind as string) || (b.type as string) || '';
    const conf = typeof b.confirmationNumber === 'string' ? b.confirmationNumber.trim().toLowerCase() : '';
    const natural = (kind && conf) ? (kind + '|' + conf) : null;
    return { id, natural };
  }
  const incomingTb = Array.isArray(incomingInner.tripBookings) ? (incomingInner.tripBookings as Array<Record<string, unknown>>) : [];
  const existingTb = Array.isArray(existingInner.tripBookings) ? (existingInner.tripBookings as Array<Record<string, unknown>>) : [];
  const incomingTbIds = new Set<string>();
  const incomingTbNaturals = new Set<string>();
  incomingTb.forEach((b) => {
    const k = _bookingKeys(b);
    if (k.id) incomingTbIds.add(k.id);
    if (k.natural) incomingTbNaturals.add(k.natural);
  });
  const preservedTb = existingTb.filter((b) => {
    if (!b || b.source !== 'email-forward') return false;
    const k = _bookingKeys(b);
    if (k.id && incomingTbIds.has(k.id)) return false;
    if (k.natural && incomingTbNaturals.has(k.natural)) return false;
    return true;
  });
  if (preservedTb.length > 0) {
    console.log(
      '[trips:put] preserving', preservedTb.length,
      'server-side email-forwarded tripBooking(s):',
      preservedTb.map((b) => b.id).join(', '),
    );
    incomingInner.tripBookings = incomingTb.concat(preservedTb);
  }

  // ── per-destination bookings (hotelBookings + generalBookings) ──
  // Match destinations by id so reordering on the client doesn't
  // mis-attribute the preserved bookings. If a destination on
  // server is missing from the incoming body, the bookings are
  // orphaned — surface them in tripBookings as a fallback so they
  // don't vanish. (Rare; would only happen if user deletes a
  // destination that had an email-forward hotel.)
  const incomingDests = Array.isArray(incomingInner.destinations) ? (incomingInner.destinations as Array<Record<string, unknown>>) : [];
  const existingDests = Array.isArray(existingInner.destinations) ? (existingInner.destinations as Array<Record<string, unknown>>) : [];
  const incomingDestById = new Map<string, Record<string, unknown>>();
  incomingDests.forEach((d) => { if (d && d.id) incomingDestById.set(String(d.id), d); });

  let orphanedFromDeletedDests: Array<Record<string, unknown>> = [];
  existingDests.forEach((existDest) => {
    if (!existDest || !existDest.id) return;
    const incDest = incomingDestById.get(String(existDest.id));
    (['hotelBookings', 'generalBookings'] as const).forEach((arrName) => {
      const existArr = Array.isArray(existDest[arrName]) ? (existDest[arrName] as Array<Record<string, unknown>>) : [];
      const emailBkings = existArr.filter((b) => b && b.source === 'email-forward');
      if (emailBkings.length === 0) return;
      if (!incDest) {
        // Destination deleted client-side. Park the bookings at the
        // trip level rather than silently dropping them.
        orphanedFromDeletedDests = orphanedFromDeletedDests.concat(emailBkings);
        return;
      }
      const incArr = Array.isArray(incDest[arrName]) ? (incDest[arrName] as Array<Record<string, unknown>>) : [];
      const incIds = new Set(incArr.map((b) => String(b.id)));
      const preserved = emailBkings.filter((b) => !incIds.has(String(b.id)));
      if (preserved.length > 0) {
        console.log(
          '[trips:put] preserving', preserved.length,
          'server-side email-forwarded', arrName,
          'on dest', existDest.id,
        );
        incDest[arrName] = incArr.concat(preserved);
      }
    });
  });
  if (orphanedFromDeletedDests.length > 0) {
    console.log(
      '[trips:put] parking', orphanedFromDeletedDests.length,
      'orphaned email-forwarded booking(s) at trip level',
    );
    const tb = Array.isArray(incomingInner.tripBookings) ? (incomingInner.tripBookings as Array<Record<string, unknown>>) : [];
    incomingInner.tripBookings = tb.concat(orphanedFromDeletedDests);
  }

  return _rewrap(incoming, incomingInner);
}

// List
tripsApi.get('/', async (c) => {
  const user = c.get('user');
  const rows = await db
    .select({
      id: schema.trips.id,
      name: schema.trips.name,
      updatedAt: schema.trips.updatedAt,
      createdAt: schema.trips.createdAt,
    })
    .from(schema.trips)
    .where(eq(schema.trips.userId, user.id))
    .orderBy(desc(schema.trips.updatedAt))
    .all();
  return c.json({ trips: rows });
});

// Get one (full body)
tripsApi.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.id, id), eq(schema.trips.userId, user.id)))
    .get();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ trip: row });
});

// Create
const createSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  body: z.record(z.unknown()),
  uiState: z.record(z.unknown()).optional(),
  updatedAt: z.number().int().optional(),
});

tripsApi.post('/', async (c) => {
  const user = c.get('user');
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { id, name, body, uiState, updatedAt } = parsed.data;

  const existing = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.id, id))
    .get();
  if (existing) {
    return c.json({ error: 'Trip ID already exists' }, 409);
  }

  const ts = updatedAt ? new Date(updatedAt) : new Date();
  await db
    .insert(schema.trips)
    .values({
      id,
      userId: user.id,
      name,
      body,
      uiState: uiState ?? {},
      updatedAt: ts,
      createdAt: ts,
    })
    .run();

  const row = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.id, id))
    .get();
  return c.json({ trip: row }, 201);
});

// Replace body (sync write)
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  body: z.record(z.unknown()),
  uiState: z.record(z.unknown()).optional(),
  updatedAt: z.number().int(), // client's local timestamp (ms)
  force: z.boolean().optional(), // client overrides server-newer guard
});

tripsApi.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { name, body, uiState, updatedAt, force } = parsed.data;

  const existing = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.id, id), eq(schema.trips.userId, user.id)))
    .get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Conflict guard. The server's row is newer than the client says.
  if (!force && existing.updatedAt.getTime() > updatedAt) {
    return c.json(
      {
        error: 'Conflict — server has newer data',
        serverUpdatedAt: existing.updatedAt.getTime(),
        clientUpdatedAt: updatedAt,
        // The full server row so the client can present a chooser
        // ("keep mine / use theirs / merge").
        serverTrip: existing,
      },
      409,
    );
  }

  // v359.60.95: preserve server-side email-forwarded bookings.
  //
  // Background. Email parser → attacher writes new bookings directly
  // into the trip body server-side (tripBookings[] for flights/cars,
  // destination.hotelBookings[] / .generalBookings[] for the rest).
  // The client doesn't know about them until its next pullAll.
  //
  // The race that loses them: client pulls trip body at T1, user
  // edits locally (e.g. Generate Waysides) at T2, autosave PUTs the
  // local body at T2. If the server attached a flight at T1.5
  // (between pull and save), the client's PUT body lacks that
  // flight and overwrites it on the server. The local timestamp T2
  // is newer than the server's T1.5, so the conflict guard above
  // doesn't fire — and the flight is gone from both sides.
  //
  // The fix: before writing, scan the existing server body for any
  // booking marked source: 'email-forward'. If the incoming body
  // doesn't have it (by id), merge it back in. Email-forwarded
  // bookings always originate server-side, so the client's
  // "absence" of one is never a deletion intent — it's just
  // ignorance. Anything else (user deletions) operates as before.

  // Diagnostic: log what's coming in and what's already on the server
  // so we can verify the merge is actually firing. The bug we're
  // chasing is that even after the merge code shipped, the email-
  // attached flight kept disappearing — this log will tell us
  // whether the PUT even ran, what the incoming body had, what the
  // existing server body had, and what the merge decided to preserve.
  const _existingTb = (_unwrap(existing.body).tripBookings as Array<{ id?: string; source?: string }> | undefined) || [];
  const _incomingTb = (_unwrap(body).tripBookings as Array<{ id?: string; source?: string }> | undefined) || [];
  console.log(
    '[trips:put]', id,
    'existing.tripBookings=' + _existingTb.length,
    '(emailForwarded=' + _existingTb.filter((b) => b && b.source === 'email-forward').length + ')',
    'incoming.tripBookings=' + _incomingTb.length,
    '(emailForwarded=' + _incomingTb.filter((b) => b && b.source === 'email-forward').length + ')',
  );

  const mergedBody = _preserveEmailForwardedBookings(existing.body, body);
  const _mergedTb = (_unwrap(mergedBody).tripBookings as Array<{ id?: string; source?: string }> | undefined) || [];
  console.log(
    '[trips:put]', id,
    'merged.tripBookings=' + _mergedTb.length,
    '(emailForwarded=' + _mergedTb.filter((b) => b && b.source === 'email-forward').length + ')',
  );

  await db
    .update(schema.trips)
    .set({
      name: name ?? existing.name,
      body: mergedBody,
      // If client didn't send uiState, preserve what's on the row.
      // Most full-trip writes don't touch UI state — those use
      // PATCH /:id/ui-state instead.
      uiState: uiState ?? existing.uiState ?? {},
      updatedAt: new Date(updatedAt),
    })
    .where(eq(schema.trips.id, id))
    .run();

  const row = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.id, id))
    .get();
  return c.json({ trip: row });
});

// Cheap UI-state writes — merge keys into trip.uiState without
// touching `body`. Use for "expanded this banner," "collapsed that
// research panel" — UI flips that should follow the trip across
// devices but don't change trip content. Doesn't bump trip.updatedAt
// (trip content is unchanged); we keep its own timestamp in the
// blob if the client cares.
const uiStatePatchSchema = z.object({
  patch: z.record(z.unknown()),
});

tripsApi.patch('/:id/ui-state', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = uiStatePatchSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { patch } = parsed.data;

  const existing = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.id, id), eq(schema.trips.userId, user.id)))
    .get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const next = Object.assign({}, existing.uiState ?? {}, patch);

  await db
    .update(schema.trips)
    .set({ uiState: next })
    .where(eq(schema.trips.id, id))
    .run();

  return c.json({ uiState: next });
});

// Delete
tripsApi.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const result = await db
    .delete(schema.trips)
    .where(and(eq(schema.trips.id, id), eq(schema.trips.userId, user.id)))
    .run();
  if (result.rowsAffected === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// v353.5: Share-link minting + revocation. The public read endpoint
// for a share token is GET /share/:token and lives in its own
// router (no auth) — this file only handles owner-side operations.

// Mint a new share token for a trip the caller owns. Returns the
// token; the client builds the share URL as
// `https://travelingwithmax.app/?share=<token>`. Multiple active
// tokens per trip are allowed (rotating doesn't auto-revoke older
// ones — call DELETE first if you want exclusive rotation).
tripsApi.post('/:id/share', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const trip = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.id, id), eq(schema.trips.userId, user.id)))
    .get();
  if (!trip) return c.json({ error: 'Not found' }, 404);
  const token = randomUUID() + '-' + randomUUID();
  await db
    .insert(schema.shareTokens)
    .values({ token, tripId: id })
    .run();
  return c.json({ ok: true, token, tripId: id });
});

// Revoke ALL active (non-revoked) share tokens for a trip. Returns
// how many were revoked. We mark revoked rather than delete so
// audit / debug history is preserved.
tripsApi.delete('/:id/share', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  // Verify ownership first.
  const trip = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.id, id), eq(schema.trips.userId, user.id)))
    .get();
  if (!trip) return c.json({ error: 'Not found' }, 404);
  const result = await db
    .update(schema.shareTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.shareTokens.tripId, id),
        isNull(schema.shareTokens.revokedAt),
      ),
    )
    .run();
  return c.json({ ok: true, revoked: result.rowsAffected });
});

// List active share tokens for a trip the caller owns. Useful for
// the share modal to show "this trip already has 1 active share
// link" with a copy button.
tripsApi.get('/:id/share', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const trip = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.id, id), eq(schema.trips.userId, user.id)))
    .get();
  if (!trip) return c.json({ error: 'Not found' }, 404);
  const rows = await db
    .select()
    .from(schema.shareTokens)
    .where(
      and(
        eq(schema.shareTokens.tripId, id),
        isNull(schema.shareTokens.revokedAt),
      ),
    )
    .all();
  return c.json({
    tokens: rows.map((r) => ({
      token: r.token,
      createdAt: r.createdAt.getTime(),
    })),
  });
});

export { tripsApi };
