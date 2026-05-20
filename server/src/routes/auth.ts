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

// v359.60.80: optional email allowlist for sign-in. ALLOWED_EMAILS is
// a bootstrap fast-path: emails on this comma-separated list are
// always treated as approved without going through the access-grants
// table. Useful for owner accounts you don't want gated by the DB
// approval flow.
function _allowedEmails(env: Record<string, string | undefined>): string[] | null {
  const raw = env.ALLOWED_EMAILS;
  if (!raw || !raw.trim()) return null;
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
function _isBootstrapAllowed(env: Record<string, string | undefined>, email: string): boolean {
  const list = _allowedEmails(env);
  if (!list) return false;
  return list.includes(email.trim().toLowerCase());
}

// v359.60.81: access-grants table is the runtime allowlist. Returns
// the current grant record for the email (or null). The four possible
// statuses are pending / approved / denied / revoked.
async function _getGrant(email: string) {
  const row = await db
    .select()
    .from(schema.accessGrants)
    .where(eq(schema.accessGrants.email, email.trim().toLowerCase()))
    .get();
  return row || null;
}

// True iff this email is allowed to sign in *right now*. Bootstrap
// list always wins; otherwise we check the access_grants table.
async function _canSignIn(env: Record<string, string | undefined>, email: string): Promise<boolean> {
  if (_isBootstrapAllowed(env, email)) return true;
  const grant = await _getGrant(email);
  return !!(grant && grant.status === 'approved');
}

// Send the magic link to a user (extracted so /admin/approve can
// trigger it too). Generates the token, writes magic_tokens row,
// sends email (or returns the direct link when no email service is
// configured). Returns { sent: boolean, directLink: string | null }.
async function _issueMagicLink(env: Record<string, string | undefined>, email: string, name?: string | null): Promise<{ sent: boolean; directLink: string | null }> {
  const token = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + MAGIC_TTL_MS);
  await db
    .insert(schema.magicTokens)
    .values({ token, email, name: name || null, expiresAt })
    .run();
  const baseUrl = env.API_BASE_URL || 'https://api.travelingwithmax.app';
  const verifyUrl = baseUrl + '/auth/verify?token=' + encodeURIComponent(token);
  const subject = 'Sign in to Max';
  const html =
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;color:#333;line-height:1.5;max-width:480px;margin:0 auto;padding:24px;">' +
    '<h2 style="font-size:18px;margin:0 0 12px;">Sign in to Max</h2>' +
    '<p>Click the button below to sign in. This link is good for 15 minutes and can only be used once.</p>' +
    '<p style="margin:24px 0;"><a href="' + verifyUrl + '" style="display:inline-block;background:#1a5fa8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Sign in →</a></p>' +
    '<p style="font-size:12px;color:#888;">If you didn\'t request this, you can ignore the email — no account changes happen until you click the link.</p>' +
    '<p style="font-size:11px;color:#aaa;margin-top:24px;">Or copy this URL into your browser:<br><span style="word-break:break-all;">' + verifyUrl + '</span></p>' +
    '</div>';
  const text = 'Sign in to Max\n\nClick this link to sign in (valid 15 minutes, one-time use):\n' + verifyUrl + '\n\nIf you didn\'t request this, ignore the email.';
  if (env.RESEND_API_KEY) {
    try {
      await sendEmail(env, { to: email, subject, html, text });
      return { sent: true, directLink: null };
    } catch (e) {
      console.error('[max] magic-link email failed:', e);
    }
  }
  return { sent: false, directLink: verifyUrl };
}

