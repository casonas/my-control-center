export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ odds: [] });
    const url = new URL(req.url);
    const league = url.searchParams.get("league") || "nba";
    try {
      const r = await db.prepare(
        `SELECT o.*, g.home_team_name, g.away_team_name, g.start_time
         FROM sports_odds_market o
         JOIN sports_games g ON o.game_id = g.id
         WHERE o.user_id = ? AND g.league = ?
         ORDER BY o.asof DESC LIMIT 50`
      ).bind(userId, league).all();
      return Response.json({ odds: r.results || [] });
    } catch { return Response.json({ odds: [] }); }
  });
}
