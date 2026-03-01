export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";

type EnvLike = Record<string, unknown>;

type D1Stmt = {
  bind: (...args: unknown[]) => D1Stmt;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Like = {
  prepare: (sql: string) => D1Stmt;
};

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("=") || "");
  }
  return null;
}

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

async function requireSession(req: Request, DB: D1Like) {
  const sessionId = getCookie(req, "mcc_session");
  if (!sessionId) return null;

  const row = await DB.prepare(
    `
    SELECT s.id as session_id, s.user_id as user_id
    FROM sessions s
    WHERE s.id = ?
      AND s.expires_at > datetime('now')
    LIMIT 1
    `
  )
    .bind(sessionId)
    .first<{ session_id: string; user_id: string }>();

  return row ? { sessionId: row.session_id, userId: row.user_id } : null;
}

function randomId(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toPrompt(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    // fallback if payload has circular refs
    return String(payload);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ agentId: string }> }
) {
  const requestId = crypto.randomUUID();

  try {
    const { env } = getRequestContext();
    const e = env as EnvLike;

    const DB = e["DB"] as unknown as D1Like | undefined;
    if (!DB) return json(500, { ok: false, requestId, error: "DB missing" });

    const sess = await requireSession(req, DB);
    if (!sess) return json(401, { ok: false, requestId, error: "Unauthorized" });

    const { agentId } = await ctx.params;
    if (!agentId) return json(400, { ok: false, requestId, error: "Missing agentId" });

    const body = (await req.json().catch(() => ({}))) as {
      payload?: unknown;
      trigger?: string; // accepted but not stored in current schema
    };

    const runId = `run_${randomId(12)}`;
    const prompt = toPrompt(body.payload);

    // Insert using CURRENT schema for agent_runs:
    // (id, user_id, agent_id, prompt, response, artifacts, tokens_used, duration_ms, status, created_at)
    // Many have defaults, but user_id/agent_id are NOT NULL so we bind those.
    await DB.prepare(
      `
      INSERT INTO agent_runs (id, user_id, agent_id, prompt, status, created_at)
      VALUES (?, ?, ?, ?, 'queued', datetime('now'))
      `
    )
      .bind(runId, sess.userId, agentId, prompt)
      .run();

    return json(200, {
      ok: true,
      requestId,
      queued: true,
      run: {
        id: runId,
        agentId,
        userId: sess.userId,
        status: "queued",
      },
    });
  } catch (err: any) {
    console.error("[agents/run] error", {
      requestId,
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });

    return json(500, {
      ok: false,
      requestId,
      error: "Internal error",
      name: err?.name,
      message: err?.message,
    });
  }
}
