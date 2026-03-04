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
        code?: string; name?: string; term?: string; color?: string;
        instructor?: string; lms_url?: string;
      };
      const sets: string[] = [];
      const vals: unknown[] = [];

      if (body.code !== undefined) { sets.push("code = ?"); vals.push(body.code); }
      if (body.name !== undefined) { sets.push("name = ?"); vals.push(body.name || null); }
      if (body.term !== undefined) { sets.push("term = ?"); vals.push(body.term || null); }
      if (body.color !== undefined) { sets.push("color = ?"); vals.push(body.color || null); }
      if (body.instructor !== undefined) { sets.push("instructor = ?"); vals.push(body.instructor || null); }
      if (body.lms_url !== undefined) { sets.push("lms_url = ?"); vals.push(body.lms_url || null); }

      if (sets.length === 0) return Response.json({ error: "No fields" }, { status: 400 });
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(id, session.user_id);

      await db.prepare(
        `UPDATE courses SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
      ).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/school/courses/:id", err); }
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      await db.prepare(
        `DELETE FROM courses WHERE id = ? AND user_id = ?`
      ).bind(id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/school/courses/:id", err); }
  });
}
