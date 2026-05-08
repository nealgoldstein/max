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
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
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
  updatedAt: z.number().int().optional(),
});

tripsApi.post('/', async (c) => {
  const user = c.get('user');
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { id, name, body, updatedAt } = parsed.data;

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
  const { name, body, updatedAt, force } = parsed.data;

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

export { tripsApi };
