export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ insights: [] });
    const url = new URL(req.url);
    const ticker = url.searchParams.get("ticker") || "ALL";
    const scope = url.searchParams.get("scope");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
    try {
      let query = `SELECT * FROM stock_insights WHERE user_id = ?`;
      const params: (string | number)[] = [userId];
      if (ticker !== "ALL") { query += ` AND ticker = ?`; params.push(ticker); }
      if (scope) { query += ` AND scope = ?`; params.push(scope); }
      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ insights: r.results || [] });
    } catch { return Response.json({ insights: [] }); }
  });
}
