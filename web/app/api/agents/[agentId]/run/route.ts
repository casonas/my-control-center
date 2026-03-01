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

type Session = { sessionId: string; userId: string };

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("=") || "");
  }
  return null;
}

async function requireSession(req: Request, DB: D1Like): Promise<Session | null> {
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

  if (!row) return null;
  return { sessionId: row.session_id, userId: row.user_id };
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
    return String(payload);
  }
}

function errorDetails(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (typeof err === "string") {
    return { message: err };
  }
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: "Unknown error" };
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

    // Parse JSON body (explicit 400 on invalid JSON)
    let body: { payload?: unknown; trigger?: string } = {};
    try {
      body = (await req.json()) as { payload?: unknown; trigger?: string };
    } catch {
      return json(400, { ok: false, requestId, error: "Invalid JSON body" });
    }

    const runId = `run_${randomId(12)}`;
    const prompt = toPrompt(body.payload);

    // Insert using your CURRENT schema for agent_runs
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
  } catch (err: unknown) {
    const details = errorDetails(err);

    console.error("[agents/run] error", {
      requestId,
      ...details,
    });

    return json(500, {
      ok: false,
      requestId,
      error: "Internal error",
      ...details,
    });
  }
}
