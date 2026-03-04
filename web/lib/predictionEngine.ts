// web/lib/predictionEngine.ts — Prediction creation, resolution, and scoring
//
// Handles:
// - Creating explicit predictions (direction/target/range_break/event_reaction)
// - Resolving due predictions against actual outcomes
// - Brier scoring + hit/miss determination
// - Aggregate metric computation

import type { D1Database } from "./d1";

// ─── Types ──────────────────────────────────────────

export type Horizon = "intraday" | "1d" | "1w" | "1m";
export type PredictionType = "direction" | "target" | "range_break" | "event_reaction";
export type PredictionStatus = "open" | "resolved" | "canceled";

export interface PredictionInput {
  ticker: string;
  horizon: Horizon;
  prediction_type: PredictionType;
  prediction_text: string;
  target_price?: number | null;
  target_change_pct?: number | null;
  confidence: number; // 0-100
  rationale_md: string;
}

export interface PredictionRow {
  id: string;
  user_id: string;
  ticker: string;
  horizon: Horizon;
  prediction_type: PredictionType;
  prediction_text: string;
  target_price: number | null;
  target_change_pct: number | null;
  confidence: number;
  rationale_md: string;
  created_at: string;
  due_at: string;
  status: PredictionStatus;
  resolved_at: string | null;
  actual_outcome_json: string | null;
  score_brier: number | null;
  score_hit: number | null;
}

// ─── Horizon → due_at computation ───────────────────

function computeDueAt(horizon: Horizon): string {
  const now = new Date();
  if (horizon === "intraday") {
    // Next market close: 4pm ET = 20:00 UTC (or 21:00 during DST)
    const eod = new Date(now);
    eod.setUTCHours(20, 0, 0, 0);
    if (eod.getTime() <= now.getTime()) eod.setUTCDate(eod.getUTCDate() + 1);
    return eod.toISOString();
  }
  const offsets: Record<string, number> = {
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
    "1m": 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now.getTime() + (offsets[horizon] || offsets["1d"])).toISOString();
}

// ─── Shared direction helper (used by predictionEngine + worker) ──

export function isPredictedUp(predictionText: string, targetChangePct: number | null): boolean {
  const text = predictionText.toLowerCase();
  return text.includes("up") || text.includes("bull") || (targetChangePct !== null && targetChangePct > 0);
}

// ─── Create prediction ──────────────────────────────

