// Cloudflare Workers entry point. Deployed via `wrangler deploy`.
//
// Workers don't have process.env at module load — secrets arrive
// via the env binding on each request. So we initDb(env) inside the
// fetch handler before routing the request to the Hono app. After
// the first request, the singleton is cached for the worker's
// lifetime (per Cloudflare isolate).

import { createApp } from './app.js';
import { initDb } from './db/client.js';

type Env = {
  TURSO_URL: string;
  TURSO_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY?: string;
  DEV_TOKEN?: string;
};

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
};
