-- v360.0.0 — Phase 2: email auto-import infrastructure.
--
-- Two new tables:
--
-- user_inboxes — one row per user holding their unique forwarding
-- address token. The full address is `{inbox_token}@inbox.travelingwithmax.app`.
-- Created lazily the first time the user visits the Profile page's
-- forwarding section. last_received_at drives the "Last forwarded
-- email: 2 hours ago" indicator on the Profile page.
--
-- pending_emails — durable inbox for raw forwarded emails. The
-- Email Worker (separate Cloudflare Worker, see server/email-worker/)
-- writes here on receipt; the parser job reads from here, calls the
-- LLM to extract booking data, and either creates a booking or marks
-- the row failed. parse_status workflow:
--   'received'  — Email Worker wrote it
--   'parsing'   — parser claimed it
--   'parsed'    — booking created
--   'failed'    — parser threw
--   'duplicate' — re-forward of an already-processed email
--
-- Both tables are additive; no destructive changes.

CREATE TABLE IF NOT EXISTS user_inboxes (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  inbox_token      TEXT NOT NULL UNIQUE,
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  last_received_at INTEGER
);

CREATE TABLE IF NOT EXISTS pending_emails (
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
);

CREATE INDEX IF NOT EXISTS pending_emails_inbox_token_idx
  ON pending_emails(inbox_token);

CREATE INDEX IF NOT EXISTS pending_emails_status_idx
  ON pending_emails(parse_status);
