export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";

type EnvLike = Record<string, unknown>;

/**
 * Known OpenClaw / MCC ports with human-readable descriptions.
 * Returned as a static reference so the dashboard can display
 * what each port on the VPS is for.
 */
const PORT_REFERENCE = [
  {
    port: 8080,
    protocol: "tcp",
    service: "OpenClaw API (uvicorn)",
    description: "Main AI backend — the Cloudflare Tunnel proxies to this port",
    required: true,
  },
  {
    port: 3000,
    protocol: "tcp",
    service: "Next.js dev server",
    description: "Local dashboard dev server (only needed during development)",
    required: false,
  },
  {
    port: 18789,
    protocol: "tcp",
    service: "openclaw-gateway (metrics)",
    description: "Internal gateway metrics — managed by OpenClaw automatically",
    required: true,
  },
  {
    port: 18792,
    protocol: "tcp",
    service: "openclaw-gateway (control)",
    description: "Internal gateway control plane — managed by OpenClaw automatically",
    required: true,
  },
  {
    port: 5353,
    protocol: "udp",
    service: "openclaw-gateway (mDNS)",
    description: "Local service discovery (mDNS) — safe to ignore, auto-managed",
    required: false,
  },
];

/** Cleanup commands the user can run on the VPS to manage ports. */
const CLEANUP_COMMANDS = [
  {
    label: "List all OpenClaw ports",
    command: "ss -tulpn | grep -E '8080|18789|18792|5353|openclaw'",
  },
  {
    label: "Restart OpenClaw service",
    command: "sudo systemctl restart openclaw",
  },
  {
    label: "Restart Cloudflare Tunnel",
    command: "sudo systemctl restart cloudflared",
  },
  {
    label: "Stop Next.js dev server (port 3000)",
    command: "kill $(lsof -t -i:3000) 2>/dev/null || fuser -k 3000/tcp 2>/dev/null || echo 'not running'",
  },
  {
    label: "Check tunnel status",
    command: "sudo systemctl status cloudflared --no-pager",
  },
];

/**
 * GET /api/debug/services
 *
 * 1. Probes known VPS endpoints (connect, heartbeat, scan) via the
 *    Cloudflare Tunnel to check reachability.
 * 2. Returns a static port reference table so the UI can show
 *    what each port is for.
 * 3. Returns cleanup commands the user can copy-paste on the VPS.
 */
export async function GET() {
  const { env } = getRequestContext();
  const e = env as EnvLike;

  // Gather VPS endpoint URLs from environment
  const endpoints: { name: string; url: string | null }[] = [
    { name: "VPS Connect", url: strOrNull(e["MCC_VPS_CONNECT_URL"]) },
    { name: "VPS Heartbeat", url: strOrNull(e["MCC_VPS_HEARTBEAT_URL"]) },
    { name: "VPS Scan", url: strOrNull(e["MCC_VPS_SCAN_URL"]) },
    { name: "VPS Status", url: strOrNull(e["MCC_VPS_STATUS_URL"]) },
  ];

  // Probe each configured endpoint
  const checks = await Promise.all(
    endpoints.map(async (ep) => {
      if (!ep.url) return { name: ep.name, status: "not_configured" as const, url: null, latencyMs: null, httpStatus: null };

      const start = Date.now();
      try {
        const res = await fetch(ep.url, {
          method: "GET",
          signal: AbortSignal.timeout(5_000),
          headers: { "X-Request-Id": crypto.randomUUID() },
        });
        const latencyMs = Date.now() - start;
        return {
          name: ep.name,
          status: res.ok ? ("reachable" as const) : ("error" as const),
          url: ep.url,
          latencyMs,
          httpStatus: res.status,
        };
      } catch {
        return {
          name: ep.name,
          status: "unreachable" as const,
          url: ep.url,
          latencyMs: Date.now() - start,
          httpStatus: null,
        };
      }
    }),
  );

  return Response.json({
    ok: true,
    ts: Date.now(),
    endpoints: checks,
    portReference: PORT_REFERENCE,
    cleanupCommands: CLEANUP_COMMANDS,
  });
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
