// Max backend schema — v0.1.0
//
// Three tables for the skeleton round:
//   users      — one row per real human, keyed on email
//   sessions   — bearer tokens (dev mode: one per user, hand-issued).
//                Real auth (Lucia / Auth0 / etc.) replaces this in
//                the next round; the table shape stays the same so
//                client code doesn't have to change.
//   trips      — one row per trip. Body is the JSON the client
//                already serializes (see serializeTrip in index.html).
//                updatedAt drives last-write-wins sync between
//                desktop and mobile.
//
// Why SQLite for dev: zero-config, file on disk, dump it whenever.
// Postgres lands when we deploy — same Drizzle schema, same queries.

import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  // v359.60.87: marketing email consent. marketingOptIn is the
  // boolean; marketingOptInAt records when they consented (or revoked,
  // future use). Null = no decision recorded yet. Populated from the
  // sign-up form via access_grants → users at /verify time.
  marketingOptIn: integer('marketing_opt_in', { mode: 'boolean' }).default(false),
  marketingOptInAt: integer('marketing_opt_in_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s', 'now') * 1000)`),
});

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s', 'now') * 1000)`),
});

export const trips = sqliteTable(
  'trips',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // The client's existing serialized trip JSON — the entire trip
    // object stringified. We don't index INTO it server-side; the
    // server treats it as opaque payload. Mobile and desktop both
    // round-trip the same shape.
    body: text('body', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    // v353.2: per-trip UI state (which banners are expanded, which
    // dest's Research panel is collapsed, etc.). Separate column
    // from `body` so it can be updated independently of the trip
    // content — small UI flips don't have to round-trip the full
    // trip payload through the wire. Sync follows the trip via
    // existing GET/PUT /trips/:id routes.
    uiState: text('ui_state', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .default(sql`'{}'`),
    // updatedAt drives sync. Client compares its local timestamp to
    // remote; newer wins. For now last-write-wins is fine; we'll
    // add per-field merge in a later round if conflicts get common.
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(strftime('%s', 'now') * 1000)`),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(strftime('%s', 'now') * 1000)`),
  },
  (table) => ({
    userIdIdx: index('trips_user_id_idx').on(table.userId),
    updatedAtIdx: index('trips_updated_at_idx').on(table.updatedAt),
  }),
);

// v353.2: user-level preferences. Single JSON blob per user — paceHours
// and any future cross-device pref (defaultTripDuration, currency,
// language, etc.). Distinct from per-trip UI state (lives on trips
// table) and from device-local UI state (stays in localStorage).
// One row per user; updatedAt drives last-write-wins between devices
// — same model as trips, simpler since the blob is small.
export const userPrefs = sqliteTable('user_prefs', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  prefs: text('prefs', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s', 'now') * 1000)`),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s', 'now') * 1000)`),
});

// Per-user, per-month LLM usage. One row per (user, month).
// LLM proxy increments after every successful Anthropic call so we
// can enforce quotas, surface usage in the UI, and bill later.
export const usage = sqliteTable(
  'usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    month: text('month').notNull(), // YYYY-MM
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    callCount: integer('call_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(strftime('%s', 'now') * 1000)`),
  },
  (t) => ({
    userMonthIdx: index('usage_user_month_idx').on(t.userId, t.month),
  }),
);

// Magic-link sign-in tokens. One-time-use, 15-minute TTL. Created
// when a user requests sign-in by email; deleted (or marked used)
// when the link is clicked. The session row is what persists for
// 30 days after successful verification.
export const magicTokens = sqliteTable('magic_tokens', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  // v359.60.82: capture user's display name at sign-in request time
  // so /verify can populate users.displayName when creating the
  // account on first sign-in. Optional — older rows / direct-API
  // callers may not provide it.
  name: text('name'),
  // v359.60.87: marketing consent at sign-in time, propagated to
  // users.marketingOptIn at /verify.
  marketingOptIn: integer('marketing_opt_in', { mode: 'boolean' }).default(false),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s', 'now') * 1000)`),
});

