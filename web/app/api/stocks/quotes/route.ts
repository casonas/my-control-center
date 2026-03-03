export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ quotes: [] });
    try {
      const r = await db.prepare(`SELECT * FROM stock_quotes WHERE user_id = ? ORDER BY ticker`).bind(userId).all();
      return Response.json({ quotes: r.results || [] });
    } catch { return Response.json({ quotes: [] }); }
  });
}
