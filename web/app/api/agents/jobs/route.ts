export const runtime = "edge";
// web/app/api/agents/jobs/route.ts — User-facing agent job CRUD

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

/**
 * GET /api/agents/jobs?status=...&agentId=...&limit=50
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ jobs: [] });

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const agentId = url.searchParams.get("agentId");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

    try {
      let query = `SELECT * FROM agent_jobs WHERE user_id = ?`;
      const params: unknown[] = [userId];

      if (status) { query += ` AND status = ?`; params.push(status); }
      if (agentId) { query += ` AND agent_id = ?`; params.push(agentId); }

      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ jobs: r.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/agents/jobs", err);
    }
  });
}

/**
 * POST /api/agents/jobs — Create a queued job
 * Body: { agentId, type, payload }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { agentId: string; type: string; payload?: Record<string, unknown> };
      if (!body.agentId || !body.type) {
        return Response.json({ ok: false, error: "agentId and type are required" }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.prepare(
        `INSERT INTO agent_jobs (id, user_id, agent_id, type, payload_json, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', 50, ?, ?)`
      ).bind(id, session.user_id, body.agentId, body.type, JSON.stringify(body.payload || {}), now, now).run();

      return Response.json({ ok: true, jobId: id });
    } catch (err) {
      return d1ErrorResponse("POST /api/agents/jobs", err);
    }
  });
}
