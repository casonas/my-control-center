export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";
import { withMutatingAuth } from "@/lib/mutatingAuth";

type EnvLike = Record<string, unknown>;

/**
 * POST /api/agents/connect
 *
 * Warms up an agent on the VPS so it stays resident and ready.
 * If MCC_VPS_CONNECT_URL is set, the request is forwarded to the
 * VPS. Otherwise it returns a local session immediately so the
 * dashboard can function in local-only mode.
 *
 * Body: { agentId, sessionId?, model?, workspace?, agentDir? }
 * Returns: { ok, sessionId, status }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    let body: {
      agentId: string;
      sessionId?: string;
      model?: string;
      workspace?: string;
      agentDir?: string;
    };

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (!body?.agentId) {
      return Response.json({ ok: false, error: "Missing agentId" }, { status: 400 });
    }

    const sessionId = body.sessionId || crypto.randomUUID();

    // Try to forward to VPS if configured
    try {
      const { env } = getRequestContext();
      const e = env as EnvLike;
      const upstream = e["MCC_VPS_CONNECT_URL"];

      if (typeof upstream === "string" && upstream) {
        const upstreamRes = await fetch(upstream, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": crypto.randomUUID(),
          },
          body: JSON.stringify({
            agentId: body.agentId,
            sessionId,
            model: body.model,
            workspace: body.workspace,
            agentDir: body.agentDir,
          }),
        });

        if (upstreamRes.ok) {
          const data = await upstreamRes.json() as Record<string, unknown>;
          return Response.json({
            ok: true,
            sessionId: data.sessionId || sessionId,
            status: data.status || "connected",
            vps: true,
          });
        }
      }
    } catch {
      // VPS unreachable — fall through to local session
    }

    // Local-only fallback: return session immediately
    return Response.json({
      ok: true,
      sessionId,
      status: "connected",
      vps: false,
    });
  });
}
