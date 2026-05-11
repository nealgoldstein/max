// One-shot migration runner for v356.6 — reminders_sent table.
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/apply-migration-0006.ts
//
// Idempotent — safe to re-run.

import { createClient } from '@libsql/client';

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

async function tableExists(name: string): Promise<boolean> {
  const r = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function run() {
  console.log('→ connected to', url);

  if (await tableExists('reminders_sent')) {
    console.log('→ reminders_sent table already exists, skipping CREATE');
  } else {
    console.log('→ creating reminders_sent table');
    await client.execute(`
      CREATE TABLE reminders_sent (
        user_id text NOT NULL,
        trip_id text NOT NULL,
        days_before integer NOT NULL,
        sent_at integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
        PRIMARY KEY (user_id, trip_id, days_before)
      )
    `);
  }

  const r = await client.execute('PRAGMA table_info(reminders_sent)');
  console.log(
    '  reminders_sent columns:',
    r.rows.map((row) => row.name).join(', '),
  );

  console.log('✓ migration 0006 applied');
}

run().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
