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
      const body = await req.json() as { status?: string; orderIndex?: number; targetDate?: string; prereqSkillIds?: string[] };
      const sets: string[] = [];
      const vals: unknown[] = [];
      const validStatuses = ["planned", "in_progress", "completed", "paused"];
      if (body.status && validStatuses.includes(body.status)) { sets.push("status = ?"); vals.push(body.status); }
      if (body.orderIndex != null) { sets.push("order_index = ?"); vals.push(body.orderIndex); }
      if (body.targetDate !== undefined) { sets.push("target_date = ?"); vals.push(body.targetDate); }
      if (body.prereqSkillIds) { sets.push("prereq_skill_ids_json = ?"); vals.push(JSON.stringify(body.prereqSkillIds)); }
      if (sets.length === 0) return Response.json({ error: "No fields" }, { status: 400 });
      sets.push("updated_at = ?"); vals.push(new Date().toISOString());
      vals.push(id, session.user_id);
      await db.prepare(`UPDATE roadmap_items SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/skills/roadmap/:id", err); }
  });
}
