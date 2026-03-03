export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ skillId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ notes: [] });
    try {
      const { skillId } = await ctx.params;
      const r = await db.prepare(`SELECT * FROM skill_notes WHERE user_id = ? AND skill_id = ? ORDER BY updated_at DESC`).bind(userId, skillId).all();
      return Response.json({ notes: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/skills/:skillId/notes", err); }
  });
}

export async function POST(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { skillId } = await ctx.params;
      const body = await req.json() as { title: string; contentMd: string; lessonId?: string };
      if (!body.title || !body.contentMd) return Response.json({ error: "title, contentMd required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO skill_notes (id, user_id, skill_id, lesson_id, title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, skillId, body.lessonId || null, body.title, body.contentMd, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/skills/:skillId/notes", err); }
  });
}
