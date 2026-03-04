export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

type Ctx = { params: Promise<{ gameId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ game: null });
    try {
      const { gameId } = await ctx.params;
      const game = await db.prepare(`SELECT * FROM sports_games WHERE id = ? AND user_id = ?`).bind(gameId, userId).first();
      if (!game) return Response.json({ error: "Game not found" }, { status: 404 });

      const oddsResult = await db.prepare(`SELECT * FROM sports_odds_market WHERE game_id = ? AND user_id = ? ORDER BY asof DESC LIMIT 10`).bind(gameId, userId).all();
      const prediction = await db.prepare(`SELECT * FROM sports_model_predictions WHERE game_id = ? AND user_id = ? ORDER BY generated_at DESC LIMIT 1`).bind(gameId, userId).first();

      // Get team-related news
      const homeTeamId = (game as Record<string, unknown>).home_team_id as string;
      const awayTeamId = (game as Record<string, unknown>).away_team_id as string;
      const newsResult = await db.prepare(
        `SELECT * FROM sports_news_items WHERE user_id = ? AND (team_id = ? OR team_id = ?) ORDER BY published_at DESC LIMIT 10`
      ).bind(userId, homeTeamId, awayTeamId).all();

      return Response.json({ game, odds: oddsResult.results || [], prediction, news: newsResult.results || [] });
    } catch { return Response.json({ game: null }); }
  });
}
