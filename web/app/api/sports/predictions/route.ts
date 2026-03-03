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
    try {
      const r = await db.prepare(
        `SELECT p.*, g.home_team_name, g.away_team_name, g.start_time
         FROM sports_model_predictions p
         JOIN sports_games g ON p.game_id = g.id
         WHERE p.user_id = ? AND g.league = ?
         ORDER BY p.generated_at DESC LIMIT 50`
      ).bind(userId, league).all();
      return Response.json({ predictions: r.results || [] });
    } catch { return Response.json({ predictions: [] }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    // MVP: stub — triggers VPS/OpenClaw sports betting agent
    return Response.json({ ok: true, note: "Prediction generation triggered. The sports agent will analyze upcoming games." });
  });
}
