export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ predictions: [] });
    const url = new URL(req.url);
    const league = url.searchParams.get("league") || "nba";
    const minEdge = parseFloat(url.searchParams.get("minEdge") || "0");
    try {
      const r = await db.prepare(
        `SELECT p.*, g.home_team_name, g.away_team_name, g.start_time, g.status as game_status
         FROM sports_model_predictions p
         JOIN sports_games g ON p.game_id = g.id
         WHERE p.user_id = ? AND g.league = ?
         ORDER BY p.generated_at DESC LIMIT 50`
      ).bind(userId, league).all();

      let predictions = r.results || [];
      if (minEdge > 0) {
        predictions = predictions.filter((p: Record<string, unknown>) => {
          const es = Math.abs(Number(p.edge_spread) || 0);
          const et = Math.abs(Number(p.edge_total) || 0);
          return es >= minEdge || et >= minEdge;
        });
      }

      return Response.json({ predictions });
    } catch { return Response.json({ predictions: [] }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    return Response.json({ ok: true, note: "Predictions are generated automatically during refresh. Use POST /api/sports/refresh to trigger." });
  });
}
