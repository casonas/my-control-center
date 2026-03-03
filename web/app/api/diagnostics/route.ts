export const runtime = "edge";
// web/app/api/diagnostics/route.ts — Expanded diagnostics (auth required)

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";
import { getEnvStatus } from "@/lib/env";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const envStatus = getEnvStatus();
    const db = getD1();

    const counts: Record<string, number> = {};
    const cronRuns: Record<string, unknown>[] = [];

    if (db) {
      // Table row counts (safe, no user data)
      const tables = [
        "research_items", "job_items", "stock_news_items", "sports_games",
        "kb_notes", "chat_sessions", "chat_messages", "skill_items",
        "school_assignments",
      ];
      for (const table of tables) {
        try {
          const r = await db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE user_id = ?`).bind(userId).first<{ c: number }>();
          counts[table] = r?.c ?? 0;
        } catch {
          counts[table] = -1; // table may not exist
        }
      }

      // Cron runs
      try {
        const cr = await db
          .prepare(`SELECT * FROM cron_runs WHERE job_name LIKE ? ORDER BY last_run_at DESC LIMIT 20`)
          .bind(`%_${userId}`)
          .all();
        cronRuns.push(...(cr.results || []));
      } catch { /* table may not exist */ }
    }

    return Response.json({
      env: {
        ok: envStatus.ok,
        missing: envStatus.missing,
        hints: envStatus.hints,
        bindings: envStatus.bindings,
      },
      counts,
      cronRuns,
      time: new Date().toISOString(),
    });
  });
}
