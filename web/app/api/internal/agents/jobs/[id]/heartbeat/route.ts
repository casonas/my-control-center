export const runtime = "edge";
// web/app/api/internal/agents/jobs/[id]/heartbeat/route.ts — Runner heartbeat

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
      await db
        .prepare(`UPDATE agent_jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, id)
        .run();
      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false, error: "Heartbeat failed" }, { status: 500 });
    }
  });
}
