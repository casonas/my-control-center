export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ tickers: [] });
    try {
      const r = await db.prepare(`SELECT ticker, display_name, created_at FROM stock_watchlist WHERE user_id = ? ORDER BY created_at`).bind(userId).all();
      return Response.json({ tickers: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/stocks/watchlist", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { ticker?: string; displayName?: string };
      if (!body.ticker) return Response.json({ error: "ticker required" }, { status: 400 });
      const ticker = body.ticker.toUpperCase().trim();
      await db.prepare(`INSERT OR IGNORE INTO stock_watchlist (user_id, ticker, display_name, created_at) VALUES (?, ?, ?, ?)`)
        .bind(session.user_id, ticker, body.displayName || null, new Date().toISOString()).run();
      const r = await db.prepare(`SELECT ticker, display_name, created_at FROM stock_watchlist WHERE user_id = ? ORDER BY created_at`).bind(session.user_id).all();
      return Response.json({ tickers: r.results || [] }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/stocks/watchlist", err); }
  });
}
