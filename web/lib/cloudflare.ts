// web/lib/cloudflare.ts — Shared Cloudflare binding helpers
//
// Reads the Cloudflare env from the well-known globalThis symbol.
// This is the same symbol that @cloudflare/next-on-pages
// getRequestContext() reads internally.
//
// WHY WE DO THIS:
// @cloudflare/next-on-pages is deprecated. Importing it caused
// build warnings ("Package path . is not exported"). Reading the
// globalThis symbol directly avoids the import entirely.

/**
 * Reads the Cloudflare env object from the well-known globalThis symbol
 * set by the Cloudflare Pages adapter at runtime.
 * Returns null when not on Cloudflare (e.g. local dev, VPS).
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

type R2ObjectLike = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
};

export type R2BucketLike = {
  put: (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectLike | null>;
  delete: (key: string) => Promise<unknown>;
};

/**
 * Returns the R2 bucket binding (FILES) or null when not on Cloudflare
 * or when the binding is not configured.
 */
export function getR2(): R2BucketLike | null {
  const env = getCfEnv();
  if (!env) return null;
  return (env["FILES"] as R2BucketLike) ?? null;
}
