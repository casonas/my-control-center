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
        courseId?: string; category?: string; name?: string; url?: string; notes?: string;
      };
      const sets: string[] = [];
      const vals: unknown[] = [];

      if (body.name !== undefined) { sets.push("name = ?"); vals.push(body.name); }
      if (body.url !== undefined) { sets.push("url = ?"); vals.push(body.url || null); }
      if (body.notes !== undefined) { sets.push("notes = ?"); vals.push(body.notes || null); }
      if (body.courseId !== undefined) { sets.push("course_id = ?"); vals.push(body.courseId || null); }
      if (body.category !== undefined) {
        const validCats = ["lms", "library", "tutoring", "writing", "career", "other"];
        sets.push("category = ?");
        vals.push(validCats.includes(body.category) ? body.category : "other");
      }

      if (sets.length === 0) return Response.json({ error: "No fields" }, { status: 400 });
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(id, session.user_id);

      await db.prepare(
        `UPDATE school_resources SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
      ).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/school/resources/:id", err); }
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      await db.prepare(
        `DELETE FROM school_resources WHERE id = ? AND user_id = ?`
      ).bind(id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/school/resources/:id", err); }
  });
}
