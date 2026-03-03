export const runtime = "edge";
// web/app/api/agents/jobs/[id]/cancel/route.ts — Cancel a queued/running job

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id } = await params;
    const now = new Date().toISOString();

    try {
      const result = await db
        .prepare(
          `UPDATE agent_jobs SET status = 'canceled', updated_at = ?
           WHERE id = ? AND user_id = ? AND status IN ('queued','claimed','running')`
        )
        .bind(now, id, session.user_id)
        .run();

      const changed = (result.meta as Record<string, unknown>)?.changes ?? 0;
      if (changed === 0) {
        return Response.json({ ok: false, error: "Job not found or not cancelable" }, { status: 404 });
      }

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("POST /api/agents/jobs/[id]/cancel", err);
    }
  });
}
