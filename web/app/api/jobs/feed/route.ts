export const runtime = "edge";
// web/app/api/jobs/feed/route.ts — List job items

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ items: [] });

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "all";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      let query: string;
      const params: unknown[] = [userId];

      if (status !== "all") {
        query = `SELECT * FROM job_items WHERE user_id = ? AND status = ? ORDER BY match_score DESC, fetched_at DESC LIMIT ? OFFSET ?`;
        params.push(status, limit, offset);
      } else {
        query = `SELECT * FROM job_items WHERE user_id = ? ORDER BY match_score DESC, fetched_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }

      const result = await db.prepare(query).bind(...params).all();

      // Also get last refresh time
      let lastRefresh: string | null = null;
      try {
        const cronRow = await db.prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`).bind(`jobs_refresh_${userId}`).first<{ last_run_at: string }>();
        lastRefresh = cronRow?.last_run_at || null;
      } catch { /* non-fatal */ }

      return Response.json({ items: result.results || [], lastRefresh });
    } catch (err) {
      console.error("[jobs/feed]", err);
      return Response.json({ items: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