export async function createPrediction(db: D1Database, userId: string, input: PredictionInput): Promise<PredictionRow> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dueAt = computeDueAt(input.horizon);
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence)));

  await db
    .prepare(
      `INSERT INTO stock_predictions (id, user_id, ticker, horizon, prediction_type, prediction_text, target_price, target_change_pct, confidence, rationale_md, created_at, due_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    )
    .bind(id, userId, input.ticker.toUpperCase(), input.horizon, input.prediction_type, input.prediction_text, input.target_price ?? null, input.target_change_pct ?? null, confidence, input.rationale_md, now, dueAt)
    .run();

  return {
    id,
    user_id: userId,
    ticker: input.ticker.toUpperCase(),
    horizon: input.horizon,
    prediction_type: input.prediction_type,
    prediction_text: input.prediction_text,
    target_price: input.target_price ?? null,
    target_change_pct: input.target_change_pct ?? null,
    confidence,
    rationale_md: input.rationale_md,
    created_at: now,
    due_at: dueAt,
    status: "open",
    resolved_at: null,
    actual_outcome_json: null,
    score_brier: null,
    score_hit: null,
  };
}

// ─── Resolve predictions ────────────────────────────

export async function resolvePredictions(db: D1Database, userId: string): Promise<{ resolved: number }> {
  const now = new Date().toISOString();
  let resolved = 0;

  try {
    // Find open predictions that are due
    const rows = await db
      .prepare(`SELECT * FROM stock_predictions WHERE user_id = ? AND status = 'open' AND due_at <= ?`)
      .bind(userId, now)
      .all<PredictionRow>();
    const predictions = rows.results || [];

    for (const pred of predictions) {
      try {
        // Get latest quote for the ticker
        const quote = await db
          .prepare(`SELECT price, change_pct FROM stock_quotes WHERE user_id = ? AND ticker = ?`)
          .bind(userId, pred.ticker)
          .first<{ price: number; change_pct: number }>();

        if (!quote) {
          // No quote data — can't resolve yet, skip
          continue;
        }

        // Determine outcome
        const actualChangePct = quote.change_pct || 0;
        const actualPrice = quote.price;

        // Hit/miss logic
        let hit = 0;
        if (pred.prediction_type === "direction") {
          const predictedUp = isPredictedUp(pred.prediction_text, pred.target_change_pct);
          const actualUp = actualChangePct > 0;
          hit = predictedUp === actualUp ? 1 : 0;
        } else if (pred.prediction_type === "target" && pred.target_price !== null) {
          // Was target price reached?
          const targetMet = pred.target_price > 0 && actualPrice >= pred.target_price;
          hit = targetMet ? 1 : 0;
        } else {
          // Default: direction-based
          hit = actualChangePct > 0 ? 1 : 0;
        }

        // Brier score: (forecast_prob - outcome)^2
        // confidence is 0-100, normalize to 0-1
        const forecastProb = pred.confidence / 100;
        const brierScore = Math.round(Math.pow(forecastProb - hit, 2) * 10000) / 10000;

        const outcomeJson = JSON.stringify({
          actual_price: actualPrice,
          actual_change_pct: actualChangePct,
          resolved_at: now,
        });

        await db
          .prepare(
            `UPDATE stock_predictions SET status = 'resolved', resolved_at = ?, actual_outcome_json = ?, score_brier = ?, score_hit = ? WHERE id = ? AND user_id = ?`
          )
          .bind(now, outcomeJson, brierScore, hit, pred.id, userId)
          .run();

        resolved++;
      } catch {
        // Individual resolution failure — continue with others
      }
    }

    // Update aggregate metrics
    if (resolved > 0) {
      await updateAgentMetrics(db, userId);
    }
  } catch (err) {
    console.warn("[predictions] Resolve failed:", err instanceof Error ? err.message : err);
  }

  return { resolved };
}

// ─── Update aggregate metrics ───────────────────────

async function updateAgentMetrics(db: D1Database, userId: string) {
  const now = new Date().toISOString();
  const windows: { name: string; days: number }[] = [
    { name: "7d", days: 7 },
    { name: "30d", days: 30 },
    { name: "90d", days: 90 },
  ];

  for (const w of windows) {
    try {
      const since = new Date(Date.now() - w.days * 24 * 60 * 60 * 1000).toISOString();
      const stats = await db
        .prepare(
          `SELECT
             COUNT(*) as total,
             SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
             AVG(CASE WHEN status = 'resolved' THEN score_hit ELSE NULL END) as hit_rate,
             AVG(CASE WHEN status = 'resolved' THEN score_brier ELSE NULL END) as avg_brier
           FROM stock_predictions WHERE user_id = ? AND created_at >= ?`
        )
        .bind(userId, since)
        .first<{ total: number; resolved: number; hit_rate: number | null; avg_brier: number | null }>();

      if (stats) {
        await db
          .prepare(
            `INSERT OR REPLACE INTO stock_agent_metrics (user_id, window, total_predictions, resolved_predictions, hit_rate, avg_brier, calibration_score, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
          )
          .bind(userId, w.name, stats.total, stats.resolved, stats.hit_rate, stats.avg_brier, now)
          .run();
      }
    } catch { /* non-fatal */ }
  }
}

// ─── Get metrics for display ────────────────────────

export async function getAgentMetrics(db: D1Database, userId: string): Promise<Record<string, { total: number; resolved: number; hit_rate: number | null; avg_brier: number | null }>> {
  const metrics: Record<string, { total: number; resolved: number; hit_rate: number | null; avg_brier: number | null }> = {};
  try {
    const rows = await db
      .prepare(`SELECT * FROM stock_agent_metrics WHERE user_id = ?`)
      .bind(userId)
      .all<{ window: string; total_predictions: number; resolved_predictions: number; hit_rate: number | null; avg_brier: number | null }>();
    for (const r of rows.results || []) {
      metrics[r.window] = {
        total: r.total_predictions,
        resolved: r.resolved_predictions,
        hit_rate: r.hit_rate,
        avg_brier: r.avg_brier,
      };
    }
  } catch { /* */ }
  return metrics;
}
