// web/lib/d1.ts — D1 binding helper with graceful fallback
//
// On Cloudflare Pages: uses getRequestContext() to access env.DB
// On local dev (next dev): returns null (routes should handle gracefully)

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
 * Try to obtain the D1 database binding.
 * Returns null when running outside Cloudflare (local next dev).
 */
export function getD1(): D1Database | null {
  try {
    // Dynamic import to avoid build errors in non-Cloudflare environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getRequestContext } = require("@cloudflare/next-on-pages");
    const ctx = getRequestContext();
    const db = ctx?.env?.DB;
    return db ?? null;
  } catch {
    return null;
  }
}

/** Get D1 or throw a descriptive 500 error. */
export function requireD1(): D1Database {
  const db = getD1();
  if (!db) {
    throw new D1UnavailableError();
  }
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
  const hint = err instanceof D1UnavailableError
    ? "D1 binding (env.DB) not found. Are you running on Cloudflare Pages? Check wrangler.toml [[d1_databases]] binding."
    : "Check D1 migration has been applied: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0001_chat_sessions.sql";
  console.error(`[${where}] D1 error:`, message);
  return Response.json({ error: message, where, hint }, { status: 500 });
}
