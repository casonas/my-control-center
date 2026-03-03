export const runtime = "edge";
// web/app/api/jobs/[id]/route.ts — Update job status/notes

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteContext) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const { id } = await ctx.params;
      const body = await req.json() as { status?: string; notes?: string; tags_json?: string };

      const existing = await db
        .prepare(`SELECT id FROM job_items WHERE id = ? AND user_id = ?`)
        .bind(id, session.user_id)
        .first();
      if (!existing) return Response.json({ error: "Job not found" }, { status: 404 });

      const sets: string[] = [];
      const vals: unknown[] = [];

      const validStatuses = ["new", "saved", "applied", "interview", "offer", "rejected", "dismissed"];
      if (body.status && validStatuses.includes(body.status)) {
        sets.push("status = ?");
        vals.push(body.status);
      }
      if (typeof body.notes === "string") {
        sets.push("notes = ?");
        vals.push(body.notes);
      }
      if (typeof body.tags_json === "string") {
        sets.push("tags_json = ?");
        vals.push(body.tags_json);
      }

      if (sets.length === 0) return Response.json({ error: "No fields to update" }, { status: 400 });

      vals.push(id);
      await db.prepare(`UPDATE job_items SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/jobs/:id", err);
    }
  });
}
