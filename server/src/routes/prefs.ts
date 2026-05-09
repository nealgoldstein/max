// User preferences API.
//
// Endpoints:
//   GET /user/prefs        — return the user's prefs blob (creates
//                              empty default if missing)
//   PUT /user/prefs        — replace the prefs blob
//   PATCH /user/prefs      — merge keys into the existing blob
//                              (preferred for "set one key" calls)
//
// One row per user in the user_prefs table. The blob is opaque to
// the server — same model as the trip body. Client-side schema
// (paceHours, defaultTripDuration, currency, language, …) lives
// in MaxDB.prefs and grows as new prefs are added without server
// changes.
//
// Sync model: client fetches on sign-in, caches in localStorage,
// writes through on every prefs.set. Last-write-wins between
// devices — for prefs (small JSON) this is fine; the failure mode
// is "I changed pace on phone and laptop in the same minute and
// the laptop's value won." Acceptable for v1.

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { requireAuth, type AuthContext } from '../lib/auth.js';

const prefsApi = new Hono<AuthContext>();
prefsApi.use('*', requireAuth);

// Read this user's prefs. Returns {prefs: {}} if no row exists yet
// rather than 404 — clients can treat "no prefs" the same as
// "empty prefs" without extra branching.
prefsApi.get('/', async (c) => {
  const user = c.get('user');
  const row = await db
    .select()
    .from(schema.userPrefs)
    .where(eq(schema.userPrefs.userId, user.id))
    .get();
  if (!row) {
    return c.json({ prefs: {}, updatedAt: 0 });
  }
  return c.json({
    prefs: row.prefs ?? {},
    updatedAt: row.updatedAt.getTime(),
  });
});

const replaceSchema = z.object({
  prefs: z.record(z.unknown()),
  updatedAt: z.number().int().optional(),
});

// Replace the entire prefs blob. Use for "I have the full local
// state, push it." For partial updates, prefer PATCH.
prefsApi.put('/', async (c) => {
  const user = c.get('user');
  const parsed = replaceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { prefs, updatedAt } = parsed.data;
  const ts = updatedAt ? new Date(updatedAt) : new Date();

  const existing = await db
    .select()
    .from(schema.userPrefs)
    .where(eq(schema.userPrefs.userId, user.id))
    .get();

  if (!existing) {
    await db
      .insert(schema.userPrefs)
      .values({ userId: user.id, prefs, updatedAt: ts, createdAt: ts })
      .run();
  } else {
    await db
      .update(schema.userPrefs)
      .set({ prefs, updatedAt: ts })
      .where(eq(schema.userPrefs.userId, user.id))
      .run();
  }

  const row = await db
    .select()
    .from(schema.userPrefs)
    .where(eq(schema.userPrefs.userId, user.id))
    .get();
  return c.json({
    prefs: row?.prefs ?? prefs,
    updatedAt: (row?.updatedAt ?? ts).getTime(),
  });
});

// Merge keys into the existing blob. Use for "set just paceHours."
// Server reads existing, shallow-merges the patch, writes back.
const patchSchema = z.object({
  patch: z.record(z.unknown()),
  updatedAt: z.number().int().optional(),
});

prefsApi.patch('/', async (c) => {
  const user = c.get('user');
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { patch, updatedAt } = parsed.data;
  const ts = updatedAt ? new Date(updatedAt) : new Date();

  const existing = await db
    .select()
    .from(schema.userPrefs)
    .where(eq(schema.userPrefs.userId, user.id))
    .get();

  const next = Object.assign({}, existing?.prefs ?? {}, patch);

  if (!existing) {
    await db
      .insert(schema.userPrefs)
      .values({ userId: user.id, prefs: next, updatedAt: ts, createdAt: ts })
      .run();
  } else {
    await db
      .update(schema.userPrefs)
      .set({ prefs: next, updatedAt: ts })
      .where(eq(schema.userPrefs.userId, user.id))
      .run();
  }

  const row = await db
    .select()
    .from(schema.userPrefs)
    .where(eq(schema.userPrefs.userId, user.id))
    .get();
  return c.json({
    prefs: row?.prefs ?? next,
    updatedAt: (row?.updatedAt ?? ts).getTime(),
  });
});

export { prefsApi };
