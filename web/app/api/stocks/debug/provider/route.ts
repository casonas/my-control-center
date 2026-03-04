export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";
import { getStockIntelBase } from "@/lib/stockProviders";

/** Mask a URL to show only the host (no path, no credentials). */
function maskedHost(url: string): string {
  if (!url) return "(not configured)";
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return "(invalid URL)";
  }
}

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const base = getStockIntelBase();

    // 1) Yahoo test fetch
    let yahooStatus = "unknown";
    try {
      const res = await fetch(
        "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL",
        { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "MCC-Debug/1.0" } },
      );
      yahooStatus = `HTTP ${res.status}`;
    } catch (err) {
      yahooStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 2) Stock Intel test fetch
    let stockIntelStatus = "not configured";
    if (base) {
      try {
        const res = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(8_000),
          headers: { "User-Agent": "MCC-Debug/1.0" },
        });
        stockIntelStatus = `HTTP ${res.status}`;
      } catch (err) {
        stockIntelStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 3) Last refresh sourceHealth from cron_runs
    let lastRefreshHealth: unknown = null;
    const db = getD1();
    if (db) {
      try {
        const row = await db.prepare(
          `SELECT status, items_processed, error, last_run_at, took_ms
           FROM cron_runs WHERE job_name = ? ORDER BY last_run_at DESC LIMIT 1`,
        ).bind(`stocks_refresh_${userId}`).first();
        lastRefreshHealth = row || null;
      } catch { /* table may not exist */ }
    }

    return Response.json({
      env: {
        STOCK_INTEL_API_BASE: maskedHost(base),
      },
      yahooTestFetch: yahooStatus,
      stockIntelTestFetch: stockIntelStatus,
      lastRefreshHealth,
      time: new Date().toISOString(),
    });
  });
}
