// web/app/api/chat/stream/route.ts
export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";
import { withMutatingAuth } from "@/lib/mutatingAuth";

type EnvLike = Record<string, unknown>;

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    const { env } = getRequestContext();
    const e = env as EnvLike;

    const upstream = e["MCC_VPS_SSE_URL"];
    if (typeof upstream !== "string" || !upstream) {
      return Response.json({ error: "MCC_VPS_SSE_URL missing" }, { status: 500 });
    }

    // Forward request body as-is (JSON)
    const bodyText = await req.text();

    // Forward selected headers
    // NOTE: Do NOT forward Cookie from Pages to VPS unless you explicitly want that.
    // Your VPS should auth via your Pages cookie/session logic, not the VPS.
    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Content-Type", req.headers.get("content-type") || "application/json");
    upstreamHeaders.set("Accept", "text/event-stream");

    // Optional: trace headers for debugging
    const rid = crypto.randomUUID();
    upstreamHeaders.set("X-Request-Id", rid);

    // If you want the VPS to know which user/session is calling, pass a stable identifier.
    // Example: user id from your session guard could be sent via header if desired.
    // upstreamHeaders.set("X-MCC-User", session.user_id);

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: upstreamHeaders,
      body: bodyText,
      // Important: streaming works fine without special flags on Workers runtime
    });

    // If upstream fails, return its error payload (best effort)
    if (!upstreamRes.ok) {
      const ct = upstreamRes.headers.get("content-type") || "";
      const text = await upstreamRes.text().catch(() => "");
      if (ct.includes("application/json")) {
        try {
          const j = JSON.parse(text);
          return Response.json({ error: "Upstream error", upstreamStatus: upstreamRes.status, upstream: j }, { status: 502 });
        } catch {
          // fall through
        }
      }
      return Response.json(
        { error: "Upstream error", upstreamStatus: upstreamRes.status, upstreamText: text || `HTTP ${upstreamRes.status}` },
        { status: 502 }
      );
    }

    // Must have a body to stream
    if (!upstreamRes.body) {
      return Response.json({ error: "Upstream returned no body" }, { status: 502 });
    }

    // Pass-through streaming response
    const headers = new Headers();

    // SSE headers
    headers.set("Content-Type", "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");

    // Helps avoid buffering by some proxies (mostly relevant outside CF, but harmless)
    headers.set("X-Accel-Buffering", "no");

    // CORS is same-origin for Pages app; if you ever call cross-origin, you’d need to set this carefully.
    // We rely on browser same-origin. Do not set "*" with credentials.

    // Return the upstream stream directly
    return new Response(upstreamRes.body, { status: 200, headers });
  });
}
