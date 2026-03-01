// web/lib/mutatingAuth.ts
import { getRequestContext } from "@cloudflare/next-on-pages";

type Env = {
  DB: D1Database;
  /**
   * Optional: comma-separated origins
   * Example:
   * MCC_ALLOWED_ORIGINS="https://my-control-center.pages.dev,https://dashboard.my-control-center.com,http://localhost:3000"
   */
  MCC_ALLOWED_ORIGINS?: string;
};

export type SessionRow = {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string; // ISO string preferred
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;

  const parts = cookie.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(name + "=")) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

function normalizeOrigin(origin: string) {
  try {
    const u = new URL(origin);
    return `${u.protocol}//${u.host}`; // drop path/query
  } catch {
    return "";
  }
}

function buildAllowedOrigins(env: Env, req: Request): Set<string> {
  const allowed = new Set<string>();

  // Explicit allowlist (if provided)
  if (env.MCC_ALLOWED_ORIGINS) {
    for (const raw of env.MCC_ALLOWED_ORIGINS.split(",")) {
      const o = normalizeOrigin(raw.trim());
      if (o) allowed.add(o);
    }
  }

  // Local dev
  allowed.add("http://localhost:3000");
  allowed.add("http://127.0.0.1:3000");

  // Same-origin based on request host (covers pages.dev + your custom domain once repointed)
  const host = req.headers.get("host");
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }

  return allowed;
}

function requireOriginAllowed(req: Request, env: Env) {
  // Mutating endpoints: require Origin header (don’t accept null/absent)
  const origin = req.headers.get("origin");
  if (!origin) throw new HttpError(403, "Missing Origin header");

  const normalized = normalizeOrigin(origin);
  if (!normalized) throw new HttpError(403, "Invalid Origin header");

  const allowed = buildAllowedOrigins(env, req);
  if (!allowed.has(normalized)) {
    throw new HttpError(403, `Origin not allowed: ${normalized}`);
  }
}

async function requireSession(req: Request, env: Env): Promise<SessionRow> {
  const sessionId = getCookie(req, "mcc_session");
  if (!sessionId) throw new HttpError(401, "Missing session cookie");

  const row = await env.DB.prepare(
    `SELECT id, user_id, csrf_token, expires_at
     FROM sessions
     WHERE id = ?1
     LIMIT 1`
  )
    .bind(sessionId)
    .first<SessionRow>();

  if (!row) throw new HttpError(401, "Invalid session");

  // Expiration check (expects ISO timestamps)
  const exp = new Date(row.expires_at).getTime();
  if (Number.isFinite(exp) && exp <= Date.now()) {
    throw new HttpError(401, "Session expired");
  }

  return row;
}

function requireCsrf(req: Request, session: SessionRow) {
  const csrf = req.headers.get("x-csrf");
  if (!csrf) throw new HttpError(403, "Missing X-CSRF header");
  if (csrf !== session.csrf_token) throw new HttpError(403, "Invalid CSRF token");
}

/**
 * Enforces: Origin allowlist + session cookie + X-CSRF match.
 * Use only on POST/PUT/PATCH/DELETE.
 */
export async function requireMutatingAuth(req: Request) {
  const { env } = getRequestContext<Env>();
  requireOriginAllowed(req, env);
  const session = await requireSession(req, env);
  requireCsrf(req, session);
  return { env, session };
}

/**
 * Convenience wrapper: returns JSON errors consistently.
 */
export async function withMutatingAuth(
  req: Request,
  handler: (ctx: { env: Env; session: SessionRow }) => Promise<Response>
) {
  try {
    const ctx = await requireMutatingAuth(req);
    return await handler(ctx);
  } catch (e: any) {
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    console.error("withMutatingAuth unexpected error:", e);
    return jsonError(500, "Internal error");
  }
}
