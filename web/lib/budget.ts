// web/lib/budget.ts — Cost guardrails for AI generation
//
// Enforces per-job caps, daily budget per feature, model tiering,
// and auto-stop/auto-downgrade near budget limits.

import type { D1Database } from "./d1";

// ─── Model Tiering ───────────────────────────────────
export type ModelTier = "cheap" | "standard" | "deep";

export const MODELS: Record<ModelTier, { name: string; costPer1kIn: number; costPer1kOut: number }> = {
  cheap:    { name: "@cf/meta/llama-3.1-8b-instruct",     costPer1kIn: 0,     costPer1kOut: 0     }, // Workers AI free tier
  standard: { name: "@cf/meta/llama-3.1-8b-instruct",     costPer1kIn: 0,     costPer1kOut: 0     }, // Same model, higher caps
  deep:     { name: "@cf/meta/llama-3.3-70b-instruct-fp8", costPer1kIn: 0,     costPer1kOut: 0     }, // 70B for complex tasks
};

// ─── Per-Job Caps ────────────────────────────────────
export interface JobCaps {
  maxItems: number;
  maxLLMCalls: number;
  maxOutputTokens: number;
  model: ModelTier;
}

export const DEFAULT_JOB_CAPS: Record<string, JobCaps> = {
  lessons:   { maxItems: 5,  maxLLMCalls: 5,  maxOutputTokens: 2000, model: "cheap" },
  radar:     { maxItems: 20, maxLLMCalls: 10, maxOutputTokens: 1500, model: "cheap" },
  chat:      { maxItems: 1,  maxLLMCalls: 1,  maxOutputTokens: 4000, model: "standard" },
  summarize: { maxItems: 10, maxLLMCalls: 10, maxOutputTokens: 1000, model: "cheap" },
};

// ─── Daily Budget Per Feature ────────────────────────
// Using Workers AI free tier (10k neurons/day) as primary constraint.
// Budget values represent approximate LLM call counts per day.
export const DAILY_BUDGET: Record<string, { maxCalls: number; maxTokensOut: number }> = {
  lessons:   { maxCalls: 20,  maxTokensOut: 40000 },
  radar:     { maxCalls: 30,  maxTokensOut: 45000 },
  chat:      { maxCalls: 50,  maxTokensOut: 200000 },
  summarize: { maxCalls: 15,  maxTokensOut: 15000 },
};

// ─── Budget Tracking ─────────────────────────────────

export interface BudgetCheck {
  allowed: boolean;
  remaining: { calls: number; tokensOut: number };
  tier: ModelTier;
  reason?: string;
}

/**
 * Check if a feature is within its daily budget. Auto-downgrades
 * model tier when approaching the limit.
 */
export async function checkBudget(
  db: D1Database,
  userId: string,
  feature: string,
  requestedTier: ModelTier = "cheap"
): Promise<BudgetCheck> {
  const budget = DAILY_BUDGET[feature] ?? DAILY_BUDGET.lessons;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const usage = await db
    .prepare(
      `SELECT COUNT(*) as call_count, COALESCE(SUM(tokens_out), 0) as total_tokens_out
       FROM budget_usage
       WHERE user_id = ? AND feature = ? AND created_at >= ?`
    )
    .bind(userId, feature, `${today}T00:00:00.000Z`)
    .first<{ call_count: number; total_tokens_out: number }>();

  const callCount = usage?.call_count ?? 0;
  const tokensOut = usage?.total_tokens_out ?? 0;

  const remainCalls = budget.maxCalls - callCount;
  const remainTokens = budget.maxTokensOut - tokensOut;

  // Hard stop: budget exhausted
  if (remainCalls <= 0 || remainTokens <= 0) {
    return {
      allowed: false,
      remaining: { calls: Math.max(0, remainCalls), tokensOut: Math.max(0, remainTokens) },
      tier: requestedTier,
      reason: `Daily ${feature} budget exhausted (${callCount}/${budget.maxCalls} calls, ${tokensOut}/${budget.maxTokensOut} tokens)`,
    };
  }

  // Auto-downgrade: if >75% of budget used, force cheap tier
  let tier = requestedTier;
  if (callCount > budget.maxCalls * 0.75 || tokensOut > budget.maxTokensOut * 0.75) {
    tier = "cheap";
  }

  return {
    allowed: true,
    remaining: { calls: remainCalls, tokensOut: remainTokens },
    tier,
  };
}

/**
 * Record usage after an LLM call.
 */
export async function recordUsage(
  db: D1Database,
  userId: string,
  feature: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  jobId?: string
): Promise<void> {
  const modelInfo = Object.values(MODELS).find((m) => m.name === model) ?? MODELS.cheap;
  const costUsd = (tokensIn / 1000) * modelInfo.costPer1kIn + (tokensOut / 1000) * modelInfo.costPer1kOut;

  await db
    .prepare(
      `INSERT INTO budget_usage (id, user_id, feature, model, tokens_in, tokens_out, cost_usd, job_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), userId, feature, model, tokensIn, tokensOut, costUsd, jobId ?? null, new Date().toISOString())
    .run();
}

/**
 * Get a model name for the given tier, respecting budget downgrade.
 */
export function getModelName(tier: ModelTier): string {
  return MODELS[tier]?.name ?? MODELS.cheap.name;
}

/**
 * Enforce per-job caps: returns adjusted caps based on remaining budget.
 */
export function enforceJobCaps(
  jobCaps: JobCaps,
  budgetCheck: BudgetCheck
): JobCaps {
  return {
    maxItems: Math.min(jobCaps.maxItems, budgetCheck.remaining.calls),
    maxLLMCalls: Math.min(jobCaps.maxLLMCalls, budgetCheck.remaining.calls),
    maxOutputTokens: Math.min(jobCaps.maxOutputTokens, budgetCheck.remaining.tokensOut),
    model: budgetCheck.tier,
  };
}
