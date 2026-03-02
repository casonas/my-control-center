export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ skillId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ lessons: [] });
    try {
      const { skillId } = await ctx.params;
      const r = await db.prepare(
        `SELECT l.*, COALESCE(p.status, 'not_started') AS progress_status, p.completed_at
         FROM skill_lessons l
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = l.user_id
         WHERE l.user_id = ? AND l.skill_id = ?
         ORDER BY l.order_index`
      ).bind(userId, skillId).all();
      return Response.json({ lessons: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/skills/:skillId/lessons", err); }
  });
}

export async function POST(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { skillId } = await ctx.params;
      const body = await req.json() as {
        moduleTitle: string; lessonTitle: string; orderIndex?: number;
        durationMinutes?: number; contentMd: string; resources?: { label: string; url: string; type?: string }[];
      };
      if (!body.moduleTitle || !body.lessonTitle || !body.contentMd) return Response.json({ error: "moduleTitle, lessonTitle, contentMd required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO skill_lessons (id, user_id, skill_id, module_title, lesson_title, order_index, duration_minutes, content_md, resources_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, skillId, body.moduleTitle, body.lessonTitle, body.orderIndex ?? 0, body.durationMinutes ?? null, body.contentMd, body.resources ? JSON.stringify(body.resources) : null, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/skills/:skillId/lessons", err); }
  });
}
