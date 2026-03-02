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

      const odds = await db.prepare(`SELECT * FROM sports_odds_market WHERE game_id = ? AND user_id = ? ORDER BY asof DESC LIMIT 1`).bind(gameId, userId).first();
      const prediction = await db.prepare(`SELECT * FROM sports_model_predictions WHERE game_id = ? AND user_id = ? ORDER BY generated_at DESC LIMIT 1`).bind(gameId, userId).first();

      return Response.json({ game, odds, prediction });
    } catch { return Response.json({ game: null }); }
  });
}
