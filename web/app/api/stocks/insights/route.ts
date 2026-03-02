export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ insights: [] });
    const url = new URL(req.url);
    const ticker = url.searchParams.get("ticker") || "ALL";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
    try {
      let r;
      if (ticker === "ALL") {
        r = await db.prepare(`SELECT * FROM stock_insights WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).bind(userId, limit).all();
      } else {
        r = await db.prepare(`SELECT * FROM stock_insights WHERE user_id = ? AND ticker = ? ORDER BY created_at DESC LIMIT ?`).bind(userId, ticker, limit).all();
      }
      return Response.json({ insights: r.results || [] });
    } catch { return Response.json({ insights: [] }); }
  });
}
