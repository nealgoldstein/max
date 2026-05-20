// One-shot migration runner for 0007_access_grants.sql.
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/apply-migration-0007.ts
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

  if (await tableExists('access_grants')) {
    console.log('→ access_grants table already exists, skipping CREATE');
  } else {
    console.log('→ creating access_grants table');
    await client.execute(`
      CREATE TABLE access_grants (
        email TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        name TEXT,
        approve_token TEXT,
        deny_token TEXT,
        requested_at INTEGER NOT NULL,
        decided_at INTEGER,
        notes TEXT
      )
    `);
  }

  // v359.60.82: ensure access_grants has the name column (idempotent
  // — runs the ALTER only when missing, so the migration is safe to
  // re-run on an already-created table from an earlier rev).
  const agCols = await client.execute('PRAGMA table_info(access_grants)');
  const agColNames = agCols.rows.map((row) => row.name);
  if (!agColNames.includes('name')) {
    console.log('→ adding name column to access_grants');
    await client.execute('ALTER TABLE access_grants ADD COLUMN name TEXT');
  }

  // v359.60.82: same for magic_tokens — the existing table from
  // migration 0002 didn't carry a name column.
  if (await tableExists('magic_tokens')) {
    const mtCols = await client.execute('PRAGMA table_info(magic_tokens)');
    const mtColNames = mtCols.rows.map((row) => row.name);
    if (!mtColNames.includes('name')) {
      console.log('→ adding name column to magic_tokens');
      await client.execute('ALTER TABLE magic_tokens ADD COLUMN name TEXT');
    }
  }

  const r = await client.execute('PRAGMA table_info(access_grants)');
  console.log(
    '  access_grants columns:',
    r.rows.map((row) => row.name).join(', '),
  );

  console.log('✓ migration 0007 applied');
}

run().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
