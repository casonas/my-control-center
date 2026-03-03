export const runtime = "edge";
// web/app/api/internal/agents/jobs/[id]/complete/route.ts — Runner marks job complete

import { withInternalAuth } from "@/lib/internalAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withInternalAuth(req, async () => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id } = await params;

    try {
      const body = await req.json() as {
        runnerId: string;
        status: "succeeded" | "failed";
        error?: string;
      };

      if (!body.runnerId || !body.status) {
        return Response.json({ ok: false, error: "runnerId and status required" }, { status: 400 });
      }

      const now = new Date().toISOString();
      await db
        .prepare(
          `UPDATE agent_jobs SET status = ?, finished_at = ?, updated_at = ?, error = ?
           WHERE id = ? AND claimed_by = ?`
        )
        .bind(body.status, now, now, body.error || null, id, body.runnerId)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("POST /api/internal/agents/jobs/[id]/complete", err);
    }
  });
}
