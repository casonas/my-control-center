export const runtime = "edge";
// web/app/api/internal/agents/jobs/claim/route.ts — Runner claims next queued job

import { withInternalAuth } from "@/lib/internalAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withInternalAuth(req, async () => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { runnerId: string; agentId: string; maxJobs?: number };
      if (!body.runnerId || !body.agentId) {
        return Response.json({ ok: false, error: "runnerId and agentId required" }, { status: 400 });
      }

      const now = new Date().toISOString();

      // Find next queued job for this agent
      const candidate = await db
        .prepare(
          `SELECT id, user_id, agent_id, type, payload_json, priority, created_at
           FROM agent_jobs
           WHERE agent_id = ? AND status = 'queued'
           ORDER BY priority ASC, created_at ASC
           LIMIT 1`
        )
        .bind(body.agentId)
        .first();

      if (!candidate) {
        return Response.json({ ok: true, job: null, message: "No queued jobs" });
      }

      // Attempt atomic claim (WHERE status='queued' ensures no double-claim)
      const result = await db
        .prepare(
          `UPDATE agent_jobs SET status = 'claimed', claimed_by = ?, claimed_at = ?, heartbeat_at = ?, updated_at = ?
           WHERE id = ? AND status = 'queued'`
        )
        .bind(body.runnerId, now, now, now, String(candidate.id))
        .run();

      const changed = (result.meta as Record<string, unknown>)?.changes ?? 0;
      if (changed === 0) {
        // Race condition — another runner claimed it
        return Response.json({ ok: true, job: null, message: "Job already claimed (retry)" });
      }

      return Response.json({
        ok: true,
        job: {
          id: candidate.id,
          userId: candidate.user_id,
          agentId: candidate.agent_id,
          type: candidate.type,
          payload: JSON.parse(String(candidate.payload_json || "{}")),
        },
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/internal/agents/jobs/claim", err);
    }
  });
}
