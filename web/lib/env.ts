// web/lib/env.ts — Central environment & binding validator

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

export function getEnvStatus(): EnvStatus {
  const missing: string[] = [];
  const invalid: string[] = [];
  const hints: string[] = [];

  const d1 = !!getD1();

  let r2 = false;
  let kv = false;
  let ai = false;

  try {
    const { env } = getRequestContext();
    const e = env as unknown as { FILES?: unknown; CACHE?: unknown; AI?: unknown };
    r2 = !!e.FILES;
    kv = !!e.CACHE;
    ai = !!e.AI;
  } catch {
    // not on Cloudflare
  }

  if (!d1) {
    missing.push("DB (D1 database)");
    hints.push("Pages Settings → Bindings → D1 database binding named DB");
  }
  if (!r2) hints.push("R2 (FILES) not configured — file uploads disabled");
  if (!kv) hints.push("KV (CACHE) not configured — caching disabled");

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
