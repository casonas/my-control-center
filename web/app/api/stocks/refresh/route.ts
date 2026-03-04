export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import {
  getStockIntelProvider, storeQuotes, storeIndices, storeRegimeSnapshot,
  loadCachedQuotes, loadCachedIndices, buildFreshness,
} from "@/lib/stockProviders";
import type { SourceHealth, Freshness } from "@/lib/stockProviders";
import { detectOutliers } from "@/lib/outlierEngine";

const COOLDOWN_MS = 60_000;
const RISK_OFF_THRESHOLD = -1;
const RISK_ON_THRESHOLD = 1;

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const userId = session.user_id;
    const start = Date.now();

    try {
      // ── cooldown check ──────────────────────────────
      const lastRun = await db.prepare(
        `SELECT last_run_at FROM cron_runs WHERE job_name = ?`,
      ).bind(`stocks_refresh_${userId}`).first<{ last_run_at: string }>();
      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < COOLDOWN_MS)
          return Response.json({ ok: false, error: `Wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s` }, { status: 429 });
      }

      // ── watchlist ───────────────────────────────────
      const wl = await db.prepare(
        `SELECT ticker FROM stock_watchlist WHERE user_id = ?`,
      ).bind(userId).all<{ ticker: string }>();
      const tickers = (wl.results || []).map((r) => r.ticker);
      const now = new Date().toISOString();

      const sourceHealth: SourceHealth[] = [];
      let staleFallbackUsed = false;
      let quotesStored = 0;
      let indicesStored = 0;
      let freshness: Freshness | null = null;

      const provider = getStockIntelProvider();

      // ── 1. sync universe (non-blocking) ─────────────
      if (tickers.length > 0) {
        sourceHealth.push(await provider.syncUniverse(tickers));
      }

      // ── 2. trigger upstream data update (non-blocking)
      sourceHealth.push(await provider.triggerUpdate());

      // ── 3. fetch indices FIRST (persist regardless of quote outcome)
      const ir = await provider.fetchIndices();
      sourceHealth.push(ir.health);

      if (ir.indices.length > 0) {
        await storeIndices(db, userId, ir.indices);
        indicesStored = ir.indices.length;
      } else {
        const cached = await loadCachedIndices(db, userId);
        indicesStored = cached.indices.length;
        if (cached.freshness) staleFallbackUsed = true;
      }

      // ── 4. fetch quotes ─────────────────────────────
      const qr = await provider.fetchQuotes(tickers);
      sourceHealth.push(qr.health);

      let quoteSource: string;

      if (qr.quotes.length > 0) {
        await storeQuotes(db, userId, qr.quotes);
        quotesStored = qr.quotes.length;
        quoteSource = qr.quotes[0].source || qr.health.name;
        freshness = buildFreshness(now, quoteSource);
      } else {
        // API failed → serve stale D1 cache (never emit zeros)
        const cached = await loadCachedQuotes(db, userId);
        quotesStored = cached.quotes.length;
        freshness = cached.freshness;
        quoteSource = "d1-cache";
        staleFallbackUsed = true;
      }

      // ── 5. outlier detection ────────────────────────
      const outliers = await detectOutliers(db, userId);

      // ── 6. regime snapshot ──────────────────────────
      const spxIdx = ir.indices.find((i) => i.symbol === "SPX");
      const ndxIdx = ir.indices.find((i) => i.symbol === "IXIC");
      const riskMode = (spxIdx?.change_pct ?? 0) < RISK_OFF_THRESHOLD ? "risk_off"
        : (spxIdx?.change_pct ?? 0) > RISK_ON_THRESHOLD ? "risk_on" : "neutral";
      await storeRegimeSnapshot(db, userId, {
        spx_change: spxIdx?.change_pct,
        ndx_change: ndxIdx?.change_pct,
        risk_mode: riskMode,
      });

      // ── 7. cron_runs log ────────────────────────────
      // Partial if at least indices succeeded, even if quotes failed
      const overallStatus = sourceHealth.every((s) => s.status === "ok")
        ? "ok" : sourceHealth.some((s) => s.status === "ok") ? "partial" : "error";

      const errors = sourceHealth
        .filter((s) => s.status !== "ok" && s.error)
        .map((s) => `${s.name}: ${s.error}`);

      await db.prepare(
        `INSERT OR REPLACE INTO cron_runs
         (job_name, last_run_at, status, items_processed, took_ms, error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `stocks_refresh_${userId}`, now, overallStatus,
        quotesStored + indicesStored, Date.now() - start,
        errors.length > 0 ? errors.join("; ") : null, now,
      ).run();

      return Response.json({
        ok: true,
        status: overallStatus,
        quotesStored,
        indicesStored,
        tickers: quotesStored,
        indices: indicesStored,
        outliers: outliers.length,
        tookMs: Date.now() - start,
        itemsProcessed: quotesStored + indicesStored,
        source: quoteSource,
        staleFallbackUsed,
        freshness,
        sourceHealth,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err) { return d1ErrorResponse("POST /api/stocks/refresh", err); }
  });
}
