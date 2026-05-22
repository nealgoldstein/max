// One-shot migration runner for 0009_email_auto_import.sql.
//
// Adds user_inboxes + pending_emails tables to support Phase 2
// (email auto-import). See server/drizzle/0009_email_auto_import.sql
// for the schema rationale.
//
// Usage:
//   cd server
//   TURSO_URL='libsql://...' TURSO_AUTH_TOKEN='...' \
//     npx tsx scripts/apply-migration-0009.ts
//
// Idempotent — safe to re-run. Uses CREATE TABLE IF NOT EXISTS and
// CREATE INDEX IF NOT EXISTS so a partial application followed by a
// re-run completes cleanly.

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

  if (!(await tableExists('user_inboxes'))) {
    console.log('→ creating user_inboxes');
    await client.execute(`
      CREATE TABLE user_inboxes (
        user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        inbox_token      TEXT NOT NULL UNIQUE,
        created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        last_received_at INTEGER
      )
    `);
  } else {
    console.log('  user_inboxes already exists, skipping');
  }

  if (!(await tableExists('pending_emails'))) {
    console.log('→ creating pending_emails');
    await client.execute(`
      CREATE TABLE pending_emails (
        id              TEXT PRIMARY KEY,
        to_address      TEXT NOT NULL,
        inbox_token     TEXT NOT NULL,
        from_address    TEXT,
        subject         TEXT,
        body_text       TEXT,
        body_html       TEXT,
        size_bytes      INTEGER,
        received_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        parse_status    TEXT NOT NULL DEFAULT 'received',
        processed_at    INTEGER,
        parsed_json     TEXT,
        booking_id      TEXT,
        trip_id         TEXT,
        error           TEXT
      )
    `);
    console.log('→ adding pending_emails indexes');
    await client.execute(
      'CREATE INDEX pending_emails_inbox_token_idx ON pending_emails(inbox_token)',
    );
    await client.execute(
      'CREATE INDEX pending_emails_status_idx ON pending_emails(parse_status)',
    );
  } else {
    console.log('  pending_emails already exists, skipping');
  }

  // Verify
  const ui = await client.execute('PRAGMA table_info(user_inboxes)');
  console.log('  user_inboxes columns:', ui.rows.map((row) => row.name).join(', '));
  const pe = await client.execute('PRAGMA table_info(pending_emails)');
  console.log('  pending_emails columns:', pe.rows.map((row) => row.name).join(', '));

  console.log('✓ migration 0009 applied');
}

run().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
