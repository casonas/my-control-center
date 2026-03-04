export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { getQuoteProvider, storeQuotes, storeIndices, storeRegimeSnapshot } from "@/lib/stockProviders";
import { detectOutliers } from "@/lib/outlierEngine";

const COOLDOWN_MS = 60 * 1000;

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const userId = session.user_id;
    const start = Date.now();

    try {
      const lastRun = await db.prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`).bind(`stocks_refresh_${userId}`).first<{ last_run_at: string }>();
      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < COOLDOWN_MS) return Response.json({ ok: false, error: `Wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s` }, { status: 429 });
      }

      // Get watchlist tickers
      const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all<{ ticker: string }>();
      const tickers = (wl.results || []).map((r) => r.ticker);
      const now = new Date().toISOString();

      // Fetch quotes via provider abstraction
      const provider = getQuoteProvider();
      const [quotesResult, indicesResult] = await Promise.all([
        provider.fetchQuotes(tickers),
        provider.fetchIndices(),
      ]);

      // Store quotes + indices
      await storeQuotes(db, userId, quotesResult.quotes);
      await storeIndices(db, userId, indicesResult.indices);

      // Run outlier detection
      const outliers = await detectOutliers(db, userId);

      // Store regime snapshot
      const spxIdx = indicesResult.indices.find((i) => i.symbol === "SPX");
      const ndxIdx = indicesResult.indices.find((i) => i.symbol === "IXIC");
      const riskMode = (spxIdx?.change_pct ?? 0) < -1 ? "risk_off" : (spxIdx?.change_pct ?? 0) > 1 ? "risk_on" : "neutral";
      await storeRegimeSnapshot(db, userId, {
        spx_change: spxIdx?.change_pct,
        ndx_change: ndxIdx?.change_pct,
        risk_mode: riskMode,
      });

      await db.prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
        .bind(`stocks_refresh_${userId}`, now, tickers.length).run();

      return Response.json({
        ok: true,
        tickers: tickers.length,
        indices: indicesResult.indices.length,
        outliers: outliers.length,
        tookMs: Date.now() - start,
        source: provider.name,
        sourceHealth: [quotesResult.health, indicesResult.health],
      });
    } catch (err) { return d1ErrorResponse("POST /api/stocks/refresh", err); }
  });
}
