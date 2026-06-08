-- PD.334: revision-based sync. Wall-clock last-write-wins (updatedAt)
-- trusts device clocks — a fast client clock makes stale data look
-- fresh and can overwrite newer work. `rev` is a server-owned
-- monotonic counter: bumped by the server on every successful write,
-- never set by clients. Clients send the rev their edit was based on
-- (baseRev); a mismatch is a real conflict regardless of what any
-- clock says. Existing rows default to 0; the first PUT from an
-- updated client (baseRev 0) matches and bumps to 1.

ALTER TABLE trips ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
