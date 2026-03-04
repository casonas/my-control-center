export const runtime = "edge";
// web/app/api/research/feed/route.ts — Get research items (v2)

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

/**
 * GET /api/research/feed?filter=all|unread|saved|high|archived&category=&entity=&q=&limit=50&offset=0
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) {
      return Response.json({ items: [], note: "D1 not available" });
    }

    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const category = url.searchParams.get("category") || "";
    const entityId = url.searchParams.get("entity") || "";
    const q = url.searchParams.get("q") || "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      const conditions: string[] = ["ri.user_id = ?"];
      const params: unknown[] = [userId];

      // Filter conditions
      if (filter === "unread") {
        conditions.push("COALESCE(ris.is_read, 0) = 0");
      } else if (filter === "saved") {
        conditions.push("COALESCE(ris.is_saved, 0) = 1");
      } else if (filter === "high") {
        conditions.push("ri.score >= 50");
      } else if (filter === "archived") {
        conditions.push("COALESCE(ris.is_archived, 0) = 1");
      }

      // Exclude archived from non-archived views
      if (filter !== "archived") {
        conditions.push("COALESCE(ris.is_archived, 0) = 0");
      }

      // Category filter (match tags_json)
      if (category) {
        conditions.push("ri.tags_json LIKE ?");
        params.push(`%${category}%`);
      }

      // Text search
      if (q) {
        conditions.push("(ri.title LIKE ? OR ri.summary LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }

      // Entity filter
      let entityJoin = "";
      if (entityId) {
        entityJoin = "INNER JOIN research_item_entities rie ON rie.item_id = ri.id AND rie.entity_id = ?";
        params.push(entityId);
      }

      const orderBy = filter === "high" ? "ri.score DESC" : "ri.fetched_at DESC";

      const query = `SELECT ri.*, rs.name AS source_name,
                   COALESCE(ris.is_read, 0) AS is_read,
                   COALESCE(ris.is_saved, 0) AS is_saved,
                   COALESCE(ris.is_archived, 0) AS is_archived
                 FROM research_items ri
                 LEFT JOIN research_sources rs ON ri.source_id = rs.id
                 LEFT JOIN research_item_state ris ON ris.user_id = ri.user_id AND ris.item_id = ri.id
                 ${entityJoin}
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

      params.push(limit, offset);

      const result = await db.prepare(query).bind(...params).all();
      return Response.json({ items: result.results || [] });
    } catch (err) {
      console.error("[research/feed]", err);
      return Response.json({ items: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
