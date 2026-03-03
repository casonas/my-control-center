export const runtime = "edge";
// web/app/api/internal/agents/jobs/[id]/start/route.ts — Runner marks job as running

import { withInternalAuth } from "@/lib/internalAuth";
import { getD1 } from "@/lib/d1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withInternalAuth(req, async () => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id } = await params;
    const now = new Date().toISOString();

    try {
      const body = await req.json() as { runnerId: string };
      await db
        .prepare(
          `UPDATE agent_jobs SET status = 'running', started_at = ?, heartbeat_at = ?, updated_at = ?
           WHERE id = ? AND claimed_by = ?`
        )
        .bind(now, now, now, id, body.runnerId)
        .run();
      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false, error: "Start failed" }, { status: 500 });
    }
  });
}
