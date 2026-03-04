export const runtime = "edge";

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse, getCfEnv } from "@/lib/d1";

type DiagResult = {
  connector_key: string;
  status: "ok" | "error";
  details: string;
  latency_ms: number;
};

async function checkD1(db: ReturnType<typeof getD1>): Promise<DiagResult> {
  const start = Date.now();
  try {
    if (!db) return { connector_key: "d1", status: "error", details: "D1 binding not available", latency_ms: 0 };
    await db.prepare("SELECT 1").first();
    return { connector_key: "d1", status: "ok", details: "Query executed successfully", latency_ms: Date.now() - start };
  } catch (e) {
    return { connector_key: "d1", status: "error", details: e instanceof Error ? e.message : String(e), latency_ms: Date.now() - start };
  }
}

function checkBinding(env: Record<string, unknown> | null, key: string, label: string): DiagResult {
  if (!env) return { connector_key: label, status: "error", details: "Cloudflare env not available", latency_ms: 0 };
  if (env[key]) return { connector_key: label, status: "ok", details: `${key} binding found`, latency_ms: 0 };
  return { connector_key: label, status: "error", details: `${key} binding not configured`, latency_ms: 0 };
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    const env = getCfEnv();

    try {
      const results: DiagResult[] = [];

      results.push(await checkD1(db));
      results.push(checkBinding(env, "KV", "kv"));
      results.push(checkBinding(env, "FILES", "r2"));

      // Persist results if D1 is available
      if (db) {
        const now = new Date().toISOString();
        for (const r of results) {
          await db
            .prepare(
              `INSERT OR REPLACE INTO connector_status (id, user_id, connector_key, status, details_json, last_checked_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              crypto.randomUUID(),
              session.user_id,
              r.connector_key,
              r.status,
              JSON.stringify({ details: r.details, latency_ms: r.latency_ms }),
              now,
              now
            )
            .run();
        }
      }

      return Response.json({ results });
    } catch (err) {
      return d1ErrorResponse("POST /api/settings/connectors/diagnostics", err);
    }
  });
}
