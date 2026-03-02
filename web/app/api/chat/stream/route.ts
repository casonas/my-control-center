// web/app/api/chat/stream/route.ts
export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";
import { withMutatingAuth } from "@/lib/mutatingAuth";

/** Read an env var from process.env first, then Cloudflare bindings. */
function getEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const val = (getRequestContext().env as Record<string, unknown>)[name];
    return typeof val === "string" ? val : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    const upstream = getEnv("MCC_VPS_SSE_URL");
    if (!upstream) {
      return Response.json({ ok: false, error: "MCC_VPS_SSE_URL not configured — set it in .env.local (VPS) or wrangler.toml (Cloudflare)" }, { status: 500 });
    }

    // Pass body through raw — zero parse overhead for Telegram-speed latency
    const bodyBytes = await req.arrayBuffer();

    // Build upstream request headers — agent context rides in headers
    // so the VPS can route to the warm agent without parsing the body
    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Accept", "text/event-stream");
    upstreamHeaders.set("Content-Type", req.headers.get("content-type") || "application/json");
    upstreamHeaders.set("X-Request-Id", crypto.randomUUID());

    // Forward agent routing context as headers for instant dispatch
    const agentId = req.headers.get("x-agent-id");
    const sessionId = req.headers.get("x-agent-session");
    const collaborators = req.headers.get("x-collab-agents");
    if (agentId) upstreamHeaders.set("X-Agent-Id", agentId);
    if (sessionId) upstreamHeaders.set("X-Agent-Session", sessionId);
    if (collaborators) upstreamHeaders.set("X-Collab-Agents", collaborators);

    // Call VPS with keep-alive for connection reuse
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: upstreamHeaders,
      body: bodyBytes,
      keepalive: true,
    });

    // If upstream fails, return useful info
    if (!upstreamRes.ok) {
      const ct = upstreamRes.headers.get("content-type") || "";
      const text = await upstreamRes.text().catch(() => "");
      if (ct.includes("application/json")) {
        try {
          const j = JSON.parse(text);
          return Response.json(
            { ok: false, error: "Upstream error", upstreamStatus: upstreamRes.status, upstream: j },
            { status: 502 }
          );
        } catch {
          // fall through
        }
      }
      return Response.json(
        { ok: false, error: "Upstream error", upstreamStatus: upstreamRes.status, upstreamText: text || `HTTP ${upstreamRes.status}` },
        { status: 502 }
      );
    }

    if (!upstreamRes.body) {
      return Response.json({ ok: false, error: "Upstream returned no body" }, { status: 502 });
    }

    // Stream response immediately — no buffering
    const headers = new Headers();
    headers.set("Content-Type", "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");

    return new Response(upstreamRes.body, { status: 200, headers });
  });
}
