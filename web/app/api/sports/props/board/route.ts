export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ props: [], board_hash: null });

    const url = new URL(req.url);
    const league = url.searchParams.get("league") || "nba";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 200);

    try {
      const r = await db
        .prepare(
          `SELECT * FROM sports_props_board
           WHERE user_id = ? AND league = ?
           ORDER BY edge_score DESC, fetched_at DESC
           LIMIT ?`
        )
        .bind(userId, league, limit)
        .all();

      const props = r.results || [];

      // Latest board_hash from most recent active row
      const hashRow = await db
        .prepare(
          `SELECT board_hash FROM sports_props_board
           WHERE user_id = ? AND league = ?
           ORDER BY fetched_at DESC LIMIT 1`
        )
        .bind(userId, league)
        .first<{ board_hash: string }>();

      const counts = await db
        .prepare(
           `SELECT
              COUNT(*) AS raw_count,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) AS pass_count
            FROM sports_props_board
            WHERE user_id = ? AND league = ?`
         )
         .bind(userId, league)
         .first<{ raw_count: number; active_count: number; pass_count: number }>();

      return Response.json({
        props,
        board_hash: hashRow?.board_hash ?? null,
        total: props.length,
        counts: counts ?? { raw_count: 0, active_count: 0, pass_count: 0 },
      });
    } catch {
      return Response.json({ props: [], board_hash: null });
    }
  });
}