// Send the admin a notification email about a new sign-in request,
// with one-time approve / deny links embedded.
async function _notifyAdminOfRequest(env: Record<string, string | undefined>, email: string, approveToken: string, denyToken: string, name?: string | null): Promise<void> {
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn('[max] ADMIN_EMAIL not set — sign-in request from', email, 'recorded but no notification sent');
    return;
  }
  if (!env.RESEND_API_KEY) {
    console.warn('[max] RESEND_API_KEY not set — sign-in request from', email, 'recorded but no notification sent');
    return;
  }
  const baseUrl = env.API_BASE_URL || 'https://api.travelingwithmax.app';
  const approveUrl = baseUrl + '/admin/approve?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(approveToken);
  const denyUrl = baseUrl + '/admin/deny?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(denyToken);
  const subject = '[Max] Sign-in request from ' + (name ? name + ' (' + email + ')' : email);
  const displayLine = name ? '<strong>' + name + '</strong> &lt;' + email + '&gt;' : '<strong>' + email + '</strong>';
  const html =
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;color:#333;line-height:1.5;max-width:520px;margin:0 auto;padding:24px;">' +
    '<h2 style="font-size:18px;margin:0 0 12px;">New Max sign-in request</h2>' +
    '<p>' + displayLine + ' is trying to sign in to Max. They\'ll see a "request submitted, waiting for approval" message until you decide.</p>' +
    '<p style="margin:24px 0;display:flex;gap:10px;flex-wrap:wrap;">' +
    '<a href="' + approveUrl + '" style="display:inline-block;background:#2a7a4e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">✓ Approve</a>' +
    '<a href="' + denyUrl + '" style="display:inline-block;background:#c44;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">✗ Deny</a>' +
    '</p>' +
    '<p style="font-size:12px;color:#888;">Approving auto-sends them a sign-in link. Denying turns them away politely. These links are one-time-use; future actions (e.g., revoke) go through the /admin/* CLI endpoints.</p>' +
    '</div>';
  const text =
    '[Max] Sign-in request from ' + (name ? name + ' <' + email + '>' : email) + '\n\n' +
    'Approve: ' + approveUrl + '\n' +
    'Deny: ' + denyUrl + '\n';
  try {
    await sendEmail(env, { to: adminEmail, subject, html, text });
  } catch (e) {
    console.error('[max] admin notification failed:', e);
  }
}

