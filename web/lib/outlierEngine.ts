// web/lib/outlierEngine.ts — Rule-based outlier detection for stocks
//
// Deterministic detection of anomalies based on:
// - Price gap vs prior close
// - Volume spike vs baseline
// - Headline velocity spike
// - Unusual move without news

import type { D1Database } from "./d1";

// ─── Types ──────────────────────────────────────────

export type OutlierType = "gap_up" | "gap_down" | "volume_spike" | "news_spike" | "relative_strength";

export interface OutlierRow {
  id: string;
  user_id: string;
  ticker: string;
  asof: string;
  outlier_type: OutlierType;
  z_score: number;
  details_json: string;
}

interface QuoteRow {
  ticker: string;
  price: number;
  change_pct: number;
  volume: number | null;
  premarket_price: number | null;
  premarket_change_pct: number | null;
}

// ─── Thresholds ─────────────────────────────────────

const GAP_THRESHOLD_PCT = 3.0;       // 3% gap to flag
const VOLUME_SPIKE_MULTIPLIER = 2.5; // 2.5x avg volume
const NEWS_SPIKE_COUNT = 3;          // 3+ news items in 4h

// ─── Outlier detection ──────────────────────────────

export async function detectOutliers(db: D1Database, userId: string): Promise<OutlierRow[]> {
  const now = new Date().toISOString();
  const outliers: OutlierRow[] = [];

  try {
    // Fetch current quotes
    const qr = await db
      .prepare(`SELECT ticker, price, change_pct, volume, premarket_price, premarket_change_pct FROM stock_quotes WHERE user_id = ?`)
      .bind(userId)
      .all<QuoteRow>();
    const quotes = qr.results || [];

    for (const q of quotes) {
      const changePct = q.premarket_change_pct ?? q.change_pct ?? 0;

      // Gap detection
      if (Math.abs(changePct) >= GAP_THRESHOLD_PCT) {
        const type: OutlierType = changePct > 0 ? "gap_up" : "gap_down";
        const zScore = Math.abs(changePct) / GAP_THRESHOLD_PCT;
        outliers.push({
          id: crypto.randomUUID(),
          user_id: userId,
          ticker: q.ticker,
          asof: now,
          outlier_type: type,
          z_score: Math.round(zScore * 100) / 100,
          details_json: JSON.stringify({
            change_pct: changePct,
            price: q.price,
            premarket_price: q.premarket_price,
            severity: zScore >= 2 ? "high" : "medium",
          }),
        });
      }

      // Volume spike (if volume data available)
      if (q.volume && q.volume > 0) {
        // Check against recent average
        try {
          const hist = await db
            .prepare(`SELECT AVG(volume) as avg_vol FROM stock_quotes WHERE user_id = ? AND ticker = ? AND volume > 0`)
            .bind(userId, q.ticker)
            .first<{ avg_vol: number | null }>();
          if (hist?.avg_vol && q.volume > hist.avg_vol * VOLUME_SPIKE_MULTIPLIER) {
            const zScore = q.volume / hist.avg_vol;
            outliers.push({
              id: crypto.randomUUID(),
              user_id: userId,
              ticker: q.ticker,
              asof: now,
              outlier_type: "volume_spike",
              z_score: Math.round(zScore * 100) / 100,
              details_json: JSON.stringify({
                volume: q.volume,
                avg_volume: hist.avg_vol,
                multiplier: Math.round(zScore * 10) / 10,
                severity: zScore >= 4 ? "high" : "medium",
              }),
            });
          }
        } catch { /* non-fatal */ }
      }

      // News velocity spike
      try {
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        const newsCount = await db
          .prepare(`SELECT COUNT(*) as cnt FROM stock_news_items WHERE user_id = ? AND ticker = ? AND fetched_at > ?`)
          .bind(userId, q.ticker, fourHoursAgo)
          .first<{ cnt: number }>();
        if (newsCount && newsCount.cnt >= NEWS_SPIKE_COUNT) {
          outliers.push({
            id: crypto.randomUUID(),
            user_id: userId,
            ticker: q.ticker,
            asof: now,
            outlier_type: "news_spike",
            z_score: newsCount.cnt / NEWS_SPIKE_COUNT,
            details_json: JSON.stringify({
              news_count_4h: newsCount.cnt,
              severity: newsCount.cnt >= 6 ? "high" : "medium",
            }),
          });
        }
      } catch { /* non-fatal */ }
    }

    // Store outliers
    for (const o of outliers) {
      try {
        await db
          .prepare(
            `INSERT INTO stock_outliers (id, user_id, ticker, asof, outlier_type, z_score, details_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(o.id, o.user_id, o.ticker, o.asof, o.outlier_type, o.z_score, o.details_json)
          .run();
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.warn("[outlier] Detection failed:", err instanceof Error ? err.message : err);
  }

  return outliers;
}

// ─── Rank outliers by combined score ────────────────

export function rankOutliers(outliers: OutlierRow[]): OutlierRow[] {
  return [...outliers].sort((a, b) => b.z_score - a.z_score);
}
