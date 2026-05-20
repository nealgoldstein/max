-- v359.60.81: access_grants table for sign-in approval workflow.
-- Each email that ever tries to sign in lives here with one of four
-- statuses: 'pending' (request submitted, awaiting admin approval),
-- 'approved' (sign-in allowed), 'denied' (request denied), 'revoked'
-- (was approved, now removed). approve_token + deny_token are
-- one-time-use random secrets sent in admin notification emails;
-- consuming them flips status to approved/denied and clears the
-- tokens so the link can't be reused.

CREATE TABLE IF NOT EXISTS access_grants (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  name TEXT,
  approve_token TEXT,
  deny_token TEXT,
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  notes TEXT
);
