export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ tickers: [] });
    const url = new URL(req.url);
    const capBucket = url.searchParams.get("market_cap_bucket");
    try {
      let query = `SELECT ticker, display_name, sector, market_cap_bucket, tags_json, created_at FROM stock_watchlist WHERE user_id = ?`;
      const params: (string)[] = [userId];
      if (capBucket) { query += ` AND market_cap_bucket = ?`; params.push(capBucket); }
      query += ` ORDER BY created_at`;
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ tickers: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/stocks/watchlist", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { ticker?: string; displayName?: string; sector?: string; market_cap_bucket?: string; tags?: string[] };
      if (!body.ticker) return Response.json({ error: "ticker required" }, { status: 400 });
      const ticker = body.ticker.toUpperCase().trim();
      const now = new Date().toISOString();
      const tagsJson = body.tags ? JSON.stringify(body.tags) : "[]";
      await db.prepare(
        `INSERT INTO stock_watchlist (user_id, ticker, display_name, sector, market_cap_bucket, tags_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, ticker) DO UPDATE SET display_name = COALESCE(excluded.display_name, display_name), sector = COALESCE(excluded.sector, sector), market_cap_bucket = COALESCE(excluded.market_cap_bucket, market_cap_bucket), tags_json = COALESCE(excluded.tags_json, tags_json), updated_at = excluded.updated_at`
      ).bind(session.user_id, ticker, body.displayName || null, body.sector || null, body.market_cap_bucket || "large", tagsJson, now, now).run();
      const r = await db.prepare(`SELECT ticker, display_name, sector, market_cap_bucket, tags_json, created_at FROM stock_watchlist WHERE user_id = ? ORDER BY created_at`).bind(session.user_id).all();
      return Response.json({ tickers: r.results || [] }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/stocks/watchlist", err); }
  });
}
