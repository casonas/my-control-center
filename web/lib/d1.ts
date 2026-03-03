// web/lib/d1.ts — D1 binding helper with graceful fallback

import { getRequestContext } from "@cloudflare/next-on-pages";

/** Minimal D1 interface — avoids needing @cloudflare/workers-types */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

/**
 * Returns null when not running on Cloudflare (e.g., local next dev).
 */
export function getD1(): D1Database | null {
  try {
    const { env } = getRequestContext();
    const maybe = env as unknown as { DB?: D1Database };
    return maybe.DB ?? null;
  } catch {
    return null;
  }
}

export class D1UnavailableError extends Error {
  status = 500;
  constructor() {
    super("D1 database binding not available");
  }
}

export function d1ErrorResponse(where: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${where}] D1 error:`, message);
  return Response.json(
    {
      ok: false,
      where,
      error: message,
      hint:
        "D1 binding missing at runtime. Confirm Pages project has D1 binding named DB, and you deployed the commit that reads env.DB via getRequestContext().",
    },
    { status: 500 }
  );
}