// v353.5: trip share tokens. One row per (trip, share-link).
// Shareable read-only URL = https://app/?share=<token>. Recipient
// fetches the trip via GET /trips/share/:token (no auth — the
// token IS the auth). Owner can revoke any time → revokedAt set,
// downstream reads check revokedAt IS NULL. Multiple active tokens
// per trip allowed (rotate by minting a new one without revoking
// the old).
export const shareTokens = sqliteTable(
  'share_tokens',
  {
    token: text('token').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(strftime('%s', 'now') * 1000)`),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    tripIdx: index('share_tokens_trip_id_idx').on(t.tripId),
  }),
);

// v356.6: reminders sent per (user, trip, days_before) so the daily
// cron's "send if departing in 7/3/1" check is idempotent. Without
// this row the cron would re-send every day inside each window.
// Composite PK = (user_id, trip_id, days_before); insert fails on
// duplicate, which is the cheap "already sent" guard.
export const remindersSent = sqliteTable(
  'reminders_sent',
  {
    userId: text('user_id').notNull(),
    tripId: text('trip_id').notNull(),
    daysBefore: integer('days_before').notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(strftime('%s', 'now') * 1000)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tripId, t.daysBefore] }),
  }),
);

// v359.60.81: per-email access grants for sign-in approval workflow.
// Anyone trying to sign in either already has status='approved' here
// (proceeds normally) OR creates/updates a row with status='pending'
// + admin notification email. Admin clicks the approve link with a
// one-time approveToken, status flips to 'approved', user gets a
// magic-link email. Admin can revoke later via the protected
// /admin/revoke endpoint (uses ADMIN_TOKEN env var). The ALLOWED_EMAILS
// env-var allowlist still works as a bootstrap: emails on that list
// are auto-approved without going through the request flow.
export const accessGrants = sqliteTable('access_grants', {
  email: text('email').primaryKey(),
  status: text('status').notNull(), // 'pending' | 'approved' | 'denied' | 'revoked'
  // v359.60.82: name from the original sign-in request, used to
  // populate users.displayName when the request gets approved and
  // the user creates their account.
  name: text('name'),
  // v359.60.87: marketing opt-in captured at sign-up time. Flows
  // through to users.marketingOptIn at /verify.
  marketingOptIn: integer('marketing_opt_in', { mode: 'boolean' }).default(false),
  approveToken: text('approve_token'),  // one-time, cleared on use
  denyToken: text('deny_token'),        // one-time, cleared on use
  requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull(),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  notes: text('notes'),
});

// v360.0.0 — Phase 2 (email auto-import). One forwarding address per
// user. The address is `{inboxToken}@inbox.travelingwithmax.app` —
// inboxToken is a random non-guessable string minted once per user.
// Cloudflare Email Routing pipes any mail at *@inbox.travelingwithmax.app
// to the Email Worker, which validates the recipient against this
// table before persisting the raw email. One-row-per-user model: a
// user always has at most one inbox, mostly because the value of
// multiple inboxes per user is unclear and the security tradeoff
// (more attack surface) isn't worth it.
export const userInboxes = sqliteTable('user_inboxes', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  inboxToken: text('inbox_token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s', 'now') * 1000)`),
  // Updated whenever the Email Worker receives a message for this
  // inbox — drives the "Last forwarded email: 2 hours ago" indicator
  // on the Profile page so the user knows forwarding is live.
  lastReceivedAt: integer('last_received_at', { mode: 'timestamp_ms' }),
});

// v360.0.0 — Phase 2. Durable inbox for raw forwarded emails. The
// Email Worker writes here on receipt; the parser reads here, calls
// the LLM, and either creates a booking (status='parsed') or marks
// the row failed (status='failed'). Persisting raw before parsing
// means a parser bug never loses an email — the row sits in
// status='received' and we can re-process it. Also useful for the
// Unassigned bookings tray (parsed but unmatched to any trip).
export const pendingEmails = sqliteTable(
  'pending_emails',
  {
    id: text('id').primaryKey(),
    // Full original to: address; helpful for forensics + future
    // multi-inbox-per-user (if we ever go there).
    toAddress: text('to_address').notNull(),
    // Extracted token (the local part of the to: address). FK
    // implied — must match a user_inboxes.inbox_token row.
    inboxToken: text('inbox_token').notNull(),
    fromAddress: text('from_address'),
    subject: text('subject'),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    // Raw size in bytes — useful for monitoring + spam heuristics.
    sizeBytes: integer('size_bytes'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(strftime('%s', 'now') * 1000)`),
    // Workflow state:
    //   'received'  — Email Worker wrote it, parser hasn't seen it
    //   'parsing'   — parser claimed it (set just before LLM call)
    //   'parsed'    — booking created, attached to a trip OR routed
    //                 to the Unassigned tray
    //   'failed'    — parser threw; see `error` for the reason
    //   'duplicate' — recognized as a re-forward of an already-
    //                 parsed email (matched by hash)
    parseStatus: text('parse_status').notNull().default('received'),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    // JSON of the normalized booking the parser produced. Kept even
    // after the booking is created so we can replay if the trip-
    // attach logic changes.
    parsedJson: text('parsed_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    // Where the booking landed. Empty if status != 'parsed' or if
    // routed to Unassigned tray (no booking yet).
    bookingId: text('booking_id'),
    tripId: text('trip_id'),
    error: text('error'),
  },
  (t) => ({
    inboxTokenIdx: index('pending_emails_inbox_token_idx').on(t.inboxToken),
    statusIdx: index('pending_emails_status_idx').on(t.parseStatus),
  }),
);

export type User = typeof users.$inferSelect;
export type AccessGrant = typeof accessGrants.$inferSelect;
export type NewAccessGrant = typeof accessGrants.$inferInsert;
export type UserInbox = typeof userInboxes.$inferSelect;
export type NewUserInbox = typeof userInboxes.$inferInsert;
export type PendingEmail = typeof pendingEmails.$inferSelect;
export type NewPendingEmail = typeof pendingEmails.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
export type Usage = typeof usage.$inferSelect;
export type MagicToken = typeof magicTokens.$inferSelect;
export type UserPrefs = typeof userPrefs.$inferSelect;
export type NewUserPrefs = typeof userPrefs.$inferInsert;
export type ShareToken = typeof shareTokens.$inferSelect;
export type NewShareToken = typeof shareTokens.$inferInsert;
export type ReminderSent = typeof remindersSent.$inferSelect;
export type NewReminderSent = typeof remindersSent.$inferInsert;
