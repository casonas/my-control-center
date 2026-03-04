export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

interface Movement {
  game_id: string;
  home_team: string;
  away_team: string;
  book: string;
  market: string;
  old_line: number;
  new_line: number;
  delta: number;
  direction: "steam" | "reverse" | "neutral";
  minutes_ago: number;
}

export async function GET(_req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ movements: [] });

    try {
      const r = await db.prepare(
        `SELECT
          m.game_id, g.home_team_name as home_team, g.away_team_name as away_team,
          m.book, 'spread' as market,
          h.line as old_line, m.spread_home as new_line,
          ROUND((m.spread_home - h.line), 1) as delta,
          h.recorded_at as old_time, m.asof as new_time
        FROM sports_odds_market m
        JOIN sports_games g ON m.game_id = g.id AND g.user_id = m.user_id
        JOIN sports_odds_history h ON m.game_id = h.game_id
          AND m.book = h.book AND h.market = 'spread'
          AND h.user_id = m.user_id
        WHERE m.user_id = ? AND g.league = 'nba'
          AND h.recorded_at = (
            SELECT MAX(recorded_at) FROM sports_odds_history
            WHERE game_id = m.game_id AND book = m.book AND market = 'spread'
              AND user_id = m.user_id
              AND recorded_at < datetime(m.asof, '-5 minutes')
          )
          AND ABS(m.spread_home - h.line) >= 0.5
        ORDER BY ABS(m.spread_home - h.line) DESC, m.asof DESC
        LIMIT 20`
      ).bind(userId).all();

      const movements: Movement[] = (r.results || []).map((row: Record<string, unknown>) => {
        const delta = Number(row.delta || 0);
        const oldLine = Number(row.old_line || 0);
        const newLine = Number(row.new_line || 0);

        // Determine direction
        let direction: "steam" | "reverse" | "neutral" = "neutral";
        if (Math.abs(delta) >= 1.0) direction = "steam";
        else if (Math.abs(delta) >= 0.5) direction = "reverse";

        // Calculate minutes_ago
        const newTime = row.new_time ? new Date(String(row.new_time)).getTime() : Date.now();
        const minutesAgo = Math.round((Date.now() - newTime) / 60000);

        return {
          game_id: String(row.game_id || ""),
          home_team: String(row.home_team || ""),
          away_team: String(row.away_team || ""),
          book: String(row.book || ""),
          market: "spread",
          old_line: oldLine,
          new_line: newLine,
          delta,
          direction,
          minutes_ago: minutesAgo,
        };
      });

      return Response.json({ movements });
    } catch (err) {
      console.error("[sports/nba/movement]", err);
      return Response.json({ movements: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
