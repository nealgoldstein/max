// Hono app construction. Shared between the Node entry (src/index.ts)
// and the Cloudflare Workers entry (src/worker.ts) — both wire the
// same routes, middleware, and error handlers.

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { authApi } from './routes/auth.js';
import { tripsApi } from './routes/trips.js';
import { llmApi } from './routes/llm.js';
import { prefsApi } from './routes/prefs.js';

export function createApp() {
  const app = new Hono();

  app.use('*', logger());

  // Open CORS for dev. Lock down to specific origins (the deployed
  // desktop + mobile origins) when we ship.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.get('/health', (c) =>
    c.json({ ok: true, version: '0.2.0', time: new Date().toISOString() }),
  );

  app.route('/auth', authApi);
  app.route('/trips', tripsApi);
  app.route('/llm', llmApi);
  app.route('/user/prefs', prefsApi);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    console.error('[max] unhandled error:', err);
    return c.json({ error: 'Internal error', detail: err.message }, 500);
  });

  return app;
}
