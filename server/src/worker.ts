// Cloudflare Workers entry point. Deployed via `wrangler deploy`.
//
// Workers don't have process.env at module load — secrets arrive
// via the env binding on each request. So we initDb(env) inside the
// fetch handler before routing the request to the Hono app. After
// the first request, the singleton is cached for the worker's
// lifetime (per Cloudflare isolate).

import { createApp } from './app.js';
import { initDb } from './db/client.js';
import { runDailyReminderJob } from './lib/runDailyReminderJob.js';
import { handleIncomingEmail } from './lib/emailHandler.js';
import { runEmailParserJob } from './lib/emailParser.js';

type Env = {
  TURSO_URL: string;
  TURSO_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY?: string;
  DEV_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  PUBLIC_APP_URL?: string;
  // v359.60.81: sign-in access control
  ALLOWED_EMAILS?: string;  // comma-separated bootstrap allowlist
  ADMIN_EMAIL?: string;     // where approval-request notifications get sent
  ADMIN_TOKEN?: string;     // shared secret for /admin/revoke + /admin/grants
};

// Cloudflare scheduled-event shape — `cron` is the schedule string
// from wrangler.toml that triggered this invocation. We branch on
// it to dispatch to the right job.
type ScheduledEvent = { cron: string; scheduledTime: number };

// ExecutionContext shape — `waitUntil` is the only piece we need.
// Typed loose so this file compiles without @cloudflare/workers-types.
type WorkerCtx = { waitUntil: (p: Promise<unknown>) => void };

const app = createApp();

export default {
  async fetch(
    request: Request,
    env: Env,
    // ExecutionContext is a Workers global — typed via @cloudflare/workers-types
    // when installed, but we keep it loose here so the file compiles in plain
    // Node TypeScript too. Wrangler bundles it correctly at deploy time.
    ctx: unknown,
  ): Promise<Response> {
    initDb({
      TURSO_URL: env.TURSO_URL,
      TURSO_AUTH_TOKEN: env.TURSO_AUTH_TOKEN,
    });
    return app.fetch(request, env, ctx as never);
  },

  // v356.4: scheduled cron handler. Cloudflare invokes this for
  // every cron schedule in wrangler.toml's [triggers] crons. We
  // branch on event.cron to dispatch to the right job:
  //   "0 14 * * *"  → daily reminders (Phase 1 — 7/3/1-day-out)
  //   "* * * * *"   → email parser (Phase 2 — pick up pending emails
  //                   and extract booking data via Claude)
  // Both wrap in ctx.waitUntil so the worker isn't terminated mid-job.
  async scheduled(event: unknown, env: Env, ctx: WorkerCtx): Promise<void> {
    const ev = event as ScheduledEvent;
    const cronExpr = ev?.cron || '';
    if (cronExpr === '0 14 * * *') {
      ctx.waitUntil(
        runDailyReminderJob(env).catch((e) => {
          console.error('[reminders] job failed:', e);
        }),
      );
      return;
    }
    if (cronExpr === '* * * * *') {
      ctx.waitUntil(
        runEmailParserJob(env)
          .then((r) => {
            if (r.parsed || r.failed) {
              console.log('[email-parser] tick: parsed=' + r.parsed + ' failed=' + r.failed + ' skipped=' + r.skipped);
            }
          })
          .catch((e) => {
            console.error('[email-parser] job failed:', e);
          }),
      );
      return;
    }
    // Unknown cron — log and skip. Should never happen unless
    // wrangler.toml and this handler drift.
    console.warn('[scheduled] unknown cron expression:', cronExpr);
  },

  // v360.0.0 — Phase 2: email auto-import. Cloudflare Email Routing
  // invokes this when a forwarded booking confirmation lands at any
  // address routed to our Worker (configured in the Cloudflare
  // dashboard under Email → Email Routing → Routing rules). The
  // handler validates the recipient, parses MIME, and persists to
  // the pending_emails table for the parser job to process.
  async email(message: unknown, env: Env, ctx: WorkerCtx): Promise<void> {
    // Loose-typed cast — see emailHandler.ts for the actual shape.
    const msg = message as Parameters<typeof handleIncomingEmail>[0];
    ctx.waitUntil(
      handleIncomingEmail(msg, env).catch((e) => {
        console.error('[email] handler failed:', e);
      }),
    );
  },
};
