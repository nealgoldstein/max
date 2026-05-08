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

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

    // v350: increment usage on a successful call. Anthropic returns
    // a `usage` block with input_tokens, output_tokens, and cache
    // counters. Fire-and-forget the DB write — don't make the user
    // wait, and don't 500 the response if it fails.
    if (resp.ok && data && typeof data === 'object' && 'usage' in data) {
      const u = (data as { usage?: Record<string, number> }).usage || {};
      // Don't await — fire-and-forget. ctx.waitUntil would be ideal
      // on Workers but Hono's Node adapter doesn't expose it
      // uniformly; the DB write is fast enough that this rarely
      // matters in practice.
      void incrementUsage(user.id, {
        inputTokens: u.input_tokens || 0,
        outputTokens: u.output_tokens || 0,
        cacheCreationTokens: u.cache_creation_input_tokens || 0,
        cacheReadTokens: u.cache_read_input_tokens || 0,
      }).catch((e) => console.error('[max] usage increment failed:', e));
    }

    return c.json(data, resp.status as Parameters<typeof c.json>[1]);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'LLM proxy fetch failed';
    return c.json({ error: { type: 'proxy_error', message } }, 502);
  }
});

export { llmApi };
