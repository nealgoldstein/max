// Per-user LLM usage tracking + quota enforcement.
//
// Quota is enforced as a monthly token budget. Default 100k tokens/month
// (covers ~5 heavy trip-plan sessions; tunable via MAX_MONTHLY_TOKENS env).
// Inputs and outputs both count toward the same budget.
//
// Server uses this for two things:
//   1. Reject the LLM call BEFORE we make it if the user's already over
//      their cap — protects our wallet
//   2. Increment after a successful call — for the meter UI and billing

import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Usage } from '../db/schema.js';
import { randomUUID } from 'node:crypto';

export type UsageBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  callCount: number;
  totalTokens: number;
};

export const DEFAULT_MONTHLY_TOKEN_LIMIT = 100_000;

function currentMonth(): string {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

export async function getCurrentUsage(userId: string): Promise<Usage | null> {
  const row = await db
    .select()
    .from(schema.usage)
    .where(and(eq(schema.usage.userId, userId), eq(schema.usage.month, currentMonth())))
    .get();
  return row || null;
}

export function totalTokens(u: Usage | null): number {
  if (!u) return 0;
  return u.inputTokens + u.outputTokens; // cache reads/creations excluded — they're discounts, not "fresh" usage
}

export async function checkQuota(
  userId: string,
  limit: number,
): Promise<{ ok: true } | { ok: false; used: number; limit: number }> {
  const u = await getCurrentUsage(userId);
  const used = totalTokens(u);
  if (used >= limit) return { ok: false, used, limit };
  return { ok: true };
}

export async function incrementUsage(
  userId: string,
  delta: Partial<UsageBreakdown> & { inputTokens: number; outputTokens: number },
): Promise<void> {
  const month = currentMonth();
  const existing = await getCurrentUsage(userId);
  const now = new Date();
  if (existing) {
    await db
      .update(schema.usage)
      .set({
        inputTokens: existing.inputTokens + (delta.inputTokens || 0),
        outputTokens: existing.outputTokens + (delta.outputTokens || 0),
        cacheCreationTokens:
          existing.cacheCreationTokens + (delta.cacheCreationTokens || 0),
        cacheReadTokens: existing.cacheReadTokens + (delta.cacheReadTokens || 0),
        callCount: existing.callCount + 1,
        updatedAt: now,
      })
      .where(eq(schema.usage.id, existing.id))
      .run();
  } else {
    await db
      .insert(schema.usage)
      .values({
        id: randomUUID(),
        userId,
        month,
        inputTokens: delta.inputTokens || 0,
        outputTokens: delta.outputTokens || 0,
        cacheCreationTokens: delta.cacheCreationTokens || 0,
        cacheReadTokens: delta.cacheReadTokens || 0,
        callCount: 1,
        updatedAt: now,
      })
      .run();
  }
}

export function tokenLimit(env: Record<string, string | undefined>): number {
  const raw = env.MAX_MONTHLY_TOKENS;
  if (!raw) return DEFAULT_MONTHLY_TOKEN_LIMIT;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONTHLY_TOKEN_LIMIT;
}
