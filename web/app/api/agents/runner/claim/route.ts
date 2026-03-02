export const runtime = "edge";


/** Read an env var from process.env. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

function getD1(): D1Like | undefined {
  return undefined;
}

// D1 minimal types
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

function unauthorized(requestId: string) {
  return json(401, { ok: false, requestId, error: "Unauthorized" });
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

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    // --- Auth: Bearer token ---
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return unauthorized(requestId);

    const token = auth.slice(7);

    const expected = getEnv("MCC_RUNNER_TOKEN");
    if (!expected) {
      return json(500, { ok: false, requestId, error: "MCC_RUNNER_TOKEN missing" });
    }
    if (token !== expected) return unauthorized(requestId);

    const DB = getD1();
    if (!DB) return json(200, { ok: true, requestId, claimed: false, reason: "no-db" });

    // Optional body (runnerId is informational only; not stored without schema change)
    let runnerId = "unknown-runner";
    try {
      const body = (await req.json()) as { runnerId?: string };
      if (body?.runnerId && typeof body.runnerId === "string") runnerId = body.runnerId;
    } catch {
      // body is optional; ignore invalid/missing JSON
    }

    // 1) Find one queued run (your actual schema has prompt/user_id)
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

    // 2) Attempt to claim it by flipping status (only columns that exist)
    await DB.prepare(
      `
      UPDATE agent_runs
      SET status = 'running'
      WHERE id = ? AND status = 'queued'
      `
    )
      .bind(run.id)
      .run();

    // 3) Verify claim (helps detect a race with multiple runners)
    const check = await DB.prepare(
      `
      SELECT status
      FROM agent_runs
      WHERE id = ?
      LIMIT 1
      `
    )
      .bind(run.id)
      .first<{ status: string }>();

    if (!check || check.status !== "running") {
      // Another runner may have claimed it first
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
        claimedBy: runnerId, // informational only
      },
    });
  } catch (err: unknown) {
    const details = errorDetails(err);

    console.error("[runner/claim] error", {
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
