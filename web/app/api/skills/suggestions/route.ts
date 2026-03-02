export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ suggestions: [] });
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "new";
    try {
      const r = await db.prepare(`SELECT * FROM skill_suggestions WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 20`).bind(userId, status).all();
      return Response.json({ suggestions: r.results || [] });
    } catch { return Response.json({ suggestions: [] }); }
  });
}

export async function PATCH(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { id: string; status: string };
      if (!body.id || !body.status) return Response.json({ error: "id and status required" }, { status: 400 });
      const validStatuses = ["new", "saved", "dismissed", "added"];
      if (!validStatuses.includes(body.status)) return Response.json({ error: "Invalid status" }, { status: 400 });
      const now = new Date().toISOString();
      await db.prepare(`UPDATE skill_suggestions SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(body.status, now, body.id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/skills/suggestions", err); }
  });
}
