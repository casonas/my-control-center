
import { withMutatingAuth } from "@/lib/mutatingAuth";

/**
 * POST /api/agents/heartbeat
 *
 * Keeps warm agent sessions alive on the VPS.  Called every ~30 s
 * by the client-side AgentSessionManager.
 *
 * Body: { sessions: [{ agentId, sessionId }] }
 * Returns: { ok, sessions: [{ agentId, sessionId, status }] }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    let body: {
      sessions: { agentId: string; sessionId: string }[];
    };

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (!Array.isArray(body?.sessions)) {
      return Response.json({ ok: false, error: "Missing sessions array" }, { status: 400 });
    }

    // Try to forward to VPS if configured
    try {
      const upstream = process.env["MCC_VPS_HEARTBEAT_URL"];

      if (typeof upstream === "string" && upstream) {
        const upstreamRes = await fetch(upstream, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": crypto.randomUUID(),
          },
          body: JSON.stringify({ sessions: body.sessions }),
        });

        if (upstreamRes.ok) {
          const data = await upstreamRes.json() as Record<string, unknown>;
          return Response.json({
            ok: true,
            sessions: data.sessions || body.sessions.map((s) => ({ ...s, status: "connected" })),
            vps: true,
          });
        }
      }
    } catch {
      // VPS unreachable — fall through
    }

    // Local-only fallback: echo back all sessions as connected
    return Response.json({
      ok: true,
      sessions: body.sessions.map((s) => ({
        agentId: s.agentId,
        sessionId: s.sessionId,
        status: "connected",
      })),
      vps: false,
    });
  });
}
