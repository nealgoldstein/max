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

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
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
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(strftime('%s', 'now') * 1000)`),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
export type Usage = typeof usage.$inferSelect;
export type MagicToken = typeof magicTokens.$inferSelect;
export type UserPrefs = typeof userPrefs.$inferSelect;
export type NewUserPrefs = typeof userPrefs.$inferInsert;
