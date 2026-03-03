export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ items: [] });
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    try {
      const r = await db.prepare(`SELECT * FROM skill_radar_items WHERE user_id = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`)
        .bind(userId, limit, offset).all();
      return Response.json({ items: r.results || [] });
    } catch { return Response.json({ items: [] }); }
  });
}
