// One-shot user deletion script. Takes a single email, removes:
//   - The users row (cascades to sessions, trips, user_inboxes, user_prefs)
//   - Any matching access_grants row
//   - Any pending_emails rows tied to their inbox token (best-effort; the
//     inbox row is gone after the cascade, so we look those up first)
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/delete-user.ts user@example.com
//
// Prints what it deleted for safety. Refuses to run without an email arg
// so a fat-finger doesn't drop your whole user table.

import { createClient } from '@libsql/client';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: npx tsx scripts/delete-user.ts user@example.com');
  process.exit(1);
}

const url = process.env.TURSO_URL || process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error('✗ TURSO_URL (or DATABASE_URL) not set');
  process.exit(1);
}
if (!authToken && url.startsWith('libsql://')) {
  console.error('✗ TURSO_AUTH_TOKEN not set (required for libsql:// URLs)');
  process.exit(1);
}

const client = createClient({ url, authToken });

async function run() {
  console.log('→ deleting user:', email);

  // Look up the user first so we can report what's being deleted.
  const userRow = await client.execute({
    sql: 'SELECT id, display_name FROM users WHERE email = ?',
    args: [email],
  });
  if (userRow.rows.length === 0) {
    console.log('  no users row for that email');
  } else {
    const userId = userRow.rows[0].id as string;
    console.log('  found users row id=' + userId + ' name=' + (userRow.rows[0].display_name || '(none)'));

    // Look up the inbox token so we can clean orphaned pending_emails.
    const inbox = await client.execute({
      sql: 'SELECT inbox_token FROM user_inboxes WHERE user_id = ?',
      args: [userId],
    });
    const inboxToken = inbox.rows[0]?.inbox_token as string | undefined;
    if (inboxToken) {
      const pe = await client.execute({
        sql: 'DELETE FROM pending_emails WHERE inbox_token = ?',
        args: [inboxToken],
      });
      console.log('  deleted', (pe as { rowsAffected?: number }).rowsAffected || 0, 'pending_emails rows');
    }

    // Now delete the user — cascade handles sessions, trips, user_inboxes,
    // user_prefs.
    const ud = await client.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [userId],
    });
    console.log('  deleted', (ud as { rowsAffected?: number }).rowsAffected || 0, 'users row (cascade: sessions, trips, user_inboxes, user_prefs)');
  }

  // Access grants are keyed on email, not user_id, so handle separately.
  const ag = await client.execute({
    sql: 'DELETE FROM access_grants WHERE email = ?',
    args: [email],
  });
  console.log('  deleted', (ag as { rowsAffected?: number }).rowsAffected || 0, 'access_grants row');

  console.log('✓ done');
}

run().catch((e) => {
  console.error('✗ failed:', e);
  process.exit(1);
});
