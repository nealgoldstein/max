// One-shot migration runner for 0003_user_prefs_and_trip_ui_state.sql.
//
// Drizzle-kit push works against schema diffs; this script runs the
// hand-written migration directly so what lands on prod is exactly
// what's in 0003_user_prefs_and_trip_ui_state.sql. Idempotent — safe
// to run twice. Drop it after the migration ships.
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/apply-migration-0003.ts
//
// The credentials are the same ones you set as worker secrets:
//   wrangler secret put TURSO_URL
//   wrangler secret put TURSO_AUTH_TOKEN
// Cloudflare doesn't let you read secrets back, so pull these from
// wherever you stashed them when you first set up Turso.

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

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await client.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === column);
}

async function run() {
  console.log('→ connected to', url);

  // user_prefs table
  if (await tableExists('user_prefs')) {
    console.log('→ user_prefs table already exists, skipping CREATE');
  } else {
    console.log('→ creating user_prefs table');
    await client.execute(`
      CREATE TABLE user_prefs (
        user_id text PRIMARY KEY NOT NULL,
        prefs text DEFAULT '{}' NOT NULL,
        updated_at integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
        created_at integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
      )
    `);
  }

  // trips.ui_state column
  if (await columnExists('trips', 'ui_state')) {
    console.log('→ trips.ui_state column already exists, skipping ALTER');
  } else {
    console.log("→ adding trips.ui_state column (default '{}')");
    await client.execute(
      "ALTER TABLE trips ADD COLUMN ui_state text DEFAULT '{}'",
    );
  }

  // Verify
  console.log('→ verifying…');
  const tr = await client.execute('PRAGMA table_info(trips)');
  const upr = await client.execute('PRAGMA table_info(user_prefs)');
  console.log(
    '  trips columns      :',
    tr.rows.map((r) => r.name).join(', '),
  );
  console.log(
    '  user_prefs columns :',
    upr.rows.map((r) => r.name).join(', '),
  );

  console.log('✓ migration 0003 applied');
}

run().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
