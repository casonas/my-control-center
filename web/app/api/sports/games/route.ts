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
      if (filter === "watchlist") {
        query = `SELECT g.* FROM sports_games g
          JOIN sports_watchlist_teams w ON w.user_id = ? AND w.league = g.league
            AND (w.team_id = g.home_team_id OR w.team_id = g.away_team_id)
          WHERE g.league = ?
          ORDER BY g.start_time DESC LIMIT 50`;
      } else if (filter === "live") {
        query = `SELECT * FROM sports_games WHERE league = ? AND status = 'live' ORDER BY start_time DESC LIMIT 50`;
      } else if (filter === "final") {
        query = `SELECT * FROM sports_games WHERE league = ? AND status = 'final' ORDER BY start_time DESC LIMIT 50`;
      } else {
        // "all": prioritize live/scheduled, then recent finals so the board is never blank.
        query = `SELECT * FROM sports_games
                 WHERE league = ?
                 ORDER BY
                   CASE
                     WHEN status = 'live' THEN 0
                     WHEN status = 'scheduled' THEN 1
                     WHEN status = 'final' THEN 2
                     ELSE 3
                   END ASC,
                   CASE
                     WHEN status IN ('live', 'scheduled')
                       THEN ABS(strftime('%s', start_time) - strftime('%s', 'now'))
                     ELSE NULL
                   END ASC,
                   CASE
                     WHEN status = 'final'
                       THEN strftime('%s', start_time)
                     ELSE NULL
                   END DESC,
                   start_time DESC
                 LIMIT 50`;
      }
      const binds: unknown[] = filter === "watchlist" ? [userId, league] : [league];
      const r = await db.prepare(query).bind(...binds).all<Record<string, unknown>>();

      const games = (r.results || []).map((row) => ({
        id: String(row.id || ""),
        league: String(row.league || league).toLowerCase(),
        home_team_id: String(row.home_team_id || ""),
        home_team_name: String(row.home_team_name || ""),
        away_team_id: String(row.away_team_id || ""),
        away_team_name: String(row.away_team_name || ""),
        home_score: row.home_score != null ? Number(row.home_score) : null,
        away_score: row.away_score != null ? Number(row.away_score) : null,
        status: String(row.status || "scheduled").toLowerCase(),
        period: row.period != null ? String(row.period) : null,
        clock: row.clock != null ? String(row.clock) : null,
        start_time: String(row.start_time || ""),
      }));
      return Response.json({ games });
    } catch { return Response.json({ games: [] }); }
  });
}
