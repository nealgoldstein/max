# Max — admin guide

How to control who can sign in to Max via MaxSync.

## Two approval models, side by side

Max has two complementary mechanisms for gating sign-in:

1. **Bootstrap allowlist (`ALLOWED_EMAILS` env var)** — a static list of emails that are always allowed to sign in, no DB lookup. Useful for owner accounts you never want to gate.
2. **Approval workflow (`access_grants` DB table)** — for everyone else. The first time an email tries to sign in, you (the admin) get an email with Approve / Deny buttons. Approved emails get a magic-link to complete sign-in. You can later revoke any email and immediately kick them out of all their sessions.

You can run with both, just one, or neither. Default (nothing configured) is open sign-up.

---

## One-time setup

### 1. Apply the database migration

The `access_grants` table needs to exist before the approval workflow works:

```bash
cd server
TURSO_URL='libsql://<your-turso-host>' \
  TURSO_AUTH_TOKEN='<your-turso-token>' \
  npx tsx scripts/apply-migration-0007.ts
```

Should print `✓ migration 0007 applied`. Safe to re-run; it skips the CREATE if the table already exists.

### 2. Set Cloudflare Worker secrets

You'll set three or four secrets via `wrangler secret put`:

```bash
cd server

# Optional: bootstrap allowlist — always-on, no approval needed for these
wrangler secret put ALLOWED_EMAILS
# paste: neal@nealgoldstein.com

# Where Approve/Deny notifications get sent
wrangler secret put ADMIN_EMAIL
# paste: neal@nealgoldstein.com

# Random string for /admin/revoke + /admin/grants auth
wrangler secret put ADMIN_TOKEN
# paste: a long random string. Example:
#   openssl rand -hex 32
# Store this in a password manager — you can't read it back from Cloudflare.

# Required for magic-link emails (already set if you've been using the app)
# wrangler secret put RESEND_API_KEY
```

Then redeploy so the code that reads them takes effect:

```bash
wrangler deploy
```

### 3. Verify

```bash
wrangler secret list
```

Should show `ALLOWED_EMAILS`, `ADMIN_EMAIL`, `ADMIN_TOKEN`, plus the existing `TURSO_*`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`.

---

## Day-to-day: how it works

### When someone wants to sign in

1. The user enters their email in the Max sign-in modal.
2. The server checks (in order):
   - If their email is in `ALLOWED_EMAILS`, they immediately get a magic-link email.
   - If their email is in `access_grants` with status='approved', same.
   - If status='pending', they see "Your request is awaiting approval."
   - If status='denied' or 'revoked', they see "Sign-in for this email is not available."
   - Else (first time), a `pending` row is created and **you get an email** with their address + two buttons:
     - **✓ Approve** — flips status to 'approved' and auto-sends them a magic link.
     - **✗ Deny** — flips status to 'denied'.
     - These are one-time-use links; clicking either consumes both.
3. The user's screen shows: "Your sign-in request has been sent for approval. You'll receive an email once it's reviewed."

### Approving someone

Just click the Approve button in the email you receive. A confirmation page loads showing "✓ Approved — A sign-in link has been emailed to {their email}". They get the magic link in their inbox within seconds.

### Denying someone

Click the Deny button in the email. Confirmation page: "✗ Denied — They'll see a 'sign-in unavailable' message." They get no further email; the next time they try, they see the denied message.

### Revoking someone later

Approve / deny links are one-time-use. To kick someone off after they're approved (e.g., test period ended), use the `/admin/revoke` endpoint:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"tester@example.com"}' \
  'https://api.travelingwithmax.app/admin/revoke?adminToken=<YOUR_ADMIN_TOKEN>'
```

This:
- Sets their `access_grants.status = 'revoked'`
- **Deletes all their active sessions** — they're signed out everywhere immediately
- Returns `{ "ok": true, "email": "...", "status": "revoked", "sessionsKilled": <n> }`

If they try to sign in again, they'll see "Sign-in for this email is not available."

