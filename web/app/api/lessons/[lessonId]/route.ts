export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ lessonId: string }> };

/** GET /api/lessons/:lessonId — fetch a single lesson with progress */
export async function GET(_req: Request, ctx: Ctx) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { lessonId } = await ctx.params;
      const row = await db.prepare(
        `SELECT l.*, COALESCE(p.status, 'not_started') AS progress_status, p.completed_at
         FROM skill_lessons l
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = l.user_id
         WHERE l.id = ? AND l.user_id = ?`
      ).bind(lessonId, userId).first();
      if (!row) return Response.json({ error: "Lesson not found" }, { status: 404 });
      return Response.json({ lesson: row });
    } catch (err) { return d1ErrorResponse("GET /api/lessons/:lessonId", err); }
  });
}

/** PATCH /api/lessons/:lessonId — update lesson fields */
export async function PATCH(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { lessonId } = await ctx.params;
      const body = await req.json() as {
        lessonTitle?: string; moduleTitle?: string; orderIndex?: number;
        contentMd?: string; durationMinutes?: number;
      };

      const existing = await db.prepare(
        `SELECT id FROM skill_lessons WHERE id = ? AND user_id = ?`
      ).bind(lessonId, session.user_id).first();
      if (!existing) return Response.json({ error: "Lesson not found" }, { status: 404 });

      const sets: string[] = [];
      const vals: unknown[] = [];
      if (typeof body.lessonTitle === "string") { sets.push("lesson_title = ?"); vals.push(body.lessonTitle.slice(0, 200)); }
      if (typeof body.moduleTitle === "string") { sets.push("module_title = ?"); vals.push(body.moduleTitle.slice(0, 200)); }
      if (typeof body.orderIndex === "number") { sets.push("order_index = ?"); vals.push(body.orderIndex); }
      if (typeof body.contentMd === "string") { sets.push("content_md = ?"); vals.push(body.contentMd); }
      if (typeof body.durationMinutes === "number") { sets.push("duration_minutes = ?"); vals.push(body.durationMinutes); }

      if (sets.length === 0) return Response.json({ error: "No fields to update" }, { status: 400 });

      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(lessonId);

      await db.prepare(`UPDATE skill_lessons SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/lessons/:lessonId", err); }
  });
}

/** DELETE /api/lessons/:lessonId — delete a lesson (cascades progress) */
export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { lessonId } = await ctx.params;

      const existing = await db.prepare(
        `SELECT id FROM skill_lessons WHERE id = ? AND user_id = ?`
      ).bind(lessonId, session.user_id).first();
      if (!existing) return Response.json({ error: "Lesson not found" }, { status: 404 });

      // lesson_progress cascades via FK ON DELETE CASCADE
      await db.prepare(`DELETE FROM skill_lessons WHERE id = ?`).bind(lessonId).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/lessons/:lessonId", err); }
  });
}
