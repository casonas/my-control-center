

/** Read an env var from process.env. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

function getD1(): D1Like | undefined {
  return undefined;
}

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
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  if (typeof err === "string") return { message: err };
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
    if (!DB) return json(200, { ok: true, requestId, updated: null, reason: "no-db" });

    // --- Body required ---
    let body: {
      runId: string;
      status?: "completed" | "failed";
      response?: string;
      artifacts?: unknown; // will be JSON-stringified into TEXT column
      tokens_used?: number;
      duration_ms?: number;
    };

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json(400, { ok: false, requestId, error: "Invalid JSON body" });
    }

    if (!body?.runId || typeof body.runId !== "string") {
      return json(400, { ok: false, requestId, error: "Missing runId" });
    }

    const finalStatus = body.status === "failed" ? "failed" : "completed";
    const response = typeof body.response === "string" ? body.response : "";
    const artifactsJson =
      body.artifacts === undefined ? "[]" : JSON.stringify(body.artifacts);
    const tokensUsed = Number.isFinite(body.tokens_used) ? Math.floor(body.tokens_used!) : 0;
    const durationMs = Number.isFinite(body.duration_ms) ? Math.floor(body.duration_ms!) : 0;

    // Update ONLY columns that exist in your schema:
    // response, artifacts, tokens_used, duration_ms, status
    await DB.prepare(
      `
      UPDATE agent_runs
      SET response = ?,
          artifacts = ?,
          tokens_used = ?,
          duration_ms = ?,
          status = ?
      WHERE id = ?
      `
    )
      .bind(response, artifactsJson, tokensUsed, durationMs, finalStatus, body.runId)
      .run();

    // Return the updated row (optional but useful)
    const updated = await DB.prepare(
      `
      SELECT id, user_id, agent_id, status, prompt, response, artifacts, tokens_used, duration_ms, created_at
      FROM agent_runs
      WHERE id = ?
      LIMIT 1
      `
    )
      .bind(body.runId)
      .first<{
        id: string;
        user_id: string;
        agent_id: string;
        status: string;
        prompt: string;
        response: string;
        artifacts: string;
        tokens_used: number;
        duration_ms: number;
        created_at: string;
      }>();

    return json(200, { ok: true, requestId, updated });
  } catch (err: unknown) {
    const details = errorDetails(err);
    console.error("[runner/complete] error", { requestId, ...details });
    return json(500, { ok: false, requestId, error: "Internal error", ...details });
  }
}
