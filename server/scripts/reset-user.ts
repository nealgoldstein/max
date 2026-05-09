// One-shot user reset. Wipes a single user's server state — trips,
// prefs, sessions, magic tokens — but keeps the user row itself
// (so the email is still recognized on next sign-in).
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' EMAIL='you@example.com' \
//     npx tsx scripts/reset-user.ts
//
// Confirms before deleting. Pass FORCE=1 to skip the confirmation.

import { createClient } from '@libsql/client';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const url = process.env.TURSO_URL || process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const email = process.env.EMAIL;
const force = process.env.FORCE === '1';

if (!url || !email) {
  console.error('✗ Set TURSO_URL, TURSO_AUTH_TOKEN, and EMAIL env vars');
  process.exit(1);
}
if (!authToken && url.startsWith('libsql://')) {
  console.error('✗ TURSO_AUTH_TOKEN not set');
  process.exit(1);
}

const client = createClient({ url, authToken });

async function run() {
  const userRes = await client.execute({
    sql: 'SELECT id, email, display_name FROM users WHERE email = ?',
    args: [email!],
  });
  if (userRes.rows.length === 0) {
    console.log('→ no user with email', email, '— nothing to reset');
    return;
  }
  const user = userRes.rows[0];
  console.log('→ found user:', user.email, '(id:', user.id, ')');

  const trips = await client.execute({
    sql: 'SELECT COUNT(*) AS n FROM trips WHERE user_id = ?',
    args: [user.id],
  });
  const sessions = await client.execute({
    sql: 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?',
    args: [user.id],
  });
  const prefs = await client.execute({
    sql: 'SELECT COUNT(*) AS n FROM user_prefs WHERE user_id = ?',
    args: [user.id],
  });
  console.log('  trips     :', trips.rows[0].n);
  console.log('  sessions  :', sessions.rows[0].n);
  console.log('  user_prefs:', prefs.rows[0].n);

  if (!force) {
    const rl = readline.createInterface({ input, output });
    const ans = await rl.question(
      'About to DELETE the rows above. Type "yes" to proceed: ',
    );
    rl.close();
    if (ans.trim().toLowerCase() !== 'yes') {
      console.log('→ aborted');
      return;
    }
  }

  await client.execute({
    sql: 'DELETE FROM trips WHERE user_id = ?',
    args: [user.id],
  });
  await client.execute({
    sql: 'DELETE FROM user_prefs WHERE user_id = ?',
    args: [user.id],
  });
  await client.execute({
    sql: 'DELETE FROM sessions WHERE user_id = ?',
    args: [user.id],
  });
  await client.execute({
    sql: 'DELETE FROM magic_tokens WHERE email = ?',
    args: [email!],
  });

  console.log('✓ wiped server-side state for', email);
  console.log('  next: clear local state in your browser dev console:');
  console.log('  localStorage.clear(); indexedDB.deleteDatabase(\'max-llm-cache\');');
  console.log('  caches.keys().then(ks => ks.forEach(k => caches.delete(k)));');
  console.log('  location.reload();');
}

run().catch((e) => {
  console.error('✗ reset failed:', e);
  process.exit(1);
});
