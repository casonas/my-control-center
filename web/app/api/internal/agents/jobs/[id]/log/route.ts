export const runtime = "edge";
// web/app/api/internal/agents/jobs/[id]/log/route.ts — Append log entry

import { withInternalAuth } from "@/lib/internalAuth";
import { getD1 } from "@/lib/d1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withInternalAuth(req, async () => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id: jobId } = await params;

    try {
      const body = await req.json() as { runnerId: string; level: string; message: string };
      const level = ["info", "warn", "error"].includes(body.level) ? body.level : "info";

      await db.prepare(
        `INSERT INTO agent_job_logs (id, job_id, ts, level, message) VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), jobId, new Date().toISOString(), level, body.message || "").run();

      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false, error: "Log append failed" }, { status: 500 });
    }
  });
}
