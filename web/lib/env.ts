// web/lib/env.ts — Central environment & binding validator
//
// Rules:
// - Never print or return actual secret values
// - Provide safe "missing/invalid" flags + actionable hints

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

export function getEnvStatus(): EnvStatus {
  const missing: string[] = [];
  const invalid: string[] = [];
  const hints: string[] = [];

  // Check D1
  const d1 = !!getD1();

  // Check R2 & KV (via request context)
  let r2 = false;
  let kv = false;
  let ai = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@cloudflare/next-on-pages");
    const ctx = mod.getRequestContext();
    r2 = !!ctx?.env?.FILES;
    kv = !!ctx?.env?.CACHE;
    ai = !!ctx?.env?.AI;
  } catch { /* not on Cloudflare */ }

  if (!d1) {
    missing.push("DB (D1 database)");
    hints.push("Add [[d1_databases]] binding in wrangler.toml and run migrations");
  }
  if (!r2) {
    hints.push("R2 (FILES) not configured — file uploads will be disabled");
  }

  // Check env vars (never expose values)
  if (!process.env.MCC_COOKIE_SIGNING_SECRET && !process.env.AUTH_SECRET) {
    missing.push("MCC_COOKIE_SIGNING_SECRET or AUTH_SECRET");
    hints.push("Set a cookie signing secret for authentication");
  }

  const ok = missing.length === 0 && invalid.length === 0;

  return { ok, missing, invalid, hints, bindings: { d1, r2, kv, ai } };
}

export function assertEnvOrThrow(where: string): void {
  const status = getEnvStatus();
  if (!status.ok) {
    throw new Error(`[${where}] Environment not configured: ${status.missing.join(", ")}. Hints: ${status.hints.join("; ")}`);
  }
}
