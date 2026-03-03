export const runtime = "edge";
// web/app/api/day/route.ts — GET /api/day/overview?date=YYYY-MM-DD

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

// Safe query helper — returns empty array if table doesn't exist
async function safeQuery(db: ReturnType<typeof getD1>, query: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  if (!db) return [];
  try {
    const r = await db.prepare(query).bind(...params).all();
    return (r.results || []) as Record<string, unknown>[];
  } catch { return []; }
}

async function safeCount(db: ReturnType<typeof getD1>, query: string, params: unknown[]): Promise<number> {
  if (!db) return 0;
  try {
    const r = await db.prepare(query).bind(...params).first<{ c: number }>();
    return r?.c ?? 0;
  } catch { return 0; }
}

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    const url = new URL(req.url);
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

    // Date range for "today" and "soon" (next 3 days)
    const todayStart = `${date}T00:00:00.000Z`;
    const todayEnd = `${date}T23:59:59.999Z`;
    const soonEnd = new Date(new Date(date).getTime() + 3 * 86400000).toISOString().slice(0, 10) + "T23:59:59.999Z";

    // School: assignments due today + soon
    const dueToday = await safeQuery(db,
      `SELECT id, title, due_at, status, priority FROM school_assignments
       WHERE user_id = ? AND due_at >= ? AND due_at <= ? ORDER BY due_at ASC LIMIT 10`,
      [userId, todayStart, todayEnd]);

    const dueSoon = await safeQuery(db,
      `SELECT id, title, due_at, status, priority FROM school_assignments
       WHERE user_id = ? AND due_at > ? AND due_at <= ? AND status != 'done' ORDER BY due_at ASC LIMIT 10`,
      [userId, todayEnd, soonEnd]);

    // Jobs: pipeline counts + recent new
    const jobCounts = {
      new: await safeCount(db, `SELECT COUNT(*) as c FROM job_items WHERE user_id = ? AND status = 'new'`, [userId]),
      applied: await safeCount(db, `SELECT COUNT(*) as c FROM job_items WHERE user_id = ? AND status = 'applied'`, [userId]),
      saved: await safeCount(db, `SELECT COUNT(*) as c FROM job_items WHERE user_id = ? AND status = 'saved'`, [userId]),
    };
    const topNewJobs = await safeQuery(db,
      `SELECT id, title, company, url FROM job_items WHERE user_id = ? AND status = 'new' ORDER BY fetched_at DESC LIMIT 5`,
      [userId]);

    // Research: top recent + unread count
    const topSignals = await safeQuery(db,
      `SELECT ri.id, ri.title, ri.url, ri.published_at, ri.tags_json
       FROM research_items ri
       LEFT JOIN research_item_state ris ON ris.user_id = ri.user_id AND ris.item_id = ri.id
       WHERE ri.user_id = ? AND (ris.is_read IS NULL OR ris.is_read = 0)
       ORDER BY ri.fetched_at DESC LIMIT 5`,
      [userId]);
    const unreadCount = await safeCount(db,
      `SELECT COUNT(*) as c FROM research_items ri
       LEFT JOIN research_item_state ris ON ris.user_id = ri.user_id AND ris.item_id = ri.id
       WHERE ri.user_id = ? AND (ris.is_read IS NULL OR ris.is_read = 0)`,
      [userId]);

    // Stocks: watchlist count + recent news
    const watchlistCount = await safeCount(db, `SELECT COUNT(*) as c FROM stock_watchlist WHERE user_id = ?`, [userId]);
    const stockAlerts = await safeQuery(db,
      `SELECT id, title, source, url FROM stock_news_items WHERE user_id = ? ORDER BY fetched_at DESC LIMIT 3`,
      [userId]);

    // Sports: watchlist games today
    const watchlistGames = await safeQuery(db,
      `SELECT sg.id, sg.home_team, sg.away_team, sg.status, sg.home_score, sg.away_score, sg.start_time
       FROM sports_games sg
       WHERE sg.user_id = ? AND sg.start_time >= ? AND sg.start_time <= ?
       ORDER BY sg.start_time ASC LIMIT 5`,
      [userId, todayStart, todayEnd]);

    // Reminders: open, due soon
    const reminders = await safeQuery(db,
      `SELECT id, type, title, due_at, status FROM reminders
       WHERE user_id = ? AND status = 'open' AND due_at <= ?
       ORDER BY due_at ASC LIMIT 10`,
      [userId, soonEnd]);

    // Last updated: cron_runs
    const lastUpdated: Record<string, string | null> = {};
    const cronJobs = ["research_scan", "jobs_refresh", "stocks_refresh", "sports_refresh_nba", "skills_radar_scan"];
    for (const job of cronJobs) {
      const row = await safeQuery(db,
        `SELECT last_run_at FROM cron_runs WHERE job_name = ?`, [`${job}_${userId}`]);
      lastUpdated[job] = (row[0]?.last_run_at as string) ?? null;
    }

    return Response.json({
      date,
      school: { dueToday, dueSoon },
      jobs: { pipelineCounts: jobCounts, topNew: topNewJobs },
      research: { topSignals, unreadCount },
      stocks: { watchlistCount, alerts: stockAlerts },
      sports: { watchlistGamesToday: watchlistGames },
      reminders,
      lastUpdated,
    });
  });
}
