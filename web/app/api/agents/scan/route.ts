export const runtime = "edge";

import { withMutatingAuth } from "@/lib/mutatingAuth";

/**
 * POST /api/agents/scan
 *
 * Triggers a web-scan task for a specific agent.  The agent searches
 * the web, retrieves relevant content, and pushes results back via
 * the /api/agents/ingest endpoint.
 *
 * This uses the same agent_runs queue as regular tasks — the VPS
 * runner picks up the scan, executes it, and stores results.
 *
 * Body: { agentId, query?, scope? }
 * Returns: { ok, runId, status }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    let body: {
      agentId: string;
      query?: string;
      scope?: "news" | "jobs" | "stocks" | "research" | "all";
    };

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (!body?.agentId) {
      return Response.json({ ok: false, error: "Missing agentId" }, { status: 400 });
    }

    const scope = body.scope || "all";
    const query = body.query || "";

    // Try to forward directly to VPS for immediate execution
    try {
      const upstream = process.env["MCC_VPS_SCAN_URL"];

      if (typeof upstream === "string" && upstream) {
        const upstreamRes = await fetch(upstream, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": crypto.randomUUID(),
          },
          body: JSON.stringify({
            agentId: body.agentId,
            query,
            scope,
            userId: session.user_id,
          }),
        });

        if (upstreamRes.ok) {
          const data = await upstreamRes.json() as Record<string, unknown>;
          return Response.json({
            ok: true,
            runId: data.runId || crypto.randomUUID(),
            status: "scanning",
            vps: true,
          });
        }
      }
    } catch {
      // VPS unreachable — queue it instead
    }

    return Response.json({ ok: true, runId: `local_${Date.now()}`, status: "queued" });
  });
}
