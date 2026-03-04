export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ news: [] });
    const url = new URL(req.url);
    const league = url.searchParams.get("league");
    const teamId = url.searchParams.get("teamId");
    try {
      let query: string;
      const params: unknown[] = [userId];
      if (teamId) {
        query = `SELECT * FROM sports_news_items WHERE user_id = ? AND team_id = ? ORDER BY published_at DESC, fetched_at DESC LIMIT 50`;
        params.push(teamId);
      } else if (league) {
        query = `SELECT * FROM sports_news_items WHERE user_id = ? AND league = ? ORDER BY published_at DESC, fetched_at DESC LIMIT 50`;
        params.push(league);
      } else {
        query = `SELECT * FROM sports_news_items WHERE user_id = ? ORDER BY published_at DESC, fetched_at DESC LIMIT 50`;
      }
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ news: r.results || [] });
    } catch { return Response.json({ news: [] }); }
  });
}
