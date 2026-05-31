// Email parser job — picks up pending_emails rows with
// parse_status='received', ships the body to Claude with a booking-
// extraction prompt, normalizes the response, and writes the parsed
// JSON back to the row. Trip matching + booking attach happens in
// Chunk 5 (separate concern, cleaner separation).
//
// Triggered by Cloudflare cron (every minute or so — see wrangler.toml).
// Idempotent: re-running picks up only rows still in 'received'
// status; anything already 'parsing' / 'parsed' / 'failed' is left
// alone.
//
// Design notes:
//   - We claim a row by flipping parse_status='received' → 'parsing'
//     in a single UPDATE. Two parallel job invocations don't both
//     grab the same row because only one wins the UPDATE.
//   - LLM prompt is the same shape as the client-side single-paste
//     prompt (server/src/routes/llm.ts proxies the call). We trim
//     it here for the email context — booking emails are noisier
//     (sigs, terms, footers), so we tell the LLM to look past those.
//   - On parse failure (LLM throws, JSON malformed, etc.), set
//     parse_status='failed' with the error message. The row sticks
//     around for replay / debugging.

import { eq, and } from 'drizzle-orm';
import { initDb } from '../db/client.js';
import * as schema from '../db/schema.js';
import { attachBookingToTrip } from './bookingAttacher.js';

type Env = {
  TURSO_URL: string;
  TURSO_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY?: string;
};

// Same booking-extraction prompt as the client-side single-paste flow
// (index.html _parseBookingConfirmation), with email-specific
// guardrails added: ignore signature blocks, footers, unsubscribe
// links, and the outer envelope of forwarded messages.
const SYSTEM_PROMPT =
  "You extract booking details from a raw email body. " +
  "Return ONLY a single JSON object — no prose, no markdown fences. " +
  "Use EXACTLY the field names below.\n\n" +
  "Schema:\n" +
  "{\n" +
  '  "type": "flight" | "hotel" | "car" | "train" | "bus" | "ferry" | "restaurant" | "tour" | "ticket" | "unknown",\n' +
  '  "carrier": string | null,\n' +
  '  "number": string | null,\n' +
  '  "name": string | null,\n' +
  '  "address": string | null,\n' +
  '  "from": string | null,\n' +
  '  "to": string | null,\n' +
  '  "depDate": "YYYY-MM-DD" | null,\n' +
  '  "depTime": "HH:MM" | null,\n' +
  '  "arrDate": "YYYY-MM-DD" | null,\n' +
  '  "arrTime": "HH:MM" | null,\n' +
  '  "confirmationNumber": string | null,\n' +
  '  "price": number | null,\n' +
  '  "currency": string | null,\n' +
  '  "url": string | null,\n' +
  '  "cancelType": "deadline" | "non-cancellable" | null,\n' +
  '  "cancelDeadline": "YYYY-MM-DD" | null,\n' +
  '  "notes": string | null\n' +
  "}\n\n" +
  "Rules:\n" +
  "- 24-hour times. Convert AM/PM (3:00 PM → 15:00).\n" +
  "- 'address' = hotel/restaurant street address. 'from' / 'to' = transport endpoints OR car pickup / dropoff.\n" +
  "- When BOTH a country/region AND a specific airport/city are present, use the SPECIFIC name (not the country).\n" +
  "- Car-rental brands (Hertz, Sixt, Avis, Enterprise, Budget, Alamo, Lava, Europcar, etc.) → carrier; type='car'.\n" +
  "- Booking-number aliases ('Booking Number', 'Reservation Number', 'Reference Number', 'PNR') → confirmationNumber.\n" +
  "- Multiple price figures in one confirmation? Use the TOTAL or Total Price, NOT 'Amount Paid' (which can be 0) or 'Outstanding Balance'.\n" +
  "- Split currency from price: 'USD 612.50' → price=612.50, currency='USD'. Never put 'USD 612.50' as the price value.\n" +
  "- European-format thousands (e.g. '384.934 ISK' where the dot is a thousands separator): value = 384934.\n" +
  "- IGNORE: footer/signature blocks ('Thanks for choosing', social media links, 'Unsubscribe'), terms-and-conditions sections, forwarded-message headers ('---- Forwarded message ----').\n" +
  "- Booking confirmations forwarded from a user's inbox start with a 'Forwarded message' block — the actual booking content is below it. Extract from the booking content, not the forward envelope.\n" +
  "- Return type='unknown' ONLY if there's no booking-shaped content at all.\n\n" +
  "MULTI-LEG FLIGHTS: when a flight confirmation has more than one physical segment under a single PNR (round-trip with outbound+return, or layover JFK→LHR→KEF), ADDITIONALLY return a `legs` array with one entry per segment. Each leg has: {from, to, depDate, depTime, arrDate, arrTime, carrier, flightNumber}. The top-level flat fields (from, to, depDate, etc.) should hold the FIRST leg's values for backward compatibility, but `legs` is authoritative.\n\n" +
  "CRITICAL — DON'T STOP AT FLIGHT 1: many airline / travel-agent confirmations format multi-leg trips with explicit section headers ('Flight 1:', 'Flight 2:', 'Flight 3:', or 'Outbound:' / 'Return:' / 'Inbound:'). Scan the ENTIRE email body for every such header and produce one `legs` entry per header. Do not stop after the first one. Chase Travel, Expedia, Booking.com, airline confirmation emails routinely have 2-4 flight sections. Missing the rest is a frequent extraction failure — read all the way to the bottom of the booking content (above terms / disclaimers) and count flight sections deliberately.\n\n" +
  "Also: many travel agents list a 'Rules and policies' table near the bottom with one row per flight, format 'BUR to ZRH  Sat, Aug 15, 2026 - Sun, Aug 16, 2026'. Use this table as a cross-check that you found every flight section in the main body. If the table shows 3 rows and you only found 2 'Flight N:' headers, go back and find the missing one.\n\n" +
  "INTERMEDIATE STOPS ARE NOT SEPARATE LEGS: when a 'Flight N:' section mentions '1 Stop (SFO - 5h 19m)' or similar, that's a single airline-itinerary leg with an intermediate connection — keep it as ONE legs[] entry, not two. The two airline-listed flight numbers (e.g., 'UA 488' + 'UA 44') are sub-segments of the same leg; record the FIRST flight number on that leg and ignore the connection city for the legs[] shape.\n\n" +
  "Now extract the booking. Return JSON only.";

