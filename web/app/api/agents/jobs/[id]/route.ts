export const runtime = "edge";
// web/app/api/agents/jobs/[id]/route.ts — Get job details + logs

import { withReadAuth } from "@/lib/readAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id } = await params;

    try {
      const job = await db
        .prepare(`SELECT * FROM agent_jobs WHERE id = ? AND user_id = ?`)
        .bind(id, userId)
        .first();

      if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });

      const logs = await db
        .prepare(`SELECT * FROM agent_job_logs WHERE job_id = ? ORDER BY ts ASC LIMIT 100`)
        .bind(id)
        .all();

      return Response.json({ job, logs: logs.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/agents/jobs/[id]", err);
    }
  });
}
