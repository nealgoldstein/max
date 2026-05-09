// Email sender — wraps Resend's HTTP API.
//
// We don't pull in a Resend SDK because their REST API is one POST
// and the SDK adds Node-specific deps that don't run cleanly on
// Workers. fetch() is enough.
//
// Behavior in dev mode: if RESEND_API_KEY isn't set, log the email
// to console instead of sending. Lets local dev work without
// signing up.

type SendOpts = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(
  env: Record<string, string | undefined>,
  opts: SendOpts,
): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM || 'Max <onboarding@resend.dev>';

  if (!apiKey) {
    console.log(
      '[max] (no RESEND_API_KEY — email NOT sent, would have been:)',
    );
    console.log('  to:', opts.to);
    console.log('  subject:', opts.subject);
    console.log('  body:', opts.text || opts.html);
    return;
  }

  // 8-second timeout. If Resend hangs (or our key is bad and they
  // stall the connection), we want to fail fast so the magic-link
  // route falls back to returning the directLink. A hung fetch with
  // no abort signal would burn the worker's wall budget and trip
  // Cloudflare's "code hung" cancellation — which surfaces as
  // "Server unreachable" on the client.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error('Resend HTTP ' + resp.status + ': ' + detail);
  }
}
