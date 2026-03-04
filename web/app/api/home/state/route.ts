export const runtime = "edge";
// web/app/api/home/state/route.ts — Unified dashboard KPIs

import { withReadAuth } from "@/lib/readAuth";
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

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) {
      return Response.json({
        state: {
          due_count: 0,
          unread_count: 0,
          job_new_count: 0,
          skill_progress_pct: 0,
          focus_minutes: 0,
          top_alerts: [],
          updated_at: null,
        },
      });
    }

    try {
      const dateKey = new Date().toISOString().slice(0, 10);

      const [stateRow, dueCount, unreadCount, jobNewCount] = await Promise.all([
        db
          .prepare(
            `SELECT * FROM home_daily_state WHERE user_id = ? AND date_key = ?`,
          )
          .bind(userId, dateKey)
          .first<Record<string, unknown>>()
          .catch(() => null),
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
      ]);

      let topAlerts: unknown[] = [];
      if (stateRow?.top_alerts_json) {
        try {
          topAlerts = JSON.parse(stateRow.top_alerts_json as string);
        } catch {
          topAlerts = [];
        }
      }

      return Response.json({
        state: {
          due_count: stateRow?.due_count ?? dueCount,
          unread_count: stateRow?.unread_count ?? unreadCount,
          job_new_count: stateRow?.job_new_count ?? jobNewCount,
          skill_progress_pct: stateRow?.skill_progress_pct ?? 0,
          focus_minutes: stateRow?.focus_minutes ?? 0,
          top_alerts: topAlerts,
          updated_at: stateRow?.updated_at ?? null,
        },
      });
    } catch (err) {
      return d1ErrorResponse("GET /api/home/state", err);
    }
  });
}
