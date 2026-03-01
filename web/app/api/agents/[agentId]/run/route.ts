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

function bad(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

// Minimal auth: require valid session (same as /auth/me)
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
  ).bind(sessionId).first<{ session_id: string; user_id: string }>();

  return row ? { sessionId: row.session_id, userId: row.user_id } : null;
}

function randomId(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { env } = getRequestContext();
  const e = env as EnvLike;

  const DB = e["DB"] as unknown as D1Like | undefined;
  if (!DB) return bad(500, "DB missing");

  const sess = await requireSession(req, DB);
  if (!sess) return bad(401, "Unauthorized");

  const { agentId } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as {
    payload?: unknown;
    trigger?: string;
  };

  const runId = `run_${randomId(12)}`;
  const payloadJson = body.payload === undefined ? null : JSON.stringify(body.payload);
  const trigger = body.trigger || "manual";

  // Queue the run
  await DB.prepare(
    `
    INSERT INTO agent_runs (id, agent_id, status, payload, trigger, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, ?, datetime('now'), datetime('now'))
    `
  )
    .bind(runId, agentId, payloadJson, trigger)
    .run();

  return Response.json({
    ok: true,
    queued: true,
    run: { id: runId, agentId, status: "queued" },
  });
}