// ── Dev login (kept for local testing) ─────────────────────
// v359.60.82: name is required on sign-up. Optional in the schema
// so existing /dev-login callers without a name still work, but the
// /magic-link handler enforces it for new sign-ins.
const loginSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(100).optional(),
});

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
  // v359.60.81: gate dev-login behind the access-grants check too.
  if (!(await _canSignIn(env, parsed.data.email))) {
    return c.json({ error: 'This email is not authorized to sign in.' }, 403);
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
  const name = (parsed.data.name || '').trim() || null;

  // v359.60.82: name is required for new sign-ups. If the user is
  // already in the access_grants table (any status) OR in users (via
  // a session bound to email), name is optional — we already have it.
  const existingGrant = await _getGrant(email);
  const existingUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (!existingGrant && !existingUser && !name) {
    return c.json({ error: 'Name is required for new sign-ups.' }, 400);
  }

  // v359.60.81: branch on access-grant status.
  // 1) Bootstrap-approved (ALLOWED_EMAILS env var) → straight to magic-link.
  // 2) DB-approved → straight to magic-link.
  // 3) Pending → tell user request is already submitted.
  // 4) Denied / revoked → tell user sign-in unavailable.
  // 5) No record → create pending row, notify admin, tell user.
  if (_isBootstrapAllowed(env, email)) {
    const result = await _issueMagicLink(env, email, name || (existingUser ? existingUser.displayName : null));
    if (result.directLink) {
      return c.json({
        ok: true,
        message: 'Email service not configured — use the link below directly (it expires in 15 minutes).',
        directLink: result.directLink,
      });
    }
    return c.json({ ok: true, message: 'Check your email for a sign-in link.' });
  }

  if (existingGrant) {
    if (existingGrant.status === 'approved') {
      const result = await _issueMagicLink(env, email, name || existingGrant.name);
      if (result.directLink) {
        return c.json({ ok: true, message: 'Email service not configured — use the link below directly (it expires in 15 minutes).', directLink: result.directLink });
      }
      return c.json({ ok: true, message: 'Check your email for a sign-in link.' });
    }
    if (existingGrant.status === 'pending') {
      return c.json({
        ok: true,
        status: 'pending',
        message: 'Your request is awaiting approval. You\'ll receive an email when access is granted.',
      });
    }
    if (existingGrant.status === 'denied' || existingGrant.status === 'revoked') {
      return c.json({
        ok: false,
        status: existingGrant.status,
        error: 'Sign-in for this email is not available. Contact the admin if you believe this is a mistake.',
      }, 403);
    }
  }

  // No record yet — create a pending request with one-time approve/deny tokens.
  const approveToken = randomUUID();
  const denyToken = randomUUID();
  try {
    await db
      .insert(schema.accessGrants)
      .values({
        email,
        status: 'pending',
        name,
        approveToken,
        denyToken,
        requestedAt: new Date(),
      })
      .run();
  } catch (e) {
    console.error('[max] access_grants insert failed:', e);
    return c.json({ error: 'Could not record sign-in request' }, 500);
  }
  // Fire-and-forget admin notification.
  await _notifyAdminOfRequest(env, email, approveToken, denyToken, name);
  return c.json({
    ok: true,
    status: 'pending',
    message: 'Your sign-in request has been sent for approval. You\'ll receive an email once it\'s reviewed.',
  });
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
  // v359.60.81: re-check approval at verify time. If status was
  // revoked between the magic-link email and the click, reject.
  if (!(await _canSignIn(env, magic.email))) {
    return c.redirect(clientBase + '/?signin=error&reason=not_authorized');
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
    // v359.60.82: populate displayName from the magic-link request's
    // captured name so the user's name shows up on their account
    // record from the very first session.
    await db
      .insert(schema.users)
      .values({ id, email, displayName: magic.name || null })
      .run();
    user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .get();
    if (!user) {
      return c.redirect(clientBase + '/?signin=error&reason=user_create_failed');
    }
  } else if (magic.name && !user.displayName) {
    // Backfill displayName for users who signed up before name capture
    // existed, if they provide one on a later sign-in.
    await db
      .update(schema.users)
      .set({ displayName: magic.name })
      .where(eq(schema.users.id, user.id))
      .run();
    user = { ...user, displayName: magic.name };
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

// ── Admin endpoints ────────────────────────────────────────
// v359.60.81: approve / deny / revoke / list. The approve and deny
// links land in the admin notification email, gated by one-time
// tokens stored on the access_grants row (consumed on use). The
// revoke and grants endpoints are protected by the ADMIN_TOKEN env
// var — pass it as `?adminToken=...` in the URL.
const adminApi = new Hono();

function _renderHtmlPage(title: string, bodyHtml: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title></head>' +
    '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f7f7f5;padding:40px 20px;color:#333;line-height:1.55;">' +
    '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:10px;padding:28px 32px;box-shadow:0 2px 8px rgba(0,0,0,.06);">' +
    bodyHtml +
    '</div></body></html>'
  );
}

// GET /admin/approve?email=X&token=Y — consume the one-time approve
// token and auto-send the user a sign-in magic link.
adminApi.get('/approve', async (c) => {
  const env = (c.env as Record<string, string | undefined>) || {};
  const email = (c.req.query('email') || '').trim().toLowerCase();
  const token = c.req.query('token') || '';
  if (!email || !token) {
    return c.html(_renderHtmlPage('Bad request', '<h2>Missing email or token</h2><p>The approval link is incomplete.</p>'), 400);
  }
  const grant = await _getGrant(email);
  if (!grant) {
    return c.html(_renderHtmlPage('Not found', '<h2>No request found</h2><p>No sign-in request exists for <strong>' + email + '</strong>.</p>'), 404);
  }
  if (grant.status === 'approved') {
    return c.html(_renderHtmlPage('Already approved', '<h2>Already approved</h2><p><strong>' + email + '</strong> is already approved. They can sign in any time.</p>'));
  }
  if (grant.approveToken !== token) {
    return c.html(_renderHtmlPage('Token mismatch', '<h2>Invalid or already-used link</h2><p>This approval link has already been used or is incorrect.</p>'), 403);
  }
  await db
    .update(schema.accessGrants)
    .set({
      status: 'approved',
      approveToken: null,
      denyToken: null,
      decidedAt: new Date(),
    })
    .where(eq(schema.accessGrants.email, email))
    .run();
  // Auto-send the user their sign-in link; pass through the name
  // captured on the original request so /verify can use it to populate
  // the new user's displayName.
  const result = await _issueMagicLink(env, email, grant.name);
  const detail = result.sent
    ? '<p>A sign-in link has been emailed to <strong>' + email + '</strong>.</p>'
    : '<p>Approved <strong>' + email + '</strong>, but no email was sent because the email service isn\'t configured. Share this link with them manually:</p>' +
      '<p style="word-break:break-all;background:#f5f5f5;padding:10px;border-radius:6px;font-size:12px;">' + (result.directLink || '(no link)') + '</p>';
  return c.html(_renderHtmlPage('Approved', '<h2 style="color:#2a7a4e;">✓ Approved</h2>' + detail));
});

// GET /admin/deny?email=X&token=Y — consume the one-time deny token.
adminApi.get('/deny', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase();
  const token = c.req.query('token') || '';
  if (!email || !token) {
    return c.html(_renderHtmlPage('Bad request', '<h2>Missing email or token</h2>'), 400);
  }
  const grant = await _getGrant(email);
  if (!grant) {
    return c.html(_renderHtmlPage('Not found', '<h2>No request found</h2>'), 404);
  }
  if (grant.denyToken !== token) {
    return c.html(_renderHtmlPage('Token mismatch', '<h2>Invalid or already-used link</h2>'), 403);
  }
  await db
    .update(schema.accessGrants)
    .set({
      status: 'denied',
      approveToken: null,
      denyToken: null,
      decidedAt: new Date(),
    })
    .where(eq(schema.accessGrants.email, email))
    .run();
  return c.html(_renderHtmlPage('Denied', '<h2 style="color:#c44;">✗ Denied</h2><p><strong>' + email + '</strong> has been denied. They\'ll see a "sign-in unavailable" message.</p>'));
});

