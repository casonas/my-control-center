export const runtime = "edge";
import { getD1 } from "@/lib/d1";


/** Read an env var from process.env. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

type D1Stmt = {
  bind: (...args: unknown[]) => D1Stmt;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type D1Like = { prepare: (sql: string) => D1Stmt };
const DEFAULT_USER_ID = "owner";

function inferSource(type: string): "general" | "research" {
  const t = String(type || "").toLowerCase();
  return (t === "article" || t === "research" || t === "stock" || t === "job") ? "research" : "general";
}

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

    const expected = getEnv("MCC_RUNNER_TOKEN");
    if (!expected) {
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
    const DB = getD1() as unknown as D1Like | undefined;
    let stored = 0;

    if (DB) {
      const userId = (body as { userId?: string }).userId?.trim() || DEFAULT_USER_ID;
      for (const item of body.items) {
        const id = `ing_${crypto.randomUUID().slice(0, 12)}`;
        const now = new Date().toISOString();
        const title = (item.title || "").slice(0, 300);
        const contentMd = (item.content || "").slice(0, 20000);
        const source = inferSource(item.type);

        await DB.prepare(
          `INSERT INTO kb_notes (id, user_id, title, content_md, source, source_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            userId,
            title,
            contentMd,
            source,
            item.url || body.agentId,
            now,
            now,
          )
          .run();
        if (Array.isArray(item.tags) && item.tags.length > 0) {
          for (const rawTag of item.tags.slice(0, 12)) {
            const tag = String(rawTag || "").trim().toLowerCase();
            if (!tag) continue;
            const tagId = crypto.randomUUID();
            await DB.prepare(
              `INSERT OR IGNORE INTO kb_tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`
            ).bind(tagId, userId, tag, now).run();
            const existingTag = await DB.prepare(
              `SELECT id FROM kb_tags WHERE user_id = ? AND name = ?`
            ).bind(userId, tag).first<{ id: string }>();
            if (existingTag?.id) {
              await DB.prepare(
                `INSERT OR IGNORE INTO kb_note_tags (user_id, note_id, tag_id) VALUES (?, ?, ?)`
              ).bind(userId, id, existingTag.id).run();
            }
          }
        }
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
