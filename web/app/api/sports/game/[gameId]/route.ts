export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";
import { normalizeGameRow, normalizeNewsRow, normalizeOddsRow, normalizePredictionRow } from "@/lib/sports/serialize";

type Ctx = { params: Promise<{ gameId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ game: null });
    try {
      const { gameId } = await ctx.params;
      const game = await db.prepare(`SELECT * FROM sports_games WHERE id = ? AND user_id = ?`).bind(gameId, userId).first<Record<string, unknown>>();
      if (!game) return Response.json({ error: "Game not found" }, { status: 404 });

      const oddsResult = await db.prepare(`SELECT * FROM sports_odds_market WHERE game_id = ? AND user_id = ? ORDER BY asof DESC LIMIT 10`).bind(gameId, userId).all<Record<string, unknown>>();
      const prediction = await db.prepare(`SELECT * FROM sports_model_predictions WHERE game_id = ? AND user_id = ? ORDER BY generated_at DESC LIMIT 1`).bind(gameId, userId).first<Record<string, unknown>>();

      // Get team-related news
      const homeTeamId = String(game.home_team_id || "");
      const awayTeamId = String(game.away_team_id || "");
      const newsResult = await db.prepare(
        `SELECT * FROM sports_news_items WHERE user_id = ? AND (team_id = ? OR team_id = ?) ORDER BY published_at DESC LIMIT 10`
      ).bind(userId, homeTeamId, awayTeamId).all<Record<string, unknown>>();

      return Response.json({
        game: normalizeGameRow(game),
        odds: (oddsResult.results || []).map(normalizeOddsRow),
        prediction: prediction ? normalizePredictionRow(prediction) : null,
        news: (newsResult.results || []).map(normalizeNewsRow),
      });
    } catch { return Response.json({ game: null }); }
  });
}
