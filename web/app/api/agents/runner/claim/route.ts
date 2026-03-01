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

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

function unauthorized() {
  return json(401, { ok: false, error: "Unauthorized" });
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return unauthorized();

    const token = auth.slice(7);

    const { env } = getRequestContext();
    const e = env as EnvLike;

    const expected = e["MCC_RUNNER_TOKEN"];
    if (typeof expected !== "string" || !expected) {
      return json(500, { ok: false, requestId, error: "MCC_RUNNER_TOKEN missing" });
    }
    if (token !== expected) return unauthorized();

    const DB = e["DB"] as unknown as D1Like | undefined;
    if (!DB) return json(500, { ok: false, requestId, error: "DB missing" });

    const body = (await req.json().catch(() => ({}))) as { runnerId?: string };
    const runnerId = body?.runnerId || "unknown-runner";

    // 1) Find one queued run (matches your actual schema)
    const run = await DB.prepare(
      `
      SELECT id, agent_id, user_id, prompt, created_at
      FROM agent_runs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      `
    ).first<{
      id: string;
      agent_id: string;
      user_id: string;
      prompt: string;
      created_at: string;
    }>();

    if (!run) {
      return json(200, { ok: true, requestId, claimed: false });
    }

    // 2) Mark it running (only touching columns that exist)
    await DB.prepare(
      `
      UPDATE agent_runs
      SET status = 'running'
      WHERE id = ? AND status = 'queued'
      `
    )
      .bind(run.id)
      .run();

    // 3) Verify it is running (helps detect a race)
    const check = await DB.prepare(
      `
      SELECT id, status
      FROM agent_runs
      WHERE id = ?
      LIMIT 1
      `
    ).bind(run.id).first<{ id: string; status: string }>();

    if (!check || check.status !== "running") {
      // Another runner may have raced and claimed it first
      return json(200, { ok: true, requestId, claimed: false, raced: true });
    }

    return json(200, {
      ok: true,
      requestId,
      claimed: true,
      run: {
        id: run.id,
        agentId: run.agent_id,
        userId: run.user_id,
        prompt: run.prompt,
        createdAt: run.created_at,
        claimedBy: runnerId, // informational only; not stored in DB with current schema
      },
    });
  } catch (err: any) {
    console.error("[runner/claim] error", {
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
