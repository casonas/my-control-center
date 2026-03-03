export const runtime = "edge";
// web/app/api/connectors/test/route.ts — Test connector health

import { withMutatingAuth } from "@/lib/mutatingAuth";

/**
 * POST /api/connectors/test
 * Body: { type: "rss"|"imap"|"ics"|"vps", config?: any }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    const body = await req.json() as { type?: string; config?: Record<string, unknown> };
    const type = body.type;
    const config = body.config || {};

    if (!type || !["rss", "imap", "ics", "vps"].includes(type)) {
      return Response.json({ ok: false, error: "type must be rss|imap|ics|vps" }, { status: 400 });
    }

    const start = Date.now();

    try {
      if (type === "vps") {
        return await testVps(config, start);
      }
      if (type === "rss") {
        return await testRss(config, start);
      }
      if (type === "ics") {
        return await testIcs(config, start);
      }
      if (type === "imap") {
        return Response.json({
          ok: true,
          type: "imap",
          details: "IMAP connector test not yet implemented. Config fields validated.",
          latencyMs: Date.now() - start,
          configValid: !!(config.host && config.user),
        });
      }
    } catch (err) {
      return Response.json({
        ok: false,
        type,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      });
    }

    return Response.json({ ok: false, error: "Unknown type" }, { status: 400 });
  });
}

async function testVps(config: Record<string, unknown>, start: number) {
  const bridgeUrl = (config.bridgeUrl as string) || process.env.MCC_VPS_SSE_URL || "";
  if (!bridgeUrl) {
    return Response.json({
      ok: false,
      type: "vps",
      error: "No bridgeUrl configured",
      latencyMs: Date.now() - start,
    });
  }

  const base = bridgeUrl.replace(/\/chat\/stream\/?$/, "");
  const results: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};

  try {
    const t = Date.now();
    const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(5000) });
    results.status = { ok: res.ok, latencyMs: Date.now() - t };
  } catch (e) {
    results.status = { ok: false, latencyMs: Date.now() - start, error: String(e) };
  }

  try {
    const t = Date.now();
    const res = await fetch(`${base}/agents/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: [] }),
      signal: AbortSignal.timeout(5000),
    });
    results.heartbeat = { ok: res.ok, latencyMs: Date.now() - t };
  } catch (e) {
    results.heartbeat = { ok: false, latencyMs: Date.now() - start, error: String(e) };
  }

  const allOk = Object.values(results).every((r) => r.ok);
  return Response.json({ ok: allOk, type: "vps", details: results, latencyMs: Date.now() - start });
}

async function testRss(config: Record<string, unknown>, start: number) {
  const feeds = (config.feeds as string[]) || [];
  if (feeds.length === 0) {
    return Response.json({ ok: true, type: "rss", details: "No feeds configured", itemCount: 0, latencyMs: Date.now() - start });
  }
  try {
    const res = await fetch(feeds[0], { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    const itemCount = (text.match(/<item[\s>]/gi) || []).length + (text.match(/<entry[\s>]/gi) || []).length;
    return Response.json({ ok: res.ok, type: "rss", details: `Fetched ${feeds[0]}`, itemCount, latencyMs: Date.now() - start });
  } catch (e) {
    return Response.json({ ok: false, type: "rss", error: String(e), latencyMs: Date.now() - start });
  }
}

async function testIcs(config: Record<string, unknown>, start: number) {
  const urls = (config.urls as string[]) || [];
  if (urls.length === 0) {
    return Response.json({ ok: true, type: "ics", details: "No calendar URLs configured", eventCount: 0, latencyMs: Date.now() - start });
  }
  try {
    const res = await fetch(urls[0], { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    const eventCount = (text.match(/BEGIN:VEVENT/gi) || []).length;
    return Response.json({ ok: res.ok, type: "ics", details: `Fetched ${urls[0]}`, eventCount, latencyMs: Date.now() - start });
  } catch (e) {
    return Response.json({ ok: false, type: "ics", error: String(e), latencyMs: Date.now() - start });
  }
}