### Re-approving a revoked user

Either edit the `access_grants` row directly (set `status='approved'`) via Turso CLI, or revoke + delete the row + have them request fresh. Easiest:

```bash
# Hit /admin/revoke first to wipe sessions, then have them sign in
# again — they'll show as a fresh pending request.
# OR via SQL:
turso db shell <your-db>
UPDATE access_grants SET status='approved', decided_at=strftime('%s','now')*1000 WHERE email='tester@example.com';
```

### See who's on the list

```bash
curl 'https://api.travelingwithmax.app/admin/grants?adminToken=<YOUR_ADMIN_TOKEN>'
```

Returns `{ "ok": true, "grants": [ {email, status, requestedAt, decidedAt, ...}, ... ] }`. Bootstrap-allowlist emails (`ALLOWED_EMAILS`) won't appear unless they've also gone through the workflow.

---

## Quick recipes

### "I want to test with one friend, then revoke after the trip"

1. Tell friend to visit travelingwithmax.app and try to sign in with their email.
2. You get an email with their address + Approve button. Click it.
3. They get a magic-link email, click it, sign in, test.
4. When done:
   ```bash
   curl -X POST -H 'Content-Type: application/json' \
     -d '{"email":"friend@example.com"}' \
     'https://api.travelingwithmax.app/admin/revoke?adminToken=<YOUR_ADMIN_TOKEN>'
   ```

### "I want to lock the app to only me"

```bash
wrangler secret put ALLOWED_EMAILS
# paste: neal@nealgoldstein.com
wrangler deploy
```

Anyone else who tries gets the "request awaiting approval" message, you get the email and just never click Approve — or click Deny.

### "I want to invite a small group, no approval round-trip"

Skip the approval flow entirely — list them all on `ALLOWED_EMAILS`:

```bash
wrangler secret put ALLOWED_EMAILS
# paste: neal@nealgoldstein.com,alice@example.com,bob@example.com
wrangler deploy
```

They all sign in without you doing anything.

### "I want fully open sign-up"

Don't set `ALLOWED_EMAILS`, `ADMIN_EMAIL`, or `ADMIN_TOKEN`. The access_grants check still runs but with no admin email, requests sit as 'pending' forever (no one can sign in). To genuinely open everything: delete the `ADMIN_EMAIL` secret and add a row per user manually as 'approved', OR just patch `_canSignIn` to return true unconditionally. (Not generally what you want.)

---

## Troubleshooting

**"I approved someone but they didn't get an email."**
- Check `wrangler tail` while they click the magic link.
- Verify `RESEND_API_KEY` is set: `wrangler secret list`.
- The `/admin/approve` confirmation page falls back to displaying the link directly if email send fails — you can copy-paste it to them.

**"They got the magic link but it says 'not authorized'."**
- Their `access_grants.status` got revoked between the approve and the click. Re-approve via SQL or have them re-request.

**"I lost my ADMIN_TOKEN."**
- Set a new one with `wrangler secret put ADMIN_TOKEN` and redeploy. The old one is invalidated immediately.

**"I want to clear the entire access_grants table and start over."**
```bash
turso db shell <your-db>
DELETE FROM access_grants;
```
All pending requests vanish; future first-time sign-ins start fresh.

---

## Security notes

- The Approve / Deny links in admin emails contain one-time tokens scoped to that specific email + that specific action. Clicking Approve cannot accidentally approve someone else; clicking Deny cannot be re-used.
- `ADMIN_TOKEN` guards revoke + grants listing. Treat it like a password. Rotate periodically with `wrangler secret put ADMIN_TOKEN`.
- The bootstrap `ALLOWED_EMAILS` list is in the worker's secrets, not in code. Editing it requires both the secret update AND `wrangler deploy`.
- Existing sessions survive a revoke only if you don't call `/admin/revoke` — the endpoint deletes them. So always use `/admin/revoke`, not direct SQL, for kicking someone off.
