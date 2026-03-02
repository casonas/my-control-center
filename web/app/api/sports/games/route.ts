export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ games: [] });
    const url = new URL(req.url);
    const league = url.searchParams.get("league") || "nba";
    const filter = url.searchParams.get("filter") || "all";
    try {
      let query: string;
      const params: unknown[] = [userId, league];
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
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ games: r.results || [] });
    } catch { return Response.json({ games: [] }); }
  });
}
