export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";
import { normalizeGameRow } from "@/lib/sports/serialize";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ games: [] });
    const url = new URL(req.url);
    const league = url.searchParams.get("league") || "nba";
    const filter = url.searchParams.get("filter") || "all";
    try {
      let query: string;
      const buildParams = (uid: string): unknown[] => [uid, league];
      if (filter === "watchlist") {
        query = `SELECT g.* FROM sports_games g
          JOIN sports_watchlist_teams w ON w.user_id = g.user_id AND w.league = g.league
            AND (w.team_id = g.home_team_id OR w.team_id = g.away_team_id)
          WHERE g.user_id = ? AND g.league = ?
          ORDER BY g.start_time DESC LIMIT 50`;
      } else if (filter === "live") {
        query = `SELECT * FROM sports_games WHERE user_id = ? AND league = ? AND status = 'live' ORDER BY start_time DESC LIMIT 50`;
      } else if (filter === "final") {
        query = `SELECT * FROM sports_games WHERE user_id = ? AND league = ? AND status = 'final' ORDER BY start_time DESC LIMIT 50`;
      } else {
        query = `SELECT * FROM sports_games WHERE user_id = ? AND league = ? ORDER BY start_time DESC LIMIT 50`;
      }
      let r = await db.prepare(query).bind(...buildParams(userId)).all<Record<string, unknown>>();

      // Single-user safety fallback: if session user has no rows, read owner feed.
      if ((r.results || []).length === 0 && userId !== "owner") {
        r = await db.prepare(query).bind(...buildParams("owner")).all<Record<string, unknown>>();
      }

      const games = (r.results || []).map(normalizeGameRow);
      return Response.json({ games });
    } catch { return Response.json({ games: [] }); }
  });
}
