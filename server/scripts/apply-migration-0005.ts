// One-shot migration runner for 0005_conversations.sql.
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/apply-migration-0005.ts
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

  if (await tableExists('conversations')) {
    console.log('→ conversations table already exists, skipping CREATE');
  } else {
    console.log('→ creating conversations table');
    await client.execute(`
      CREATE TABLE conversations (
        trip_id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        messages text DEFAULT '[]' NOT NULL,
        updated_at integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
        created_at integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
        FOREIGN KEY (trip_id) REFERENCES trips(id) ON UPDATE no action ON DELETE cascade,
        FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
      )
    `);
  }

  const r = await client.execute('PRAGMA table_info(conversations)');
  console.log(
    '  conversations columns:',
    r.rows.map((row) => row.name).join(', '),
  );

  console.log('✓ migration 0005 applied');
}

run().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
