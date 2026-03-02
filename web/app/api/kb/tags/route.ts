export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ tags: [] });
    try {
      const r = await db.prepare(`SELECT * FROM kb_tags WHERE user_id = ? ORDER BY name`).bind(userId).all();
      return Response.json({ tags: r.results || [] });
    } catch { return Response.json({ tags: [] }); }
  });
}
