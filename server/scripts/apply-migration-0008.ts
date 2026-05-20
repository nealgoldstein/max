// One-shot migration runner for 0008_marketing_opt_in.sql.
//
// Adds marketing_opt_in (boolean) + marketing_opt_in_at (timestamp)
// to users and marketing_opt_in (boolean) to access_grants. Captures
// at sign-up; propagated to users at /verify.
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/apply-migration-0008.ts
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

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await client.execute('PRAGMA table_info(' + table + ')');
  return r.rows.some((row) => row.name === column);
}

async function run() {
  console.log('→ connected to', url);

  if (!(await columnExists('users', 'marketing_opt_in'))) {
    console.log('→ adding marketing_opt_in to users');
    await client.execute('ALTER TABLE users ADD COLUMN marketing_opt_in INTEGER DEFAULT 0');
  }
  if (!(await columnExists('users', 'marketing_opt_in_at'))) {
    console.log('→ adding marketing_opt_in_at to users');
    await client.execute('ALTER TABLE users ADD COLUMN marketing_opt_in_at INTEGER');
  }
  if (!(await columnExists('access_grants', 'marketing_opt_in'))) {
    console.log('→ adding marketing_opt_in to access_grants');
    await client.execute('ALTER TABLE access_grants ADD COLUMN marketing_opt_in INTEGER DEFAULT 0');
  }
  if (!(await columnExists('magic_tokens', 'marketing_opt_in'))) {
    console.log('→ adding marketing_opt_in to magic_tokens');
    await client.execute('ALTER TABLE magic_tokens ADD COLUMN marketing_opt_in INTEGER DEFAULT 0');
  }

  const u = await client.execute('PRAGMA table_info(users)');
  console.log('  users columns:', u.rows.map((row) => row.name).join(', '));
  const g = await client.execute('PRAGMA table_info(access_grants)');
  console.log('  access_grants columns:', g.rows.map((row) => row.name).join(', '));

  console.log('✓ migration 0008 applied');
}

run().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
