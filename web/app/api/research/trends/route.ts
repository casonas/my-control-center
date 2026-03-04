export const runtime = "edge";
// web/app/api/research/trends/route.ts — Get trending topics

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

/**
 * GET /api/research/trends?window=24h|7d|30d
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ trends: [] });

    const url = new URL(req.url);
    const window = url.searchParams.get("window") || "24h";

    try {
      const result = await db
        .prepare(
          `SELECT * FROM research_trends
           WHERE user_id = ? AND window = ?
           ORDER BY momentum_score DESC
           LIMIT 20`
        )
        .bind(userId, window)
        .all();

      return Response.json({ trends: result.results || [] });
    } catch (err) {
      console.error("[research/trends]", err);
      return Response.json({ trends: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
