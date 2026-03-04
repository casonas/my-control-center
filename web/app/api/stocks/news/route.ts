export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";
import { parseFeed } from "@/lib/rss";
import { scanNewsFeeds } from "@/lib/stockProviders";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ items: [] });
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const ticker = url.searchParams.get("ticker");
    const catalystType = url.searchParams.get("catalyst_type");
    try {
      let query = `SELECT * FROM stock_news_items WHERE user_id = ?`;
      const params: (string | number)[] = [userId];
      if (ticker) { query += ` AND ticker = ?`; params.push(ticker); }
      if (catalystType) { query += ` AND catalyst_type = ?`; params.push(catalystType); }
      query += ` ORDER BY fetched_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ items: r.results || [] });
    } catch { return Response.json({ items: [] }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const start = Date.now();
    const result = await scanNewsFeeds(db, session.user_id, parseFeed);
    try {
      const now = new Date().toISOString();
      await db.prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
        .bind(`stocks_news_scan_${session.user_id}`, now, result.newItems).run();
    } catch { /* non-fatal */ }
    return Response.json({ ok: true, newItems: result.newItems, sources: result.sources, tookMs: Date.now() - start });
  });
}
