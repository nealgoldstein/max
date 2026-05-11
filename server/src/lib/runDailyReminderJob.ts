// v356.4: daily reminder cron entrypoint.
//
// Walks every user with an email; for each of their trips, reads the
// envelope body, runs computePendingActions, and if the trip is
// departing in 7/3/1 days AND has unfinished items AND we haven't
// already sent for that (trip, days_before) pair, sends a Resend
// email and writes a reminders_sent row. The composite PK on
// reminders_sent makes "have we already sent" a cheap ON CONFLICT
// check, but we read explicitly so the missing-secret skip path
// doesn't write a "sent" record it didn't actually send.
//
// Schedules: hooked from worker.ts's scheduled() handler. Cron is
// once a day at 14:00 UTC (~7am Pacific, ~10am Eastern) so US users
// see the reminder over morning coffee.
//
// Failure model: per-trip errors are caught and logged so one bad
// trip body doesn't kill the run. The function returns a small
// summary { usersChecked, tripsChecked, sent, skipped, errors } that
// the caller can log for observability.

import { eq, and } from 'drizzle-orm';
import { initDb, getDb, schema } from '../db/client.js';
import { computePendingActions } from './pendingActions.js';
import { sendReminderEmail } from './sendReminderEmail.js';

type Env = {
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  PUBLIC_APP_URL?: string;
};

const REMINDER_WINDOWS = [7, 3, 1] as const;

export type ReminderJobSummary = {
  usersChecked: number;
  tripsChecked: number;
  sent: number;
  skipped: number;
  errors: number;
};

export async function runDailyReminderJob(env: Env): Promise<ReminderJobSummary> {
  // Workers' scheduled() handler doesn't init the DB by default —
  // unlike fetch(). Init here so getDb() returns a live client.
  initDb({
    TURSO_URL: env.TURSO_URL,
    TURSO_AUTH_TOKEN: env.TURSO_AUTH_TOKEN,
  });
  const db = getDb();
  const summary: ReminderJobSummary = {
    usersChecked: 0,
    tripsChecked: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  };

  const allUsers = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .all();

  const now = new Date();

  for (const user of allUsers) {
    if (!user.email) continue;
    summary.usersChecked++;

    const userTrips = await db
      .select({
        id: schema.trips.id,
        name: schema.trips.name,
        body: schema.trips.body,
      })
      .from(schema.trips)
      .where(eq(schema.trips.userId, user.id))
      .all();

    for (const tripRow of userTrips) {
      summary.tripsChecked++;
      try {
        // The body column stores the serialized client envelope. The
        // shape varies historically (some old trips are bare
        // destinations[], newer ones are { trip: { destinations: ... } }).
        // Mirror _readTripById in index.html's defensive unwrap.
        const env_ = tripRow.body as Record<string, unknown> | null;
        const tripObj =
          env_ && typeof env_ === 'object' && 'trip' in env_ && env_.trip
            ? (env_.trip as Record<string, unknown>)
            : (env_ as Record<string, unknown> | null);

        const pa = computePendingActions(tripObj as never, now);
        if (pa.daysUntilDeparture === null) continue;
        if (!REMINDER_WINDOWS.includes(pa.daysUntilDeparture as 7 | 3 | 1)) continue;
        if (pa.items.length === 0) continue;

        const daysBefore = pa.daysUntilDeparture;

        // Already sent for this (user, trip, days)? cheap dedupe.
        const existing = await db
          .select({ tripId: schema.remindersSent.tripId })
          .from(schema.remindersSent)
          .where(
            and(
              eq(schema.remindersSent.userId, user.id),
              eq(schema.remindersSent.tripId, tripRow.id),
              eq(schema.remindersSent.daysBefore, daysBefore),
            ),
          )
          .get();
        if (existing) continue;

        const result = await sendReminderEmail(env, {
          to: user.email,
          tripId: tripRow.id,
          tripName: tripRow.name || 'Your trip',
          daysUntilDeparture: daysBefore,
          items: pa.items,
        });

        if (result.sent) {
          await db
            .insert(schema.remindersSent)
            .values({
              userId: user.id,
              tripId: tripRow.id,
              daysBefore,
            })
            .run();
          summary.sent++;
        } else {
          // Skipped because RESEND_API_KEY missing — DON'T write the
          // reminders_sent row, so the next run (after the secret is
          // set) actually emails the user.
          summary.skipped++;
        }
      } catch (err) {
        summary.errors++;
        console.error(
          '[reminders] error processing trip',
          tripRow.id,
          'for user',
          user.id,
          err,
        );
      }
    }
  }

  console.log('[reminders] job complete:', summary);
  return summary;
}
