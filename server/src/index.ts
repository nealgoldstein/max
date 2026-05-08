// Node entry point — used for local dev via `npm run dev`.
//
// Production deploys (Cloudflare Workers) use src/worker.ts instead.
// Both share the Hono app construction in src/app.ts.

import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp();

const port = Number(process.env.PORT) || 3030;
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`[max] listening on http://localhost:${port}`);
});
