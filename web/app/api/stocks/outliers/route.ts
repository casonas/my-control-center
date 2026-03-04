export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ outliers: [] });
    const url = new URL(req.url);
    const window = url.searchParams.get("window") || "24h";
    const ticker = url.searchParams.get("ticker");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

    // Compute cutoff time
    const windowHours: Record<string, number> = { "4h": 4, "12h": 12, "24h": 24, "48h": 48, "7d": 168 };
    const hours = windowHours[window] || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
      let query = `SELECT * FROM stock_outliers WHERE user_id = ? AND asof > ?`;
      const params: (string | number)[] = [userId, since];
      if (ticker) { query += ` AND ticker = ?`; params.push(ticker); }
      query += ` ORDER BY z_score DESC LIMIT ?`;
      params.push(limit);
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ outliers: r.results || [] });
    } catch { return Response.json({ outliers: [] }); }
  });
}
