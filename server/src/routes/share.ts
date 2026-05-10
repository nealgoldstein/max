// Public share-link reader.
//
// GET /share/:token → returns the trip body for any active (non-
// revoked) share token. No auth — the token IS the auth.
//
// Why a separate router: tripsApi has `use('*', requireAuth)`
// applied to every route. We need this one to be unauthenticated
// so anyone with the link can view the shared trip. Mounting at
// /share keeps the URL short and obvious.

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

const shareApi = new Hono();

shareApi.get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!token) return c.json({ error: 'Missing token' }, 400);

  const share = await db
    .select()
    .from(schema.shareTokens)
    .where(
      and(
        eq(schema.shareTokens.token, token),
        isNull(schema.shareTokens.revokedAt),
      ),
    )
    .get();

  if (!share) {
    // Indistinguishable response for "doesn't exist" and "revoked"
    // so an attacker can't enumerate which tokens were once valid.
    return c.json({ error: 'Share link not found or revoked' }, 404);
  }

  const trip = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.id, share.tripId))
    .get();

  if (!trip) {
    // Trip was deleted but share row survived (shouldn't happen with
    // ON DELETE CASCADE, but defend against schema drift).
    return c.json({ error: 'Trip no longer exists' }, 410);
  }

  return c.json({
    trip: {
      id: trip.id,
      name: trip.name,
      body: trip.body,
      // No userId, no updatedAt, no internal columns — read-only view.
    },
  });
});

export { shareApi };
