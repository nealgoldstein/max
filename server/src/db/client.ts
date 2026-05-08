// Drizzle + libsql client.
//
// Two runtimes use this file:
//   - Local dev (Node + tsx): file: URL → on-disk SQLite at ./max.db
//   - Production (Cloudflare Workers): libsql:// URL → remote Turso DB
//
// Workers don't have process.env at module-load time — env bindings
// arrive per request. So we lazy-init: the Workers entry point calls
// initDb(env) inside its fetch handler, and the routes call getDb()
// to grab the cached instance.
//
// For Node, initDb is a no-op (db is initialized at import via
// process.env). Routes that call getDb() get the same instance.

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client/web';
import * as schema from './schema.js';

type Env = {
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  DATABASE_URL?: string;
};

let _db: ReturnType<typeof drizzle> | null = null;

export function initDb(env: Env): ReturnType<typeof drizzle> {
  if (_db) return _db;
  const url = env.TURSO_URL || env.DATABASE_URL || 'file:./max.db';
  const normalized = url.startsWith('file:') || url.startsWith('libsql:') || url.startsWith('http')
    ? url
    : `file:${url}`;
  const client = createClient({
    url: normalized,
    authToken: env.TURSO_AUTH_TOKEN,
  });
  _db = drizzle(client, { schema });
  return _db;
}

export function getDb(): ReturnType<typeof drizzle> {
  if (!_db) {
    throw new Error(
      'DB not initialized. Workers: call initDb(env) in your fetch handler. Node: ensure process.env.TURSO_URL or DATABASE_URL is set before importing routes.',
    );
  }
  return _db;
}

// Node entry point eagerly initializes from process.env so the
// existing `import { db } from '../db/client.js'` pattern keeps
// working in routes (we re-export `db` as a getter below).
if (typeof process !== 'undefined' && process.env) {
  try {
    initDb({
      TURSO_URL: process.env.TURSO_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
      DATABASE_URL: process.env.DATABASE_URL,
    });
  } catch (e) {
    // OK — Workers will init later via initDb(c.env)
  }
}

// Convenience accessor — routes use `db.select()` etc. The getter
// resolves to the same singleton initDb populates.
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop: string) {
    return (getDb() as never as Record<string, unknown>)[prop];
  },
});

export { schema };
