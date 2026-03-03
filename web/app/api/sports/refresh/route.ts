export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const COOLDOWN_MS = 60 * 1000;

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const userId = session.user_id;
    const start = Date.now();

    try {
      const body = await req.json() as { league?: string };
      const league = body.league || "nba";

      // Throttle
      const jobKey = `sports_refresh_${league}_${userId}`;
      const lastRun = await db.prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`).bind(jobKey).first<{ last_run_at: string }>();
      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < COOLDOWN_MS) return Response.json({ ok: false, error: `Wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s` }, { status: 429 });
      }

      const now = new Date().toISOString();

      // MVP: Sports data provider placeholder
      // In production, replace with actual sports API provider call
      // For now, update cron_runs to track refresh attempts
      await db.prepare(
        `INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', 0, NULL)`
      ).bind(jobKey, now).run();

      return Response.json({ ok: true, league, games: 0, tookMs: Date.now() - start, source: "pending" });
    } catch (err) { return d1ErrorResponse("POST /api/sports/refresh", err); }
  });
}
