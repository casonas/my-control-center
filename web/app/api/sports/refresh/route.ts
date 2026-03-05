export const runtime = "edge";
import { withMutatingOrInternalAuth } from "@/lib/mutatingAuth";
import { withReadAuth } from "@/lib/readAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { apiError, apiJson } from "@/lib/apiJson";
import { runSportsRefresh } from "@/lib/sports/pipeline";
import type { League } from "@/lib/sports/types";

const COOLDOWN_MS = 30 * 60 * 1000;
const VALID_LEAGUES = new Set(["nba", "nfl", "mlb", "nhl"]);

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    try {
      const url = new URL(req.url);
      const league = (url.searchParams.get("league") || "nba") as League;
      if (!VALID_LEAGUES.has(league)) return apiError("Invalid league", 400);

      const [games, gamesGlobal, odds, news, predictions, lastRun] = await Promise.all([
        db.prepare(`SELECT COUNT(*) AS cnt FROM sports_games WHERE user_id = ? AND league = ?`).bind(userId, league).first<{ cnt: number }>(),
        db.prepare(`SELECT COUNT(*) AS cnt FROM sports_games WHERE league = ?`).bind(league).first<{ cnt: number }>(),
        db.prepare(`SELECT COUNT(*) AS cnt FROM sports_odds_market WHERE user_id = ? AND game_id LIKE ?`).bind(userId, `espn_${league}_%`).first<{ cnt: number }>(),
        db.prepare(`SELECT COUNT(*) AS cnt FROM sports_news_items WHERE user_id = ? AND league = ?`).bind(userId, league).first<{ cnt: number }>(),
        db.prepare(`SELECT COUNT(*) AS cnt FROM sports_model_predictions p JOIN sports_games g ON p.game_id = g.id WHERE p.user_id = ? AND g.league = ?`).bind(userId, league).first<{ cnt: number }>(),
        db.prepare(`SELECT last_run_at, status, error FROM cron_runs WHERE job_name = ? ORDER BY last_run_at DESC LIMIT 1`).bind(`sports_refresh_${league}_${userId}`).first<{ last_run_at: string; status: string; error: string | null }>(),
      ]);

      return apiJson({
        ok: true,
        league,
        cached: true,
        games: games?.cnt ?? 0,
        games_global: gamesGlobal?.cnt ?? 0,
        odds: odds?.cnt ?? 0,
        news: news?.cnt ?? 0,
        predictions: predictions?.cnt ?? 0,
        last_run_at: lastRun?.last_run_at ?? null,
        status: lastRun?.status ?? "unknown",
        error: lastRun?.error ?? null,
      });
    } catch (err) {
      return d1ErrorResponse("GET /api/sports/refresh", err);
    }
  });
}

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
        if (elapsed < COOLDOWN_MS) {
          const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
          const counts = await Promise.all([
            db.prepare(`SELECT COUNT(*) AS cnt FROM sports_games WHERE user_id = ? AND league = ?`).bind(userId, league).first<{ cnt: number }>(),
            db.prepare(`SELECT COUNT(*) AS cnt FROM sports_games WHERE league = ?`).bind(league).first<{ cnt: number }>(),
            db.prepare(`SELECT COUNT(*) AS cnt FROM sports_odds_market WHERE user_id = ? AND game_id LIKE ?`).bind(userId, `espn_${league}_%`).first<{ cnt: number }>(),
            db.prepare(`SELECT COUNT(*) AS cnt FROM sports_news_items WHERE user_id = ? AND league = ?`).bind(userId, league).first<{ cnt: number }>(),
            db.prepare(
              `SELECT COUNT(*) AS cnt
               FROM sports_model_predictions p
               JOIN sports_games g ON p.game_id = g.id
               WHERE p.user_id = ? AND g.league = ?`
            ).bind(userId, league).first<{ cnt: number }>(),
          ]);
          return apiJson({
            ok: true,
            cached: true,
            cooldown: true,
            waitSec,
            status: "ok",
            league,
            games: Math.max(counts[0]?.cnt ?? 0, counts[1]?.cnt ?? 0),
            odds: counts[2]?.cnt ?? 0,
            news: counts[3]?.cnt ?? 0,
            predictions: counts[4]?.cnt ?? 0,
            message: `Using cached data. Next refresh in ${waitSec}s.`,
          });
        }
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
