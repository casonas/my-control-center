export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ alerts: [] });
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    try {
      const r = await db.prepare(`SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).bind(userId, limit).all();
      return Response.json({ alerts: r.results || [] });
    } catch { return Response.json({ alerts: [] }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { ids?: string[] };
      if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
        return Response.json({ error: "ids array required" }, { status: 400 });
      }
      const now = new Date().toISOString();
      for (const id of body.ids) {
        await db.prepare(`UPDATE alerts SET seen_at = ? WHERE id = ? AND user_id = ?`).bind(now, id, session.user_id).run();
      }
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("POST /api/alerts", err); }
  });
}
