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

  await db
    .update(schema.trips)
    .set({
      name: name ?? existing.name,
      body,
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
