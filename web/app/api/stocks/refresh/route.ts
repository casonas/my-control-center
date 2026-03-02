export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

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

      // MVP: store placeholder quotes (real provider integration point)
      // In production, replace with actual quote provider call
      for (const ticker of tickers) {
        await db.prepare(
          `INSERT OR REPLACE INTO stock_quotes (user_id, ticker, price, change, change_pct, currency, asof, source)
           VALUES (?, ?, 0, 0, 0, 'USD', ?, 'pending')`
        ).bind(userId, ticker, now).run();
      }

      // Store index placeholders
      for (const sym of ["SPX", "IXIC", "BTC"]) {
        await db.prepare(
          `INSERT OR REPLACE INTO market_indices (user_id, symbol, value, change_pct, asof, source)
           VALUES (?, ?, 0, 0, ?, 'pending')`
        ).bind(userId, sym, now).run();
      }

      await db.prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
        .bind(`stocks_refresh_${userId}`, now, tickers.length).run();

      return Response.json({ ok: true, tickers: tickers.length, indices: 3, tookMs: Date.now() - start, source: "pending" });
    } catch (err) { return d1ErrorResponse("POST /api/stocks/refresh", err); }
  });
}
