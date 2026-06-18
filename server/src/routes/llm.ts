// LLM proxy — POST /llm/messages
//
// Accepts the same payload shape the client used to send directly
// to api.anthropic.com (model, max_tokens, system, messages, etc.)
// and forwards it with the SERVER's Anthropic API key. Returns the
// Anthropic response body verbatim, including the upstream HTTP
// status. The client treats this endpoint as a drop-in for the
// direct API path — no payload restructuring needed.
//
// Why proxy instead of letting users paste their own key:
//   1. Testers don't need an Anthropic account to try the product
//   2. We control costs and can surface a usage meter per user
//   3. We can cache common requests server-side later
//   4. Enables a free-then-paid tier without distributing keys
//
// Auth: requires a valid bearer token (so anonymous traffic can't
// burn through our API budget).
//
// What's NOT here yet (lands in a follow-up):
//   - Per-user rate limiting + monthly token quotas
//   - Usage logging for billing
//   - Streaming responses (we're buffering for v1)

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../lib/auth.js';
import {
  checkQuota,
  incrementUsage,
  getCurrentUsage,
  tokenLimit,
  totalTokens,
} from '../lib/usage.js';

// Build the ordered, de-duped model fallback chain from env. Exported for unit
// testing. Precedence: MAX_MODEL → MAX_MODEL_FALLBACKS (comma-separated) →
// built-in defaults (current models). Empty/blank entries are ignored.
export function buildModelChain(
  env: Record<string, string | undefined>,
): string[] {
  const out: string[] = [];
  const push = (m?: string) => {
    const v = (m || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  push(env.MAX_MODEL);
  (env.MAX_MODEL_FALLBACKS || '').split(',').forEach(push);
  ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'].forEach(push);
  return out;
}

const llmApi = new Hono<AuthContext>();
llmApi.use('*', requireAuth);

// GET /llm/usage — current month's totals + the user's monthly cap.
// Client surfaces this so the user knows how close they are.
llmApi.get('/usage', async (c) => {
  const user = c.get('user');
  const env = (c.env as Record<string, string | undefined>) || {};
  const limit = tokenLimit(env);
  const u = await getCurrentUsage(user.id);
  return c.json({
    used: totalTokens(u),
    limit,
    inputTokens: u?.inputTokens || 0,
    outputTokens: u?.outputTokens || 0,
    cacheReadTokens: u?.cacheReadTokens || 0,
    callCount: u?.callCount || 0,
  });
});

llmApi.post('/messages', async (c) => {
  const user = c.get('user');
  const env = (c.env as Record<string, string | undefined>) || {};
  const apiKey =
    env.ANTHROPIC_API_KEY ||
    (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
  if (!apiKey) {
    return c.json(
      {
        error: {
          type: 'server_error',
          message: 'Server has no Anthropic API key configured.',
        },
      },
      500,
    );
  }

  // v350: quota check BEFORE we hit Anthropic. Saves the request fee
  // and gives the user a clear "you've hit your monthly cap" instead
  // of a generic 500. Default 100k tokens/month, override via
  // MAX_MONTHLY_TOKENS secret.
  const limit = tokenLimit(env);
  const quota = await checkQuota(user.id, limit);
  if (!quota.ok) {
    return c.json(
      {
        error: {
          type: 'quota_exceeded',
          message:
            "You've reached your monthly token quota of " +
            quota.limit.toLocaleString() +
            ' tokens (' +
            quota.used.toLocaleString() +
            ' used). Resets on the 1st of next month.',
          used: quota.used,
          limit: quota.limit,
        },
      },
      429,
    );
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(
      { error: { type: 'invalid_request', message: 'Missing JSON body' } },
      400,
    );
  }

  // MODEL RESILIENCE — the model is chosen HERE (server-authoritative), not by
  // the client. Two payoffs:
  //   1. A retired/changed model is fixed by ONE env update (MAX_MODEL secret) —
  //      no frontend rebuild, and even already-open browsers pick it up on their
  //      next call, since the server overrides whatever model they send.
  //   2. Graceful fallback chain: if a model 404s with Anthropic's
  //      not_found_error (what a retired/unknown model returns), we transparently
  //      retry the next model so the AI degrades instead of dying — and log a
  //      loud error so the operator knows to refresh MAX_MODEL.
  // Chain = MAX_MODEL, then MAX_MODEL_FALLBACKS (comma-separated), then a
  // built-in default of current models. De-duped, order preserved.
  const modelChain = buildModelChain(env);

  try {
    let data: Record<string, unknown> = {
      error: { type: 'proxy_error', message: 'No model available' },
    };
    let status = 502;
    for (let i = 0; i < modelChain.length; i++) {
      const model = modelChain[i];
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        // Override the client's model with the server's choice.
        body: JSON.stringify({ ...body, model }),
      });

      data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      status = resp.status;

      // Retired/unknown model → Anthropic returns 404 not_found_error. Fall
      // through to the next model in the chain rather than surfacing dead-AI.
      const errObj = (data as { error?: { type?: string } }).error;
      const modelMissing =
        resp.status === 404 && !!errObj && errObj.type === 'not_found_error';
      if (modelMissing && i < modelChain.length - 1) {
        console.error(
          '[max] LLM model "' +
            model +
            '" rejected (not_found) — falling back to "' +
            modelChain[i + 1] +
            '". Update the MAX_MODEL secret.',
        );
        continue;
      }

      // v350: increment usage on a successful call. Anthropic returns a `usage`
      // block. Fire-and-forget — don't make the user wait or 500 on a DB miss.
      if (resp.ok && data && typeof data === 'object' && 'usage' in data) {
        const u = (data as { usage?: Record<string, number> }).usage || {};
        void incrementUsage(user.id, {
          inputTokens: u.input_tokens || 0,
          outputTokens: u.output_tokens || 0,
          cacheCreationTokens: u.cache_creation_input_tokens || 0,
          cacheReadTokens: u.cache_read_input_tokens || 0,
        }).catch((e) => console.error('[max] usage increment failed:', e));
      }
      break; // success, or a non-model error to surface as-is
    }

    return c.json(data, status as Parameters<typeof c.json>[1]);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'LLM proxy fetch failed';
    return c.json({ error: { type: 'proxy_error', message } }, 502);
  }
});

export { llmApi };
