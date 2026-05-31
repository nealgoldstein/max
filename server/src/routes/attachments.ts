// Attachments — cross-device image / file storage for Discovery doc
// bodies. (PD.61)
//
// Endpoints:
//   POST /attachments       — multipart upload, auth required.
//                             field "file" carries the blob.
//                             Returns { id }.
//   GET  /attachments/:id   — auth required. Streams the blob with
//                             the original Content-Type.
//
// Why this exists: PD.59 moved attachments out of doc bodies and into
// the browser's local IndexedDB. That fixed localStorage bloat but
// created a cross-device hole — pictures attached on laptop didn't
// follow to phone. This module is the server-side cache so blobs are
// addressable from any signed-in client.
//
// Storage choice: blob bytes are base64-encoded into the `data` text
// column. SQLite handles ~25MB rows comfortably, and base64 keeps the
// libsql client path runtime-agnostic (Node vs Cloudflare Workers).
//
// Auth model (v1): every read requires the same user's bearer token
// that wrote it. No sharing across users. Public share links (?disc=)
// continue to strip attachments — extending the share path to fetch
// blobs by an unauthenticated short-lived token is future work.

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { requireAuth, type AuthContext } from '../lib/auth.js';

const randomUUID = (): string => crypto.randomUUID();

const MAX_BYTES = 25 * 1024 * 1024; // matches client cap in _pmRtReadFileToNode

const attachmentsApi = new Hono<AuthContext>();
attachmentsApi.use('*', requireAuth);

// ── upload ──
//
// Hono's `parseBody()` handles multipart/form-data automatically.
// The client posts a single field "file" carrying the blob. We
// inspect File.name / File.type / File.size for metadata; the bytes
// come via .arrayBuffer().
attachmentsApi.post('/', async (c) => {
  const user = c.var.user;
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch (e) {
    return c.json({ error: 'malformed multipart' }, 400);
  }
  const file = body.file as File | undefined;
  if (!file || typeof file === 'string') {
    return c.json({ error: 'missing file field' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: 'file too large', maxBytes: MAX_BYTES }, 413);
  }
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    return c.json({ error: 'could not read file' }, 400);
  }
  // base64-encode the bytes. btoa requires latin1 string; we go via
  // chunked Uint8Array → String.fromCharCode to keep memory bounded
  // on 25MB inputs.
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  const b64 = btoa(bin);

  const id = randomUUID();
  await db.insert(schema.attachments).values({
    id,
    userId: user.id,
    name: file.name || 'attachment',
    mime: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    data: b64,
  });
  return c.json({ id, name: file.name || 'attachment', mime: file.type, sizeBytes: file.size });
});

// ── fetch ──
//
// Returns the blob with proper Content-Type and Content-Length.
// Long Cache-Control because the blob bytes are immutable — once
// uploaded, an id always returns the same bytes (or 404 after delete).
// Client-side, the hydration pass wraps these in a session-scoped
// URL.createObjectURL.
attachmentsApi.get('/:id', async (c) => {
  const user = c.var.user;
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing id' }, 400);
  const rows = await db
    .select()
    .from(schema.attachments)
    .where(and(eq(schema.attachments.id, id), eq(schema.attachments.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: 'not found' }, 404);
  // base64 → Uint8Array
  const bin = atob(row.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': row.mime || 'application/octet-stream',
      'Content-Length': String(row.sizeBytes),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

// ── delete ──
//
// Best-effort cleanup. Client-side GC will trigger this when an
// attachment's data-att-src-id is no longer referenced by any doc.
attachmentsApi.delete('/:id', async (c) => {
  const user = c.var.user;
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing id' }, 400);
  await db
    .delete(schema.attachments)
    .where(and(eq(schema.attachments.id, id), eq(schema.attachments.userId, user.id)));
  return c.json({ ok: true });
});

export { attachmentsApi };
