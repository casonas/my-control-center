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
        courseId?: string; type?: string; title?: string;
        startsAt?: string; endsAt?: string; location?: string;
        linkedAssignmentId?: string;
      };
      const sets: string[] = [];
      const vals: unknown[] = [];

      if (body.title !== undefined) { sets.push("title = ?"); vals.push(body.title); }
      if (body.courseId !== undefined) { sets.push("course_id = ?"); vals.push(body.courseId || null); }
      if (body.startsAt !== undefined) { sets.push("starts_at = ?"); vals.push(body.startsAt); }
      if (body.endsAt !== undefined) { sets.push("ends_at = ?"); vals.push(body.endsAt || null); }
      if (body.location !== undefined) { sets.push("location = ?"); vals.push(body.location || null); }
      if (body.linkedAssignmentId !== undefined) {
        sets.push("linked_assignment_id = ?");
        vals.push(body.linkedAssignmentId || null);
      }
      if (body.type !== undefined) {
        const validTypes = ["class", "exam", "assignment", "milestone", "office_hours"];
        if (validTypes.includes(body.type)) { sets.push("type = ?"); vals.push(body.type); }
      }

      if (sets.length === 0) return Response.json({ error: "No fields" }, { status: 400 });
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(id, session.user_id);

      await db.prepare(
        `UPDATE school_calendar_events SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
      ).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/school/calendar/:id", err); }
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      await db.prepare(
        `DELETE FROM school_calendar_events WHERE id = ? AND user_id = ?`
      ).bind(id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/school/calendar/:id", err); }
  });
}
