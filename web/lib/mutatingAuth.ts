// web/lib/mutatingAuth.ts
import { getRequestContext } from "@cloudflare/next-on-pages";

type Env = {
  DB: D1Like;
  /**
   * Optional: comma-separated origins
   * Example:
   * MCC_ALLOWED_ORIGINS="https://my-control-center.pages.dev,https://dashboard.my-control-center.com,http://localhost:3000"
   */
  MCC_ALLOWED_ORIGINS?: string;
};

// Minimal shape of Cloudflare D1 used by this helper (no global D1Database type needed)
type D1Like = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => {
      first: <T = unknown>() => Promise<T | null>;
      run: () => Promise<unknown>;
    };
  };
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
 * Use only on POST/PUT/PATCH/DELETE routes.
 */
export async function requireMutatingAuth(req: Request) {
  const { env } = getRequestContext();
  const e = env as Record<string, unknown>;

  const DB = e["DB"] as unknown as D1Like | undefined;
  if (!DB) throw new HttpError(500, "DB binding missing");

  const allowed = e["MCC_ALLOWED_ORIGINS"];
  const MCC_ALLOWED_ORIGINS = typeof allowed === "string" ? allowed : undefined;

  const typedEnv: Env = { DB, MCC_ALLOWED_ORIGINS };

  requireOriginAllowed(req, typedEnv);
  const session = await requireSession(req, typedEnv);
  requireCsrf(req, session);

  return { env: typedEnv, session };
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
