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

type Env = {
  TURSO_URL: string;
  TURSO_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY?: string;
  DEV_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  PUBLIC_APP_URL?: string;
};

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

  // v356.4: daily cron — Cloudflare invokes this at the times listed
  // in wrangler.toml's [triggers] crons. Wrap in waitUntil so the
  // worker isn't terminated before the async DB walk finishes.
  async scheduled(event: unknown, env: Env, ctx: WorkerCtx): Promise<void> {
    ctx.waitUntil(
      runDailyReminderJob(env).catch((e) => {
        console.error('[reminders] job failed:', e);
      }),
    );
  },
};
