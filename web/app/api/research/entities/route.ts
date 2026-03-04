export const runtime = "edge";
// web/app/api/research/entities/route.ts — List/search research entities

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

/**
 * GET /api/research/entities?watch=1&type=&q=
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ entities: [] });

    const url = new URL(req.url);
    const watch = url.searchParams.get("watch");
    const type = url.searchParams.get("type") || "";
    const q = url.searchParams.get("q") || "";

    try {
      const conditions: string[] = ["user_id = ?"];
      const params: unknown[] = [userId];

      if (watch === "1") {
        conditions.push("watch = 1");
      }
      if (type) {
        conditions.push("type = ?");
        params.push(type);
      }
      if (q) {
        conditions.push("name LIKE ?");
        params.push(`%${q}%`);
      }

      const result = await db
        .prepare(`SELECT * FROM research_entities WHERE ${conditions.join(" AND ")} ORDER BY name LIMIT 100`)
        .bind(...params)
        .all();

      return Response.json({ entities: result.results || [] });
    } catch (err) {
      console.error("[research/entities]", err);
      return Response.json({ entities: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
