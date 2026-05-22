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
  const r = await resolveSession(token);
  return r.user || null;
}

// v359.60.91: split-out session resolver so callers (auth middleware,
// /auth/whoami) can distinguish between "no token", "no row", "expired",
// and "user gone" instead of collapsing all four into a generic 401.
// The repeated-sign-in bug was opaque under "Invalid or expired token";
// surfacing the specific reason lets the client log what really
// happened (and lets a /whoami probe tell us if the token in
// localStorage is even reaching us intact).
export type SessionReason =
  | 'ok'
  | 'no_token'
  | 'no_session'
  | 'expired'
  | 'user_missing';

export type SessionResolveResult = {
  reason: SessionReason;
  user: User | null;
  expiresAt?: Date | null;
  msUntilExpiry?: number | null;
};

export async function resolveSession(
  token: string | undefined | null,
): Promise<SessionResolveResult> {
  if (!token) return { reason: 'no_token', user: null };
  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.token, token))
    .get();
  if (!session) return { reason: 'no_session', user: null };
  const now = Date.now();
  const exp = session.expiresAt.getTime();
  if (exp < now) {
    return {
      reason: 'expired',
      user: null,
      expiresAt: session.expiresAt,
      msUntilExpiry: exp - now,
    };
  }
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .get();
  if (!user) {
    return {
      reason: 'user_missing',
      user: null,
      expiresAt: session.expiresAt,
      msUntilExpiry: exp - now,
    };
  }
  return {
    reason: 'ok',
    user,
    expiresAt: session.expiresAt,
    msUntilExpiry: exp - now,
  };
}

export const requireAuth: MiddlewareHandler<AuthContext> = async (
  c: Context,
  next: Next,
) => {
  const header = c.req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  const r = await resolveSession(token);
  if (r.reason !== 'ok' || !r.user) {
    // Include the reason so the browser network tab tells us which of
    // the four failure modes hit. Status stays 401 so existing clients
    // still clear the token and re-auth.
    return c.json({ error: 'Invalid or expired token', reason: r.reason }, 401);
  }
  c.set('user', r.user);
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
