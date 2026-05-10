// iCalendar (RFC 5545) generator. Mirrors the client-side ICS
// generator in index.html — keep changes in sync. Used by the
// share/:token/calendar.ics endpoint so calendar apps can subscribe
// to a trip and pick up edits automatically.
//
// Stable UIDs: derived from the trip ID + dest/tracker ID. Same
// event across re-fetches gets the same UID, so calendar apps
// update in-place rather than duplicating.

type TripBody = {
  trip?: {
    id?: string;
    name?: string;
    destinations?: Array<{
      id?: string;
      place?: string;
      label?: string;
      dateFrom?: string;
      dateTo?: string;
      lodging?: string;
      lodgingNotes?: string;
      tracker?: Array<{
        id?: string;
        kind?: string;
        summary?: string;
        label?: string;
        date?: string;
        time?: string;
        location?: string;
        notes?: string;
        durationHours?: number;
      }>;
    }>;
  };
} | Record<string, unknown>;

function icsEsc(s: string | undefined | null): string {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function fmtDate(iso: string): string {
  return (iso || '').replace(/-/g, '');
}

function fmtDateTime(iso: string, time: string): string {
  const d = (iso || '').replace(/-/g, '');
  const t = (time || '00:00').replace(':', '') + '00';
  return d + 'T' + t;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

type TripShape = {
  name?: string;
  destinations?: Array<{
    id?: string; place?: string; label?: string; dateFrom?: string; dateTo?: string;
    lodging?: string; lodgingNotes?: string;
    tracker?: Array<{ id?: string; kind?: string; summary?: string; label?: string; date?: string; time?: string; location?: string; notes?: string; durationHours?: number; }>;
  }>;
};

export function generateIcs(body: TripBody, tripId: string): string {
  // body may be a flat trip OR an envelope { trip: {...}, ... }
  const envelope = body as { trip?: TripShape } & TripShape;
  const t: TripShape = (envelope.trip && envelope.trip.destinations)
    ? envelope.trip
    : envelope;
  const dests = t.destinations || [];
  const name = t.name || 'Trip';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Max//travelingwithmax.app//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEsc(name),
    // Refresh hint for clients that honor it (Apple Calendar etc.).
    'X-PUBLISHED-TTL:PT6H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
  ];

  function uidFor(kind: string, id: string): string {
    return 'max-' + kind + '-' + tripId + '-' + id + '@travelingwithmax.app';
  }

  function pushDateOnly(
    uid: string,
    summary: string,
    location: string,
    dateFrom: string,
    dateTo: string,
    description: string,
  ) {
    if (!dateFrom) return;
    const endIso = dateTo || dateFrom;
    const endD = new Date(endIso + 'T12:00:00');
    endD.setUTCDate(endD.getUTCDate() + 1);
    const endStr = endD.toISOString().slice(0, 10).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + nowStamp(),
      'DTSTART;VALUE=DATE:' + fmtDate(dateFrom),
      'DTEND;VALUE=DATE:' + endStr,
      'SUMMARY:' + icsEsc(summary),
    );
    if (location) lines.push('LOCATION:' + icsEsc(location));
    if (description) lines.push('DESCRIPTION:' + icsEsc(description));
    // SEQUENCE bumped per generation so updates supersede.
    lines.push('SEQUENCE:' + Math.floor(Date.now() / 1000));
    lines.push('END:VEVENT');
  }

  function pushDateTime(
    uid: string,
    summary: string,
    location: string,
    dateIso: string,
    time: string,
    durationHours: number,
    description: string,
  ) {
    if (!dateIso) return;
    const dur = isFinite(durationHours) && durationHours > 0 ? durationHours : 1;
    const startStr = fmtDateTime(dateIso, time || '09:00');
    const startD = new Date(dateIso + 'T' + (time || '09:00') + ':00');
    const endD = new Date(startD.getTime() + dur * 3600 * 1000);
    const endStr = endD
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
      .replace(/Z$/, '');
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + nowStamp(),
      'DTSTART:' + startStr,
      'DTEND:' + endStr,
      'SUMMARY:' + icsEsc(summary),
    );
    if (location) lines.push('LOCATION:' + icsEsc(location));
    if (description) lines.push('DESCRIPTION:' + icsEsc(description));
    lines.push('SEQUENCE:' + Math.floor(Date.now() / 1000));
    lines.push('END:VEVENT');
  }

  for (const d of dests as Array<{
    id?: string; place?: string; label?: string; dateFrom?: string; dateTo?: string;
    lodging?: string; lodgingNotes?: string;
    tracker?: Array<{ id?: string; kind?: string; summary?: string; label?: string; date?: string; time?: string; location?: string; notes?: string; durationHours?: number; }>;
  }>) {
    if (!d.dateFrom) continue;
    const summary = d.label && d.label !== d.place
      ? d.label + ' — ' + d.place
      : (d.place || d.label || 'Destination');
    const loc = d.place || '';
    let desc = '';
    if (d.lodging || d.lodgingNotes) desc += 'Lodging: ' + (d.lodging || d.lodgingNotes) + '\\n';
    pushDateOnly(uidFor('dest', d.id || (d.place || 'x')), '📍 ' + summary, loc, d.dateFrom, d.dateTo || '', desc);
  }

  for (const d of dests as Array<{ id?: string; place?: string; tracker?: Array<{ id?: string; kind?: string; summary?: string; label?: string; date?: string; time?: string; location?: string; notes?: string; durationHours?: number; }>; }>) {
    for (const t of d.tracker || []) {
      if (!t || !t.date) continue;
      const summary = t.summary || t.label || t.kind || 'Booking';
      const loc = t.location || d.place || '';
      const dur = t.durationHours || (t.kind === 'flight' ? 3 : 1);
      pushDateTime(
        uidFor('tracker', t.id || (d.id + '-' + summary)),
        '✈ ' + summary,
        loc,
        t.date,
        t.time || '',
        dur,
        t.notes || '',
      );
    }
  }

  lines.push('END:VCALENDAR');
  // Per RFC 5545 lines should be folded at 75 octets, but every
  // calendar app I've tested tolerates long lines. Skip for now.
  return lines.join('\r\n');
}
