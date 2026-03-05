export const runtime = "edge";
import { withMutatingOrInternalAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { apiError, apiJson } from "@/lib/apiJson";
import { runSportsRefresh } from "@/lib/sports/pipeline";
import type { League } from "@/lib/sports/types";

const COOLDOWN_MS = 30 * 60 * 1000;
const VALID_LEAGUES = new Set(["nba", "nfl", "mlb", "nhl"]);

export async function POST(req: Request) {
  return withMutatingOrInternalAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return apiError("D1 not available", 500);
    const userId = session.user_id;
    const start = Date.now();

    try {
      let body: { league?: string } = {};
      try {
        body = await req.json() as { league?: string };
      } catch {
        body = {};
      }
      const league = (body.league || "nba") as League;
      if (!VALID_LEAGUES.has(league)) {
        return apiError("Invalid league", 400);
      }

      // Throttle
      const jobKey = `sports_refresh_${league}_${userId}`;
      const lastRun = await db.prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`).bind(jobKey).first<{ last_run_at: string }>();
      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < COOLDOWN_MS) return apiError(`Wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s`, 429);
      }

      const now = new Date().toISOString();

      // Run full pipeline: scores → odds → news → analyst
      const result = await runSportsRefresh(db, userId, league);

      // Log to cron_runs
      await db.prepare(
        `INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, ?, ?, ?)`
      ).bind(jobKey, now, result.status, result.games + result.odds + result.news + result.predictions, result.errors.join("; ") || null).run();

      return apiJson({
        ok: true,
        status: result.status,
        league,
        tookMs: Date.now() - start,
        games: result.games, odds: result.odds, news: result.news, predictions: result.predictions,
        staleFallbackUsed: result.staleFallbackUsed,
        errors: result.errors.length > 0 ? result.errors : undefined,
        sourceHealth: result.sourceHealth,
      });
    } catch (err) { return d1ErrorResponse("POST /api/sports/refresh", err); }
  });
}