// Server-side normalizer — subset of the client-side one. Same alias
// table, but no DOM-specific things (date inputs, etc.). Pure data.
export function _normalizeBookingExtraction(p: Record<string, unknown>): Record<string, unknown> {
  if (!p || typeof p !== 'object') return p;
  const out: Record<string, unknown> = Object.assign({}, p);
  function pick(canonical: string, aliases: string[]): void {
    if (out[canonical] != null && out[canonical] !== '') return;
    for (const a of aliases) {
      const v = out[a];
      if (v != null && v !== '') {
        out[canonical] = v;
        return;
      }
    }
  }
  function isoDate(v: unknown): unknown {
    if (v == null || v === '') return v;
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    if (isNaN(t)) return v;
    const d = new Date(t);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  function isoTime(v: unknown): unknown {
    if (v == null || v === '') return v;
    const s = String(v).trim();
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?$/i);
    if (!m || !m[1] || !m[2]) return v;
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = (m[3] || '').toLowerCase().replace(/\./g, '');
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + min;
  }
  // Nested object flattening for travel_dates / pickup / dropoff
  const td = p.travel_dates as Record<string, unknown> | undefined;
  if (td && typeof td === 'object') {
    if (!out.depDate) out.depDate = td.start || td.startDate || td.start_date || td.pickup;
    if (!out.arrDate) out.arrDate = td.end || td.endDate || td.end_date || td.dropoff || td.return;
  }
  const pu = p.pickup as Record<string, unknown> | undefined;
  if (pu && typeof pu === 'object') {
    if (!out.from) out.from = pu.location || pu.airport || pu.city;
    if (!out.depDate) out.depDate = pu.date;
    if (!out.depTime) out.depTime = pu.time;
  }
  const dpo = (p.dropoff || p.return) as Record<string, unknown> | undefined;
  if (dpo && typeof dpo === 'object') {
    if (!out.to) out.to = dpo.location || dpo.airport || dpo.city;
    if (!out.arrDate) out.arrDate = dpo.date;
    if (!out.arrTime) out.arrTime = dpo.time;
  }
  // trip_type → type
  if (!out.type && (p.trip_type || p.bookingType || p.booking_type)) {
    out.type = p.trip_type || p.bookingType || p.booking_type;
  }
  if (out.type) {
    const typeStr = String(out.type).toLowerCase().replace(/[_-]/g, '');
    if (/^(rentalcar|car|carrental|selfdrive|carhire|vehiclerental|rental|hire)$/.test(typeStr)) {
      out.type = 'car';
    }
  }
  pick('name', ['accommodation', 'hotel', 'hotelName', 'property', 'propertyName', 'venue']);
  pick('carrier', ['airline', 'operator', 'company', 'provider', 'rentalCompany', 'rental_company', 'vendor']);
  pick('from', ['origin', 'departureCity', 'departureAirport', 'fromCity', 'pickupLocation', 'pickup_location']);
  pick('to', ['destinationCity', 'arrivalAirport', 'toCity', 'dropoffLocation', 'dropoff_location', 'returnLocation', 'return_location']);
  pick('depDate', ['checkIn', 'checkInDate', 'departureDate', 'startDate', 'date', 'pickupDate', 'pickup_date']);
  pick('depTime', ['checkInTime', 'departureTime', 'startTime', 'time', 'pickupTime', 'pickup_time']);
  pick('arrDate', ['checkOut', 'checkOutDate', 'arrivalDate', 'endDate', 'dropoffDate', 'dropoff_date', 'returnDate', 'return_date']);
  pick('arrTime', ['checkOutTime', 'arrivalTime', 'endTime', 'dropoffTime', 'dropoff_time', 'returnTime', 'return_time']);
  pick('confirmationNumber', ['confirmation', 'confirmationCode', 'confirmation_code', 'confirmation_number', 'bookingNumber', 'booking_number', 'bookingReference', 'booking_reference', 'reservationNumber', 'reservation_number', 'pnr']);
  pick('price', ['total', 'total_cost', 'total_amount', 'totalPrice', 'total_price', 'totalCost', 'amount', 'amountPaid', 'cost']);
  pick('currency', ['currencyCode', 'currencySymbol']);
  pick('url', ['bookingUrl', 'managementUrl', 'link', 'href']);

  // Apply iso normalizers
  out.depDate = isoDate(out.depDate);
  out.arrDate = isoDate(out.arrDate);
  out.depTime = isoTime(out.depTime);
  out.arrTime = isoTime(out.arrTime);

  // Price + currency split
  if (out.price != null && typeof out.price !== 'number') {
    const rawPrice = String(out.price).trim();
    const ccyMatch = rawPrice.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|ISK|CHF|CNY|SEK|NOK|DKK)\b/i);
    if (ccyMatch && ccyMatch[1] && !out.currency) out.currency = ccyMatch[1].toUpperCase();
    if (!out.currency) {
      if (/\$/.test(rawPrice)) out.currency = 'USD';
      else if (/€/.test(rawPrice)) out.currency = 'EUR';
      else if (/£/.test(rawPrice)) out.currency = 'GBP';
    }
    let num = rawPrice.replace(/[A-Z]{3}/gi, '').replace(/[\$€£¥]/g, '').trim();
    if (/^\d+\.\d{3}$/.test(num)) num = num.replace(/\./g, '');
    else num = num.replace(/,/g, '');
    const n = parseFloat(num);
    if (isFinite(n)) out.price = n;
    else out.price = null;
  }

  // URL parameter rescue (same logic as client)
  if (typeof out.url === 'string' && /[?&]/.test(out.url)) {
    try {
      const decoded = out.url.replace(/&amp;/g, '&');
      const u = new URL(decoded);
      const sp = u.searchParams;
      function get(names: string[]): string | null {
        for (const n of names) {
          const v = sp.get(n);
          if (v != null && v !== '') return v;
        }
        return null;
      }
      const conf = get(['confirmationNumber', 'confirmation', 'bookingNumber', 'reservationNumber', 'pnr']);
      if (conf) out.confirmationNumber = conf;
      const pdate = get(['pdate', 'pickupDate', 'pickup_date', 'fromDate', 'checkin']);
      const ddate = get(['ddate', 'dropoffDate', 'dropoff_date', 'returnDate', 'checkout']);
      function splitDT(iso: string | null): [string | null, string | null] {
        if (!iso) return [null, null];
        const s = decodeURIComponent(String(iso));
        const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]?(\d{2}:\d{2})?/);
        if (!m || !m[1]) return [null, null];
        return [m[1], m[2] || null];
      }
      const pp = splitDT(pdate);
      const dp = splitDT(ddate);
      if (pp[0]) out.depDate = pp[0];
      if (pp[1]) out.depTime = pp[1];
      if (dp[0]) out.arrDate = dp[0];
      if (dp[1]) out.arrTime = dp[1];
    } catch (_) {
      /* malformed URL — ignore */
    }
  }

  return out;
}

