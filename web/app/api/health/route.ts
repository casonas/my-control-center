export const runtime = "edge";
// web/app/api/health/route.ts — Public health check (no auth required)

import { getD1, getCfEnv } from "@/lib/d1";

export async function GET() {
  const time = new Date().toISOString();
  const services: Record<string, { ok: boolean; configured: boolean; latencyMs?: number }> = {};

  // D1 check
  const db = getD1();
  if (db) {
    const d1Start = Date.now();
    try {
      await db.prepare("SELECT 1").first();
      services.d1 = { ok: true, configured: true, latencyMs: Date.now() - d1Start };
    } catch {
      services.d1 = { ok: false, configured: true, latencyMs: Date.now() - d1Start };
    }
  } else {
    services.d1 = { ok: false, configured: false };
  }

  // R2 check (just configuration presence)
  let r2Configured = false;
  try {
    const env = getCfEnv();
    r2Configured = !!env?.["FILES"];
  } catch { /* not on Cloudflare */ }
  services.r2 = { ok: r2Configured, configured: r2Configured };

  // VPS bridge check
  const bridgeUrl = process.env.MCC_BRIDGE_URL || process.env.BRIDGE_URL;
  if (bridgeUrl) {
    const vpsStart = Date.now();
    try {
      const res = await fetch(`${bridgeUrl}/status`, { signal: AbortSignal.timeout(5000) });
      services.vps = { ok: res.ok, configured: true, latencyMs: Date.now() - vpsStart };
    } catch {
      services.vps = { ok: false, configured: true, latencyMs: Date.now() - vpsStart };
    }
  } else {
    services.vps = { ok: false, configured: false };
  }

  // Cron check (just whether CRON_SECRET is set)
  services.cron = { ok: !!process.env.CRON_SECRET, configured: !!process.env.CRON_SECRET };

  const allOk = Object.values(services).every((s) => s.ok);

  return Response.json({
    ok: allOk,
    time,
    version: process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "dev",
    services,
  });
}
