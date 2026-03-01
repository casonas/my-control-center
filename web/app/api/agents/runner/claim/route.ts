export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";

type EnvLike = Record<string, unknown>;

// D1: prepare() returns a statement that supports bind(), first(), run()
type D1Stmt = {
  bind: (...args: unknown[]) => D1Stmt;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Like = {
  prepare: (sql: string) => D1Stmt;
};

function unauthorized() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return unauthorized();

  const token = auth.slice(7);

  const { env } = getRequestContext();
  const e = env as EnvLike;

  const expected = e["MCC_RUNNER_TOKEN"];
  if (typeof expected !== "string" || !expected) {
    return Response.json({ ok: false, error: "MCC_RUNNER_TOKEN missing" }, { status: 500 });
  }
  if (token !== expected) return unauthorized();

  const DB = e["DB"] as unknown as D1Like | undefined;
  if (!DB) return Response.json({ ok: false, error: "DB missing" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { runnerId?: string };
  const runnerId = body?.runnerId || "unknown-runner";

  // Find one queued run
  const run = await DB.prepare(
    `
    SELECT id, agent_id
    FROM agent_runs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
    `
  ).first<{ id: string; agent_id: string }>();

  if (!run) {
    return Response.json({ ok: true, claimed: false });
  }

  // Lock it (basic lock)
  await DB.prepare(
    `
    UPDATE agent_runs
    SET status = 'running',
        locked_by = ?,
        started_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
    `
  )
    .bind(runnerId, run.id)
    .run();

  return Response.json({
    ok: true,
    claimed: true,
    run: { id: run.id, agentId: run.agent_id },
  });
}
