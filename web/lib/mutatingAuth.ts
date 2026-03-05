// web/lib/mutatingAuth.ts
//
// Stateless auth — works on Cloudflare Pages edge workers AND a plain
// Node.js VPS (npm start).  No D1 or getRequestContext() required.
//
import { getSession } from "@/lib/auth";
import {
  getInternalUserId,
  hasInternalAuthHeaders,
  requireInternalAuth,
  InternalAuthError,
} from "@/lib/internalAuth";

export type SessionRow = {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
};

// Placeholder session id for stateless (cookie-signed) sessions.
// There is no database row — the session lives entirely in the signed cookie.
const STATELESS_SESSION_ID = "stateless";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonError(status: number, message: string) {
  return Response.json({ ok: false, error: message }, { status });
}

function normalizeOrigin(origin: string) {
  try {
    const u = new URL(origin);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function buildAllowedOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();

  // Explicit allowlist from env (works on both Cloudflare [vars] and VPS .env.local)
  const explicit = process.env.MCC_ALLOWED_ORIGINS ?? "";
  for (const raw of explicit.split(",")) {
    const o = normalizeOrigin(raw.trim());
    if (o) allowed.add(o);
  }

  // Local dev defaults
  allowed.add("http://localhost:3000");
  allowed.add("http://127.0.0.1:3000");

  // Same-origin (covers pages.dev, custom domain, VPS hostname)
  const host = req.headers.get("host");
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }

  return allowed;
}

function requireOriginAllowed(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) throw new HttpError(403, "Missing Origin header");
  const normalized = normalizeOrigin(origin);
  if (!normalized) throw new HttpError(403, "Invalid Origin header");
  const allowed = buildAllowedOrigins(req);
  if (!allowed.has(normalized)) throw new HttpError(403, `Origin not allowed: ${normalized}`);
}

/**
 * Enforces: Origin allowlist + signed session cookie + X-CSRF match.
 * Uses stateless signed cookies — no database required.
 */
export async function requireMutatingAuth(req: Request): Promise<{ session: SessionRow }> {
  if (hasInternalAuthHeaders(req)) {
    requireInternalAuth(req);
    const userId = getInternalUserId(req);
    return {
      session: {
        id: "internal",
        user_id: userId,
        csrf_token: "internal",
        expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
      },
    };
  }

  requireOriginAllowed(req);

  const session = await getSession();
  if (!session) throw new HttpError(401, "Missing or invalid session");

  const csrf = req.headers.get("x-csrf") || req.headers.get("x-csrf-token");
  if (!csrf || csrf !== session.csrfToken) throw new HttpError(403, "Invalid CSRF token");

  return {
    session: {
      id: STATELESS_SESSION_ID,
      user_id: session.userId,
      csrf_token: session.csrfToken,
      expires_at: new Date(session.expiresAt).toISOString(),
    },
  };
}

/**
 * Convenience wrapper: returns JSON errors consistently.
 */
export async function withMutatingAuth(
  req: Request,
  handler: (ctx: { session: SessionRow }) => Promise<Response>
) {
  try {
    const ctx = await requireMutatingAuth(req);
    return await handler(ctx);
  } catch (e: unknown) {
    if (e instanceof InternalAuthError) return jsonError(e.status, e.message);
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    console.error("withMutatingAuth unexpected error:", e);
    return jsonError(500, "Internal error");
  }
}

export const withMutatingOrInternalAuth = withMutatingAuth;
