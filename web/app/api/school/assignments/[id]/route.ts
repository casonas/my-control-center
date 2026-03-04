export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      const body = await req.json() as { title?: string; description?: string; dueAt?: string; status?: string; priority?: string; courseId?: string; notesMd?: string; estimatedMinutes?: number };
      const sets: string[] = [];
      const vals: unknown[] = [];

      if (body.title) { sets.push("title = ?"); vals.push(body.title); }
      if (body.description !== undefined) { sets.push("description = ?"); vals.push(body.description); }
      if (body.dueAt) { sets.push("due_at = ?"); vals.push(body.dueAt); }
      const validStatuses = ["open", "in_progress", "submitted", "done", "late", "dropped"];
      if (body.status && validStatuses.includes(body.status)) { sets.push("status = ?"); vals.push(body.status); }
      if (body.priority !== undefined) {
        const p = ["low", "medium", "high"].includes(body.priority || "") ? body.priority : null;
        sets.push("priority = ?"); vals.push(p);
      }
      if (body.courseId !== undefined) { sets.push("course_id = ?"); vals.push(body.courseId || null); }
      if (body.notesMd !== undefined) { sets.push("notes_md = ?"); vals.push(body.notesMd || null); }
      if (body.estimatedMinutes !== undefined) { sets.push("estimated_minutes = ?"); vals.push(body.estimatedMinutes || null); }

      if (sets.length === 0) return Response.json({ error: "No fields" }, { status: 400 });
      sets.push("updated_at = ?"); vals.push(new Date().toISOString());
      vals.push(id, session.user_id);
      await db.prepare(`UPDATE school_assignments SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/school/assignments/:id", err); }
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      await db.prepare(`DELETE FROM school_assignments WHERE id = ? AND user_id = ?`).bind(id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/school/assignments/:id", err); }
  });
}
