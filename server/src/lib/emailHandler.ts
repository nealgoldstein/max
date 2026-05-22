// Email Worker handler — receives forwarded booking confirmations
// from Cloudflare Email Routing, parses the MIME body, validates the
// recipient against user_inboxes, and writes to pending_emails for
// the parser job to pick up.
//
// Architecture: this lives in the SAME worker bundle as the HTTP
// API. Cloudflare invokes our worker's exported `email` handler for
// each forwarded message. Keeping it in the same worker (vs. a
// separate one) means one deploy, one config, shared DB connection.
//
// Flow:
//   1. Cloudflare Email Routing rule for bookings@travelingwithmax.app
//      points at this Worker (after Chunk 3 deploy).
//   2. Mail arrives → Cloudflare calls our email(message, env, ctx).
//   3. We parse the To: address. Plus-tag (the part after "+") IS
//      the user's inbox_token. e.g. "bookings+n7k2pq@..." → token
//      "n7k2pq". For test/dev when no +tag is present, treat the
//      base address as the inbox itself (no user mapping → reject).
//   4. Look up user_inboxes WHERE inbox_token = ?. If no match,
//      reject the email (someone's spoofing or pre-onboarding).
//   5. Parse the MIME body (text + HTML, subject, from).
//   6. Insert a row in pending_emails with parse_status='received'.
//   7. Update user_inboxes.last_received_at so the Profile page
//      "last forwarded email" indicator stays live.
//
// We do NOT parse booking content here — that's Chunk 4's parser
// job. Decoupling means a parser bug never loses an incoming email;
// the row sits in pending_emails ready for re-processing.

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { initDb } from '../db/client.js';
import * as schema from '../db/schema.js';
import PostalMime from 'postal-mime';

// Cloudflare's ForwardableEmailMessage shape (typed loose since we
// don't depend on @cloudflare/workers-types at build time).
interface ForwardableEmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
  setReject(reason: string): void;
  forward?(rcptTo: string, headers?: Headers): Promise<void>;
  reply?(message: unknown): Promise<void>;
}

type Env = {
  TURSO_URL: string;
  TURSO_AUTH_TOKEN: string;
};

// Pull the inbox token from the To: address.
//
// Accepts plus-addressing only: `bookings+TOKEN@travelingwithmax.app`.
// A bare `bookings@...` (no token) returns null — these are test
// emails (or someone fishing) and we reject them rather than guess
// which user they belong to.
//
// Local-part can contain hyphens, dots, alphanumerics; the token is
// whatever follows the FIRST `+` and ends at the `@`. So
// `bookings+n7k2pq@...` → "n7k2pq".
export function _extractInboxToken(toAddress: string): string | null {
  if (!toAddress) return null;
  const m = toAddress.toLowerCase().match(/\+([a-z0-9]+)@/i);
  return m ? m[1] : null;
}

// Read the raw email stream into a Buffer for postal-mime.
async function _streamToArrayBuffer(stream: ReadableStream, size: number): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    // Safety cap — 5 MB. Booking confirmations should be well under
    // 100 KB; anything bigger is suspicious (or a marketing email
    // with embedded images we don't care about).
    if (total > 5 * 1024 * 1024) {
      throw new Error('email exceeds 5MB cap');
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return buf.buffer;
}

// Main email handler. Cloudflare calls this for every forwarded
// message routed to our Worker.
export async function handleIncomingEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const startedAt = Date.now();
  console.log(
    '[email]',
    'incoming from=' + message.from,
    'to=' + message.to,
    'size=' + message.rawSize,
  );

  // 1. Identify the user.
  const token = _extractInboxToken(message.to);
  if (!token) {
    console.warn('[email] no inbox token in to: ' + message.to + ' — rejecting');
    message.setReject('No user inbox token in recipient address.');
    return;
  }

  // 2. Validate the token.
  const db = initDb({
    TURSO_URL: env.TURSO_URL,
    TURSO_AUTH_TOKEN: env.TURSO_AUTH_TOKEN,
  });
  const inboxRow = await db
    .select()
    .from(schema.userInboxes)
    .where(eq(schema.userInboxes.inboxToken, token))
    .get();
  if (!inboxRow) {
    console.warn('[email] unknown token=' + token + ' — rejecting');
    message.setReject('Unknown inbox token.');
    return;
  }

  // 3. Parse MIME → text + html + subject.
  let parsed: { text?: string; html?: string; subject?: string; from?: { address?: string } };
  try {
    const buf = await _streamToArrayBuffer(message.raw, message.rawSize);
    parsed = await PostalMime.parse(buf);
  } catch (e) {
    console.error('[email] MIME parse failed:', e);
    // Persist anyway — we have the headers, we can fall back to
    // letting the parser job try to make sense of whatever the LLM
    // can pull out of raw text.
    parsed = {
      text: undefined,
      html: undefined,
      subject: message.headers.get('subject') || undefined,
      from: { address: message.from },
    };
  }

  // 4. Write to pending_emails.
  const id = 'pe-' + randomUUID();
  await db
    .insert(schema.pendingEmails)
    .values({
      id,
      toAddress: message.to,
      inboxToken: token,
      fromAddress: parsed.from?.address || message.from || null,
      subject: parsed.subject || null,
      bodyText: parsed.text || null,
      bodyHtml: parsed.html || null,
      sizeBytes: message.rawSize,
      parseStatus: 'received',
    })
    .run();

  // 5. Update last-received indicator.
  await db
    .update(schema.userInboxes)
    .set({ lastReceivedAt: new Date() })
    .where(eq(schema.userInboxes.inboxToken, token))
    .run();

  console.log(
    '[email]',
    'persisted id=' + id,
    'user=' + inboxRow.userId,
    'subj=' + (parsed.subject || '(none)').slice(0, 60),
    'dur=' + (Date.now() - startedAt) + 'ms',
  );
}
