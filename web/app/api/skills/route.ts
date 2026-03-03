export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ skills: [] });
    try {
      const r = await db.prepare(`SELECT * FROM skill_items WHERE user_id = ? ORDER BY updated_at DESC`).bind(userId).all();
      return Response.json({ skills: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/skills", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { name?: string; category?: string; level?: string; description?: string };
      if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const level = ["beginner", "intermediate", "advanced"].includes(body.level || "") ? body.level! : "beginner";
      await db.prepare(
        `INSERT OR IGNORE INTO skill_items (id, user_id, name, category, level, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, body.name, body.category || null, level, body.description || null, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/skills", err); }
  });
}
