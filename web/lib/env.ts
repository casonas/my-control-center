// web/lib/env.ts — Environment status helper

import { getRequestContext } from "@cloudflare/next-on-pages";

interface EnvStatus {
  ok: boolean;
  missing: string[];
  hints: string[];
  bindings: Record<string, boolean>;
}

/**
 * Check environment variables and Cloudflare bindings.
 * Returns a status object describing what is configured.
 */
export function getEnvStatus(): EnvStatus {
  const missing: string[] = [];
  const hints: string[] = [];
  const bindings: Record<string, boolean> = {};

  // Check env vars
  if (!process.env.MCC_PASSWORD) {
    missing.push("MCC_PASSWORD");
    hints.push("Set MCC_PASSWORD in Cloudflare Pages environment variables or .env.local");
  }
  if (!process.env.MCC_COOKIE_SIGNING_SECRET) {
    missing.push("MCC_COOKIE_SIGNING_SECRET");
    hints.push("Generate with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"");
  }

  // Check Cloudflare bindings
  try {
    const { env } = getRequestContext();
    const e = env as unknown as Record<string, unknown>;
    bindings.DB = !!e["DB"];
    bindings.CACHE = !!e["CACHE"];
    bindings.FILES = !!e["FILES"];
    bindings.AI = !!e["AI"];

    if (!e["DB"]) {
      missing.push("DB (D1 binding)");
      hints.push("Add D1 binding named DB in Cloudflare Pages settings");
    }
  } catch {
    // Not running on Cloudflare
    bindings.DB = false;
    bindings.CACHE = false;
    bindings.FILES = false;
    bindings.AI = false;
    hints.push("Cloudflare bindings not available (local dev or non-CF environment)");
  }

  return {
    ok: missing.length === 0,
    missing,
    hints,
    bindings,
  };
}
