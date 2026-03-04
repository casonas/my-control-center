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
           WHERE user_id = ? AND league = ? AND status = 'active'
           ORDER BY fetched_at DESC LIMIT 1`
        )
        .bind(userId, league)
        .first<{ board_hash: string }>();

      return Response.json({
        props,
        board_hash: hashRow?.board_hash ?? null,
        total: props.length,
      });
    } catch {
      return Response.json({ props: [], board_hash: null });
    }
  });
}
