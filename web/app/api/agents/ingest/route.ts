export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";

type EnvLike = Record<string, unknown>;

type D1Stmt = {
  bind: (...args: unknown[]) => D1Stmt;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type D1Like = { prepare: (sql: string) => D1Stmt };

/**
 * POST /api/agents/ingest
 *
 * Agents call this to push web-scraped knowledge into the dashboard.
 * Authenticates with MCC_RUNNER_TOKEN (same as the runner system).
 *
 * Body: {
 *   agentId: string,
 *   items: Array<{
 *     type: "article" | "job" | "stock" | "note" | "research",
 *     title: string,
 *     content: string,
 *     source?: string,
 *     url?: string,
 *     tags?: string[],
 *     meta?: Record<string, unknown>
 *   }>
 * }
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    // Auth: Bearer token (same as runner)
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return Response.json({ ok: false, requestId, error: "Unauthorized" }, { status: 401 });
    }
    const token = auth.slice(7);

    const { env } = getRequestContext();
    const e = env as EnvLike;

    const expected = e["MCC_RUNNER_TOKEN"];
    if (typeof expected !== "string" || !expected) {
      return Response.json({ ok: false, requestId, error: "MCC_RUNNER_TOKEN missing" }, { status: 500 });
    }
    if (token !== expected) {
      return Response.json({ ok: false, requestId, error: "Unauthorized" }, { status: 401 });
    }

    let body: {
      agentId: string;
      items: {
        type: string;
        title: string;
        content: string;
        source?: string;
        url?: string;
        tags?: string[];
        meta?: Record<string, unknown>;
      }[];
    };

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, requestId, error: "Invalid JSON" }, { status: 400 });
    }

    if (!body?.agentId || !Array.isArray(body?.items)) {
      return Response.json({ ok: false, requestId, error: "Missing agentId or items" }, { status: 400 });
    }

    // Store items in D1 if available
    const DB = e["DB"] as unknown as D1Like | undefined;
    let stored = 0;

    if (DB) {
      for (const item of body.items) {
        const id = `ing_${crypto.randomUUID().slice(0, 12)}`;
        await DB.prepare(
          `INSERT INTO knowledge_items (id, agent_id, type, title, content, source, url, tags, meta, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(
            id,
            body.agentId,
            item.type || "note",
            item.title || "",
            item.content || "",
            item.source || "",
            item.url || "",
            JSON.stringify(item.tags || []),
            JSON.stringify(item.meta || {}),
          )
          .run();
        stored++;
      }
    }

    return Response.json({
      ok: true,
      requestId,
      ingested: stored,
      total: body.items.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agents/ingest] error", { requestId, message });
    return Response.json({ ok: false, requestId, error: "Internal error", message }, { status: 500 });
  }
}
