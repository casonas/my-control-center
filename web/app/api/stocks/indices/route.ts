export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ indices: [] });
    try {
      const r = await db.prepare(`SELECT * FROM market_indices WHERE user_id = ? ORDER BY symbol`).bind(userId).all();
      return Response.json({ indices: r.results || [] });
    } catch { return Response.json({ indices: [] }); }
  });
}
