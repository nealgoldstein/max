// One-shot migration runner for 0010_trip_rev.sql.
//
// Adds the server-owned monotonic `rev` counter to trips — the
// revision-based sync that replaces wall-clock last-write-wins.
// See server/drizzle/0010_trip_rev.sql for rationale.
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/apply-migration-0010.ts
//
// Idempotent — checks for the column before adding it.

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

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  });
  return r.rows.length > 0;
}

async function run() {
  console.log('→ connected to', url);

  if (!(await columnExists('trips', 'rev'))) {
    console.log('→ adding trips.rev');
    await client.execute(
      `ALTER TABLE trips ADD COLUMN rev INTEGER NOT NULL DEFAULT 0`,
    );
  } else {
    console.log('  trips.rev already exists, skipping');
  }

  console.log('✓ migration 0010 applied');
}

run().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
