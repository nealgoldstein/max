// v356.5: Resend-backed reminder email sender.
//
// Called from runDailyReminderJob (worker scheduled handler) once per
// (trip, days-window) that hasn't already been sent. The HTML is
// inline-styled and table-free — modern email clients tolerate divs +
// inline color/padding fine, and this keeps the renderer trivial.
//
// If RESEND_API_KEY is not set in the env, we log + return
// { skipped: true } so dev / pre-Resend deploys don't throw. The
// caller treats skipped sends as "don't write reminders_sent" — that
// way the moment Neal sets the secret, the next cron run picks up
// where we left off.

type Env = {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  PUBLIC_APP_URL?: string;
};

type ReminderItem = {
  kind: string;
  summary: string;
  severity: 'high' | 'medium' | 'low';
};

type SendArgs = {
  to: string;
  tripId?: string;
  tripName: string;
  daysUntilDeparture: number;
  items: ReminderItem[];
};

type SendResult = { sent?: boolean; skipped?: boolean };

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEmailHtml(args: {
  tripName: string;
  daysUntilDeparture: number;
  items: ReminderItem[];
  appUrl?: string;
  tripId?: string;
}): string {
  const { tripName, daysUntilDeparture, items, appUrl, tripId } = args;
  const groupOrder: Array<ReminderItem['severity']> = ['high', 'medium', 'low'];
  const groupLabel: Record<string, string> = {
    high: 'High priority',
    medium: 'Worth doing',
    low: 'When you have a minute',
  };
  const groupColor: Record<string, string> = {
    high: '#b05820',
    medium: '#1a5fa8',
    low: '#888',
  };
  const groupedHtml = groupOrder
    .map((sev) => {
      const ofSev = items.filter((i) => i.severity === sev);
      if (!ofSev.length) return '';
      const rows = ofSev
        .map(
          (i) =>
            `<li style="padding:6px 0;color:#222;line-height:1.45;">${escapeHtml(i.summary)}</li>`,
        )
        .join('');
      return `
        <div style="margin-top:18px;">
          <div style="font-size:11px;font-weight:700;color:${groupColor[sev]};text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">${groupLabel[sev]}</div>
          <ul style="margin:0;padding-left:20px;font-size:14px;">${rows}</ul>
        </div>
      `;
    })
    .join('');

  const countdown =
    daysUntilDeparture === 0
      ? 'Departing today'
      : daysUntilDeparture === 1
        ? 'Departing tomorrow'
        : `${daysUntilDeparture} days to go`;

  const tripLink = appUrl
    ? `${appUrl}${tripId ? `?trip=${encodeURIComponent(tripId)}` : ''}`
    : 'https://travelingwithmax.app';

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#faf8f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e2d8;border-radius:10px;padding:24px 28px;">
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Max trip reminder</div>
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.25;margin-bottom:4px;">${escapeHtml(tripName)}</div>
    <div style="font-size:14px;color:#b05820;font-weight:600;margin-bottom:12px;">${countdown} · ${items.length} thing${items.length === 1 ? '' : 's'} still to do</div>
    <div style="font-size:13px;color:#555;line-height:1.5;">A quick checklist before you leave:</div>
    ${groupedHtml}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:13px;color:#555;">
      <a href="${escapeHtml(tripLink)}" style="color:#1a5fa8;text-decoration:none;font-weight:600;">Open the trip in Max →</a>
    </div>
    <div style="margin-top:20px;font-size:11px;color:#aaa;line-height:1.5;">
      You're getting this because you have an upcoming trip in Max.
    </div>
  </div>
</body></html>`;
}

export async function sendReminderEmail(env: Env, args: SendArgs): Promise<SendResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      '[reminders] RESEND_API_KEY not set — skipping send. Items would have been:',
      args.items.length,
    );
    return { skipped: true };
  }

  const subject = `${args.tripName} — ${args.daysUntilDeparture} day${args.daysUntilDeparture !== 1 ? 's' : ''} to go, ${args.items.length} thing${args.items.length !== 1 ? 's' : ''} still to do`;

  const html = renderEmailHtml({
    tripName: args.tripName,
    daysUntilDeparture: args.daysUntilDeparture,
    items: args.items,
    appUrl: env.PUBLIC_APP_URL,
    tripId: args.tripId,
  });

  const from = env.RESEND_FROM || 'Max <reminders@travelingwithmax.app>';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: args.to, subject, html }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Resend ${resp.status}: ${detail}`);
  }
  return { sent: true };
}
