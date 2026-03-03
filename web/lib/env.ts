// web/lib/env.ts — Central environment & binding validator
//
// Rules:
// - Never print or return actual secret values
// - Provide safe "missing/invalid" flags + actionable hints

import { getRequestContext } from "@cloudflare/next-on-pages";
import { getD1 } from "./d1";

export interface EnvStatus {
  ok: boolean;
  missing: string[];
  invalid: string[];
  hints: string[];
  bindings: {
    d1: boolean;
    r2: boolean;
    kv: boolean;
    ai: boolean;
  };
}

type EnvLike = Record<string, unknown>;

function safeGetEnv(): EnvLike | null {
  try {
    const { env } = getRequestContext();
    return (env ?? null) as unknown as EnvLike | null;
  } catch {
    // Not running on Cloudflare Pages runtime (ex: local next dev)
    return null;
  }
}

function hasNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function getEnvStatus(): EnvStatus {
  const missing: string[] = [];
  const invalid: string[] = [];
  const hints: string[] = [];

  // Check bindings via helpers/context
  const d1 = !!getD1();

  const env = safeGetEnv();
  const r2 = !!env?.FILES;   // R2 binding name
  const kv = !!env?.CACHE;   // KV binding name
  const ai = !!env?.AI;      // optional binding

  if (!d1) {
    missing.push("DB (D1 database)");
    hints.push("Cloudflare Pages → Settings → Bindings: add D1 binding named DB. Then run remote schema: npx wrangler d1 execute mcc-store --remote --file=cloudflare/d1-schema.sql");
  }

  if (!r2) {
    hints.push("R2 (FILES) not configured — file uploads/downloads will be disabled");
  }
  if (!kv) {
    hints.push("KV (CACHE) not configured — caching will be disabled");
  }

  // Cookie signing / auth secrets should come from Cloudflare env on Pages.
  // (process.env is not reliably available in the Pages build/runtime)
  const cookieSecret = env?.MCC_COOKIE_SIGNING_SECRET ?? env?.AUTH_SECRET;
  if (!hasNonEmptyString(cookieSecret)) {
    missing.push("MCC_COOKIE_SIGNING_SECRET (or AUTH_SECRET)");
    hints.push("Cloudflare Pages → Settings → Environment variables: set MCC_COOKIE_SIGNING_SECRET (random 32+ chars) for stateless session cookies");
  }

  // Internal runner secret (used by /api/internal/*)
  const internal = env?.INTERNAL_SHARED_SECRET;
  if (!hasNonEmptyString(internal)) {
    missing.push("INTERNAL_SHARED_SECRET");
    hints.push("Cloudflare Pages → Settings → Environment variables: set INTERNAL_SHARED_SECRET to match your VPS runner");
  }

  const ok = missing.length === 0 && invalid.length === 0;
  return { ok, missing, invalid, hints, bindings: { d1, r2, kv, ai } };
}

export function assertEnvOrThrow(where: string): void {
  const status = getEnvStatus();
  if (!status.ok) {
    throw new Error(
      `[${where}] Environment not configured: ${status.missing.join(", ")}. Hints: ${status.hints.join("; ")}`
    );
  }
}
