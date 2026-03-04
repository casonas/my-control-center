export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";
import { parseFeed } from "@/lib/rss";
import { scanNewsFeeds, getStockIntelProvider } from "@/lib/stockProviders";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ items: [] });
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const ticker = url.searchParams.get("ticker");
    const catalystType = url.searchParams.get("catalyst_type");

    // Build watchlist set for enrichment
    let watchlistSet = new Set<string>();
    try {
      const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all<{ ticker: string }>();
      watchlistSet = new Set((wl.results || []).map((r) => r.ticker.toUpperCase()));
    } catch { /* non-fatal */ }

    try {
      let query = `SELECT * FROM stock_news_items WHERE user_id = ?`;
      const params: (string | number)[] = [userId];
      if (ticker) { query += ` AND ticker = ?`; params.push(ticker); }
      if (catalystType) { query += ` AND catalyst_type = ?`; params.push(catalystType); }
      query += ` ORDER BY impact_score DESC, fetched_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      const r = await db.prepare(query).bind(...params).all();
      const rows = (r.results || []) as Record<string, unknown>[];

      // Enrich each item with computed quality metadata (backward-compatible)
      const items = rows.map((row) => {
        const tk = row.ticker ? String(row.ticker).toUpperCase() : null;
        const isWatchlistRelevant = tk != null && watchlistSet.has(tk);
        const reasonTags: string[] = [];
        if (isWatchlistRelevant) reasonTags.push("watchlist_ticker");
        if (row.catalyst_type) reasonTags.push(String(row.catalyst_type));
        const src = String(row.source || "");
        if (src === "Reuters Tech" || src === "SEC Litigation" || src === "WSJ Markets") {
          reasonTags.push(`${src.toLowerCase().replace(/\s+/g, "_")}_source`);
        }
        return {
          ...row,
          qualityScore: Number(row.impact_score ?? 0),
          isWatchlistRelevant,
          reasonTags,
        };
      });
      return Response.json({ items });
    } catch { return Response.json({ items: [] }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const start = Date.now();
    const intel = getStockIntelProvider();
    const result = await scanNewsFeeds(db, session.user_id, parseFeed, intel);
    try {
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error)
         VALUES (?, ?, 'success', ?, NULL)`,
      ).bind(`stocks_news_scan_${session.user_id}`, now, result.newItems).run();
    } catch { /* non-fatal */ }
    return Response.json({
      ok: true,
      newItems: result.newItems,
      sources: result.sources,
      staleFallbackUsed: result.staleFallbackUsed,
      tookMs: Date.now() - start,
    });
  });
}