// Single LLM call. Server-side equivalent of the client's
// _parseBookingConfirmation. Uses the worker's stored API key.
async function _callClaude(env: Env, body: string): Promise<Record<string, unknown> | null> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'EMAIL BODY:\n\n' + body + '\n\nReturn the JSON.' }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('Anthropic ' + resp.status + ': ' + errText.slice(0, 200));
  }
  const data = (await resp.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text || '';
  let clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(clean);
  } catch (_) {
    throw new Error('LLM returned malformed JSON: ' + clean.slice(0, 200));
  }
}

// Main job entry point. Called from worker.ts's scheduled handler
// when the email-parser cron fires.
export async function runEmailParserJob(env: Env): Promise<{ parsed: number; failed: number; skipped: number }> {
  const db = initDb({
    TURSO_URL: env.TURSO_URL,
    TURSO_AUTH_TOKEN: env.TURSO_AUTH_TOKEN,
  });
  let parsed = 0;
  let failed = 0;
  let skipped = 0;

  // Pull up to 10 pending emails per run. Keeps the job time-boxed.
  const rows = await db
    .select()
    .from(schema.pendingEmails)
    .where(eq(schema.pendingEmails.parseStatus, 'received'))
    .limit(10)
    .all();

  console.log('[email-parser] picked up', rows.length, 'pending email(s)');

  for (const row of rows) {
    // Claim the row — flip 'received' → 'parsing' as a soft lock.
    // The WHERE clause ensures only one parallel job wins.
    const claimed = await db
      .update(schema.pendingEmails)
      .set({ parseStatus: 'parsing' })
      .where(
        and(
          eq(schema.pendingEmails.id, row.id),
          eq(schema.pendingEmails.parseStatus, 'received'),
        ),
      )
      .run();
    if (!claimed || (claimed as { rowsAffected?: number }).rowsAffected === 0) {
      skipped++;
      continue;
    }

    const bodySrc = row.bodyText || row.bodyHtml || '(empty body)';
    try {
      const raw = await _callClaude(env, bodySrc);
      if (!raw) throw new Error('LLM returned empty');
      const normalized = _normalizeBookingExtraction(raw);

      // Look up the user via inbox_token → user_inboxes → user_id,
      // then ask the attacher to find a trip and stash the booking.
      // If the attacher can't find a unique match (multiple trips,
      // no trips, no date), the booking sits in pending_emails for
      // the Unassigned tray to surface.
      const inboxRow = await db
        .select()
        .from(schema.userInboxes)
        .where(eq(schema.userInboxes.inboxToken, row.inboxToken))
        .get();
      let attachResult: { tripId: string | null; bookingId: string | null; reason: string } = {
        tripId: null,
        bookingId: null,
        reason: 'no-user',
      };
      if (inboxRow) {
        try {
          attachResult = await attachBookingToTrip(env, inboxRow.userId, normalized);
        } catch (attachErr) {
          console.error('[email-parser] attach failed for', row.id, attachErr);
        }
      }

      await db
        .update(schema.pendingEmails)
        .set({
          parseStatus: 'parsed',
          parsedJson: normalized,
          processedAt: new Date(),
          tripId: attachResult.tripId,
          bookingId: attachResult.bookingId,
        })
        .where(eq(schema.pendingEmails.id, row.id))
        .run();

      parsed++;
      console.log(
        '[email-parser] parsed',
        row.id,
        'type=' + (normalized.type || '?'),
        'carrier=' + (normalized.carrier || '?'),
        'confirmation=' + (normalized.confirmationNumber || '?'),
        'attach=' + attachResult.reason,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // v359.60.95: distinguish transient errors (Anthropic
      // overload / network blip / rate limit) from permanent ones
      // (malformed body, missing fields, parse rejection). Transient
      // → revert to 'received' so the next cron tick retries.
      // Permanent → mark 'failed' so we don't pound on a row that
      // will never parse. Heuristic: Anthropic 5xx (529, 503, 502),
      // 429 (rate limit), and network errors all retry; everything
      // else is permanent. Worst case we retry too aggressively on
      // a borderline error; the cron is 60s so it's bounded.
      const isTransient =
        /\b(529|503|502|504|429)\b/.test(msg) ||
        /overloaded|rate.?limit|timeout|temporarily/i.test(msg) ||
        /network|fetch failed|ECONN|ENOTFOUND/i.test(msg);
      console.error('[email-parser] failed', row.id, isTransient ? '(transient — will retry)' : '(permanent)', msg);
      if (isTransient) {
        await db
          .update(schema.pendingEmails)
          .set({
            // Revert to 'received' so the next tick picks it up.
            // Keep the error text so we can see the last failure
            // reason if we look at the row.
            parseStatus: 'received',
            error: msg.slice(0, 500),
          })
          .where(eq(schema.pendingEmails.id, row.id))
          .run();
      } else {
        await db
          .update(schema.pendingEmails)
          .set({
            parseStatus: 'failed',
            error: msg.slice(0, 500),
            processedAt: new Date(),
          })
          .where(eq(schema.pendingEmails.id, row.id))
          .run();
      }
      failed++;
    }
  }

  return { parsed, failed, skipped };
}
