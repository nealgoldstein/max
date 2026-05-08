// Auth routes.
//
// Production flow (magic-link):
//   1. POST /auth/magic-link { email }
//      → Server creates a one-time magic token, emails the user a
//        link that hits /auth/verify with the token.
//   2. GET /auth/verify?token=<magic>
//      → Server validates token, mints a 30-day session, redirects
//        to the client URL with the session token in a fragment so
//        JS can stash it in localStorage.
//
// Dev flow (POST /auth/dev-login) is still here for local testing
// and will be removed when we lock down for public.

import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { devLogin } from '../lib/auth.js';
import { sendEmail } from '../lib/email.js';
import { randomUUID } from 'node:crypto';

const authApi = new Hono();

// ── Dev login (kept for local testing) ─────────────────────
const loginSchema = z.object({ email: z.string().email() });

authApi.post('/dev-login', async (c) => {
  const env = (c.env as Record<string, string | undefined>) || {};
  // Disable in production unless DEV_LOGIN_ENABLED is explicitly set.
  if (env.DEV_LOGIN_ENABLED !== 'true' && env.NODE_ENV === 'production') {
    return c.json({ error: 'dev-login disabled' }, 403);
  }
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid email', issues: parsed.error.issues }, 400);
  }
  try {
    const { token, user } = await devLogin(parsed.data.email);
    return c.json({ token, user });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : 'Login failed' },
      500,
    );
  }
});

// ── Magic-link: request a sign-in email ────────────────────
const MAGIC_TTL_MS = 15 * 60 * 1000; // 15 minutes

authApi.post('/magic-link', async (c) => {
  const env = (c.env as Record<string, string | undefined>) || {};
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid email', issues: parsed.error.issues }, 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  const token = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + MAGIC_TTL_MS);
  try {
    await db
      .insert(schema.magicTokens)
      .values({ token, email, expiresAt })
      .run();
  } catch (e) {
    console.error('[max] magic-link insert failed:', e);
    return c.json({ error: 'Could not create sign-in token' }, 500);
  }

  // Build the verification URL. Server origin = api.travelingwithmax.app
  // when deployed; the verify endpoint redirects to the client.
  const baseUrl =
    env.API_BASE_URL ||
    'https://api.travelingwithmax.app';
  const verifyUrl = baseUrl + '/auth/verify?token=' + encodeURIComponent(token);

  const subject = 'Sign in to Max';
  const html =
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;color:#333;line-height:1.5;max-width:480px;margin:0 auto;padding:24px;">' +
    '<h2 style="font-size:18px;margin:0 0 12px;">Sign in to Max</h2>' +
    '<p>Click the button below to sign in. This link is good for 15 minutes and can only be used once.</p>' +
    '<p style="margin:24px 0;"><a href="' +
    verifyUrl +
    '" style="display:inline-block;background:#1a5fa8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Sign in →</a></p>' +
    '<p style="font-size:12px;color:#888;">If you didn\'t request this, you can ignore the email — no account changes happen until you click the link.</p>' +
    '<p style="font-size:11px;color:#aaa;margin-top:24px;">Or copy this URL into your browser: ' +
    '<br><span style="word-break:break-all;">' + verifyUrl + '</span></p>' +
    '</div>';
  const text =
    'Sign in to Max\n\n' +
    'Click this link to sign in (valid 15 minutes, one-time use):\n' +
    verifyUrl +
    '\n\nIf you didn\'t request this, ignore the email.';

  let emailSent = false;
  try {
    if (env.RESEND_API_KEY) {
      await sendEmail(env, { to: email, subject, html, text });
      emailSent = true;
    }
  } catch (e) {
    console.error('[max] magic-link email failed:', e);
  }

  // v350.1: when no email service is configured, return the link
  // directly so the user can copy/paste or click. Lets sign-in
  // work for personal testing before Resend / similar is set up.
  if (!emailSent) {
    return c.json({
      ok: true,
      message:
        'Email service not configured — use the link below directly (it expires in 15 minutes).',
      directLink: verifyUrl,
    });
  }
  return c.json({ ok: true, message: 'Check your email for a sign-in link.' });
});

// ── Magic-link: verify token, mint session, redirect to client ──
authApi.get('/verify', async (c) => {
  const env = (c.env as Record<string, string | undefined>) || {};
  const token = c.req.query('token');
  const clientBase = env.CLIENT_BASE_URL || 'https://travelingwithmax.app';
  if (!token) {
    return c.redirect(clientBase + '/?signin=error&reason=missing');
  }

  const magic = await db
    .select()
    .from(schema.magicTokens)
    .where(eq(schema.magicTokens.token, token))
    .get();

  if (!magic) {
    return c.redirect(clientBase + '/?signin=error&reason=invalid');
  }
  if (magic.usedAt) {
    return c.redirect(clientBase + '/?signin=error&reason=used');
  }
  if (magic.expiresAt.getTime() < Date.now()) {
    return c.redirect(clientBase + '/?signin=error&reason=expired');
  }

  // Mark used (one-time)
  await db
    .update(schema.magicTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.magicTokens.token, token))
    .run();

  // Find or create user
  const email = magic.email;
  let user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (!user) {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, email }).run();
    user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .get();
    if (!user) {
      return c.redirect(clientBase + '/?signin=error&reason=user_create_failed');
    }
  }

  // Mint session
  const sessionToken = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db
    .insert(schema.sessions)
    .values({ token: sessionToken, userId: user.id, expiresAt })
    .run();

  // Redirect to client with session token in the URL hash. Hash
  // doesn't go to server logs and the client picks it up + clears
  // the URL.
  return c.redirect(
    clientBase +
      '/?signin=ok#session=' +
      encodeURIComponent(sessionToken) +
      '&email=' +
      encodeURIComponent(email),
  );
});

export { authApi };
