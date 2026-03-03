// web/lib/d1.ts — D1 binding helper with graceful fallback
//
// On Cloudflare Pages: uses getRequestContext() to access env.DB
// On local dev (next dev): returns null (routes should handle gracefully)

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

type EnvWithDB = {
  DB?: unknown;
};

/**
 * Try to obtain the D1 database binding.
 * Returns null when running outside Cloudflare (local next dev).
 */
export function getD1(): D1Database | null {
  try {
    const { env } = getRequestContext();
    const maybe = (env as unknown as EnvWithDB | undefined)?.DB;
    return (maybe as unknown as D1Database) ?? null;
  } catch {
    // getRequestContext() throws outside Pages runtime (ex: local next dev)
    return null;
  }
}

/** Get D1 or throw a descriptive 500 error. */
export function requireD1(): D1Database {
  const db = getD1();
  if (!db) throw new D1UnavailableError();
  return db;
}

export class D1UnavailableError extends Error {
  status = 500;
  constructor() {
    super("D1 database binding not available");
  }
}

/** Standard JSON error response for D1 issues. */
export function d1ErrorResponse(where: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const hint =
    err instanceof D1UnavailableError
      ? "D1 binding (env.DB) not found. Check Pages bindings: D1 database binding name must be DB."
      : "Confirm D1 schema applied to REMOTE database: npx wrangler d1 execute mcc-store --remote --file=cloudflare/d1-schema.sql";

  console.error(`[${where}] D1 error:`, message);
  return Response.json({ error: message, where, hint }, { status: 500 });
}
