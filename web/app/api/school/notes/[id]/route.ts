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
      const body = (await req.json()) as {
        title?: string; contentMd?: string; courseId?: string; tagsJson?: string;
      };
      const sets: string[] = [];
      const vals: unknown[] = [];

      if (body.title !== undefined) { sets.push("title = ?"); vals.push(body.title); }
      if (body.contentMd !== undefined) { sets.push("content_md = ?"); vals.push(body.contentMd); }
      if (body.courseId !== undefined) { sets.push("course_id = ?"); vals.push(body.courseId || null); }
      if (body.tagsJson !== undefined) { sets.push("tags_json = ?"); vals.push(body.tagsJson || null); }

      if (sets.length === 0) return Response.json({ error: "No fields" }, { status: 400 });
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(id, session.user_id);

      await db.prepare(
        `UPDATE school_notes SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
      ).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/school/notes/:id", err); }
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      await db.prepare(
        `DELETE FROM school_notes WHERE id = ? AND user_id = ?`
      ).bind(id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/school/notes/:id", err); }
  });
}
