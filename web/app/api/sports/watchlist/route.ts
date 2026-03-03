export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ teams: [] });
    const url = new URL(req.url);
    const league = url.searchParams.get("league");
    try {
      let r;
      if (league) {
        r = await db.prepare(`SELECT * FROM sports_watchlist_teams WHERE user_id = ? AND league = ? ORDER BY team_name`).bind(userId, league).all();
      } else {
        r = await db.prepare(`SELECT * FROM sports_watchlist_teams WHERE user_id = ? ORDER BY league, team_name`).bind(userId).all();
      }
      return Response.json({ teams: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/sports/watchlist", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { league?: string; teamId?: string; teamName?: string };
      if (!body.league || !body.teamId || !body.teamName) {
        return Response.json({ error: "league, teamId, teamName required" }, { status: 400 });
      }
      await db.prepare(
        `INSERT OR IGNORE INTO sports_watchlist_teams (user_id, league, team_id, team_name, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(session.user_id, body.league, body.teamId, body.teamName, new Date().toISOString()).run();
      return Response.json({ ok: true }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/sports/watchlist", err); }
  });
}