function _requireAdmin(env: Record<string, string | undefined>, c: import('hono').Context): Response | null {
  const adminToken = env.ADMIN_TOKEN;
  if (!adminToken) {
    return c.json({ error: 'Admin endpoints disabled (ADMIN_TOKEN not set)' }, 503);
  }
  const supplied = c.req.query('adminToken') || c.req.header('X-Admin-Token') || '';
  if (supplied !== adminToken) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return null;
}

// POST /admin/revoke { email } — flip status to 'revoked' and delete
// all sessions for that user so they're immediately signed out. The
// ADMIN_TOKEN guards this endpoint.
adminApi.post('/revoke', async (c) => {
  const env = (c.env as Record<string, string | undefined>) || {};
  const denied = _requireAdmin(env, c);
  if (denied) return denied;
  const body = await c.req.json().catch(() => null);
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
  if (!email) return c.json({ error: 'email required' }, 400);
  // Upsert: mark revoked even if no prior grant existed.
  const existing = await _getGrant(email);
  if (existing) {
    await db
      .update(schema.accessGrants)
      .set({ status: 'revoked', approveToken: null, denyToken: null, decidedAt: new Date() })
      .where(eq(schema.accessGrants.email, email))
      .run();
  } else {
    await db
      .insert(schema.accessGrants)
      .values({ email, status: 'revoked', requestedAt: new Date(), decidedAt: new Date() })
      .run();
  }
  // Wipe sessions for the user if they have an account.
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  let sessionsKilled = 0;
  if (user) {
    const result = await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id)).run();
    sessionsKilled = (result as { rowsAffected?: number }).rowsAffected || 0;
  }
  return c.json({ ok: true, email, status: 'revoked', sessionsKilled });
});

// GET /admin/grants?adminToken=... — list every access grant on file.
// Handy for "who's pending?" / "who do I have approved?" sweeps.
adminApi.get('/grants', async (c) => {
  const env = (c.env as Record<string, string | undefined>) || {};
  const denied = _requireAdmin(env, c);
  if (denied) return denied;
  const rows = await db.select().from(schema.accessGrants).all();
  return c.json({ ok: true, grants: rows });
});

export { authApi, adminApi };
