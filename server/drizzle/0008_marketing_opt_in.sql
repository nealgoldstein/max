-- v359.60.87: marketing email consent. Captured at sign-up via the
-- "Send me occasional emails…" checkbox, stored on access_grants
-- (pending requests) then propagated to users at /verify time.
-- marketing_opt_in_at records when the user consented (or revoked,
-- future use). Both default to 0/null so existing rows aren't
-- silently opted in.

ALTER TABLE users ADD COLUMN marketing_opt_in INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN marketing_opt_in_at INTEGER;
ALTER TABLE access_grants ADD COLUMN marketing_opt_in INTEGER DEFAULT 0;
