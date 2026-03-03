// web/lib/d1.ts — D1 binding helper with graceful fallback
//
// WHY THIS WAS FAILING:
// @cloudflare/next-on-pages is deprecated (use @opennextjs/cloudflare).
// Its getRequestContext() just reads a well-known globalThis symbol.
// We read that symbol directly — no import needed, no build warnings.
//
// If D1 is still not found the most likely cause is that the D1 binding
// is not configured in Cloudflare Pages:
//   Dashboard → Pages → your project → Settings → Functions →
//   D1 database bindings → Variable name: DB

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
 * Reads the Cloudflare env object from the well-known globalThis symbol.
 * This is the same symbol that @cloudflare/next-on-pages getRequestContext()
 * reads, but we access it directly to avoid importing the deprecated package.
 */
export function getCfEnv(): Record<string, unknown> | null {
  try {
    const sym = Symbol.for("__cloudflare-request-context__");
    const ctx = (globalThis as Record<symbol, unknown>)[sym] as
      | { env?: Record<string, unknown> }
      | undefined;
    return ctx?.env ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns null when not running on Cloudflare (e.g., local next dev)
 * or when the D1 binding named "DB" is not configured.
 */
export function getD1(): D1Database | null {
  const env = getCfEnv();
  if (!env) return null;
  const db = env["DB"] as D1Database | undefined;
  if (!db) {
    console.warn(
      "[getD1] Cloudflare env found but DB binding is missing. " +
        "Go to Pages → Settings → Functions → D1 database bindings and add variable name DB. " +
        "Available bindings: " +
        Object.keys(env).join(", ")
    );
  }
  return db ?? null;
}

/**
 * Returns D1 or throws D1UnavailableError — use in routes that require it.
 */
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
