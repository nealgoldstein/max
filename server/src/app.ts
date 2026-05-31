// Hono app construction. Shared between the Node entry (src/index.ts)
// and the Cloudflare Workers entry (src/worker.ts) — both wire the
// same routes, middleware, and error handlers.

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { authApi, adminApi } from './routes/auth.js';
import { tripsApi } from './routes/trips.js';
import { llmApi } from './routes/llm.js';
import { prefsApi } from './routes/prefs.js';
import { shareApi } from './routes/share.js';
import { inboxApi } from './routes/inbox.js';
import { attachmentsApi } from './routes/attachments.js';
import { urlMetadataApi } from './routes/urlMetadata.js';

export function createApp() {
  const app = new Hono();

  app.use('*', logger());

  // Open CORS for dev. Lock down to specific origins (the deployed
  // desktop + mobile origins) when we ship.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.get('/health', (c) =>
    c.json({ ok: true, version: '0.2.0', time: new Date().toISOString() }),
  );

  app.route('/auth', authApi);
  app.route('/admin', adminApi);
  app.route('/trips', tripsApi);
  app.route('/llm', llmApi);
  app.route('/user/prefs', prefsApi);
  // v360.0.0: email auto-import API. The inboxApi router carries
  // both /inbox and /unassigned-bookings routes — mount at /user
  // so paths become /user/inbox, /user/inbox/rotate,
  // /user/unassigned-bookings, /user/unassigned-bookings/:id/attach,
  // and /user/unassigned-bookings/:id/dismiss.
  app.route('/user', inboxApi);
  app.route('/share', shareApi);
  // PD.61: cross-device blob storage for Discovery doc attachments.
  app.route('/attachments', attachmentsApi);
  // PD.63: URL metadata fetch (CORS-free) for smart link paste.
  app.route('/url-metadata', urlMetadataApi);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    console.error('[max] unhandled error:', err);
    return c.json({ error: 'Internal error', detail: err.message }, 500);
  });

  return app;
}
