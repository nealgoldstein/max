// Dev-mode auth — replaced by Lucia/Auth0/Clerk in a later round.
//
// How it works for now:
//   1. POST /auth/dev-login with { email } returns a bearer token.
//      First time we see an email, we create a user row.
//   2. Client sends `Authorization: Bearer <token>` on every request.
//   3. The middleware here looks up the token, attaches the user to
//      the Hono context, and rejects unauthenticated requests.
//
// This works for one developer iterating on the desktop client. Real
// auth (email magic link, OAuth, etc.) plugs in by replacing the
// `getUserFromToken` body — the rest of the server doesn't change.

import { db, schema } from '../db/client.js';
import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { User } from '../db/schema.js';

// `crypto.randomUUID()` is a global on both Node 19+ and Cloudflare
// Workers — no import needed. Keeps this file runtime-agnostic.
const randomUUID = (): string => crypto.randomUUID();

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AuthContext = {
  Variables: {
    user: User;
  };
};

export async function getUserFromToken(token: string): Promise<User | null> {
  if (!token) return null;
  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.token, token))
    .get();
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .get();
  return user || null;
}

export const requireAuth: MiddlewareHandler<AuthContext> = async (
  c: Context,
  next: Next,
) => {
  const header = c.req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    return c.json({ error: 'Missing Authorization: Bearer <token>' }, 401);
  }
  const user = await getUserFromToken(token);
  if (!user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  c.set('user', user);
  await next();
};

// Dev login — mints a session for a given email, creating the user
// row if one doesn't exist. Replaced by real flows later.
export async function devLogin(
  email: string,
): Promise<{ token: string; user: User }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) throw new Error('Email required');

  let user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, trimmed))
    .get();

  if (!user) {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, email: trimmed }).run();
    user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .get();
    if (!user) throw new Error('Failed to create user row');
  }

  const token = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .insert(schema.sessions)
    .values({ token, userId: user.id, expiresAt })
    .run();

  return { token, user };
}
