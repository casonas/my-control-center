export const runtime = "edge";
// web/app/api/home/refresh/route.ts — Recompute home state from workspace summaries

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

async function safeCount(
  db: import("@/lib/d1").D1Database,
  sql: string,
  binds: unknown[],
): Promise<number> {
  try {
    const row = await db.prepare(sql).bind(...binds).first<{ cnt: number }>();
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

async function safeAvg(
  db: import("@/lib/d1").D1Database,
  sql: string,
  binds: unknown[],
): Promise<number> {
  try {
    const row = await db.prepare(sql).bind(...binds).first<{ avg_val: number }>();
    return row?.avg_val ?? 0;
  } catch {
    return 0;
  }
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db)
      return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const userId = session.user_id;
      const dateKey = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      const [dueCount, unreadCount, jobNewCount, skillProgressPct] =
        await Promise.all([
          safeCount(
            db,
            `SELECT COUNT(*) AS cnt FROM assignments WHERE user_id = ? AND completed = 0`,
            [userId],
          ),
          safeCount(
            db,
            `SELECT COUNT(*) AS cnt FROM research_articles WHERE user_id = ? AND read = 0`,
            [userId],
          ),
          safeCount(
            db,
            `SELECT COUNT(*) AS cnt FROM job_items WHERE user_id = ?`,
            [userId],
          ),
          safeAvg(
            db,
            `SELECT AVG(progress) AS avg_val FROM skill_roadmaps WHERE user_id = ?`,
            [userId],
          ),
        ]);

      // Collect top alerts from pending actions
      let topAlerts: unknown[] = [];
      try {
        const r = await db
          .prepare(
            `SELECT id, title, urgency FROM home_actions
             WHERE user_id = ? AND status = 'new'
             ORDER BY priority ASC LIMIT 5`,
          )
          .bind(userId)
          .all();
        topAlerts = r.results || [];
      } catch {
        topAlerts = [];
      }

      const topAlertsJson = JSON.stringify(topAlerts);

      // Upsert: check for existing row to reuse its id, or generate a new one
      const existing = await db
        .prepare(
          `SELECT id FROM home_daily_state WHERE user_id = ? AND date_key = ?`,
        )
        .bind(userId, dateKey)
        .first<{ id: string }>()
        .catch(() => null);
      const rowId = existing?.id ?? crypto.randomUUID();

      await db
        .prepare(
          `INSERT OR REPLACE INTO home_daily_state
           (id, user_id, date_key, due_count, unread_count, job_new_count,
            skill_progress_pct, focus_minutes, top_alerts_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(
          rowId,
          userId,
          dateKey,
          dueCount,
          unreadCount,
          jobNewCount,
          Math.round(skillProgressPct),
          topAlertsJson,
          now,
        )
        .run();

      return Response.json({
        state: {
          due_count: dueCount,
          unread_count: unreadCount,
          job_new_count: jobNewCount,
          skill_progress_pct: Math.round(skillProgressPct),
          focus_minutes: 0,
          top_alerts: topAlerts,
          updated_at: now,
        },
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/home/refresh", err);
    }
  });
}
