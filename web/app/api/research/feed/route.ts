export const runtime = "edge";
// web/app/api/research/feed/route.ts — Get research items

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

/**
 * GET /api/research/feed?filter=all|unread|saved&limit=50&offset=0
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) {
      return Response.json({ items: [], note: "D1 not available" });
    }

    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      let query: string;
      const params: unknown[] = [userId];

      if (filter === "unread") {
        query = `SELECT ri.*, rs.name AS source_name,
                   COALESCE(ris.is_read, 0) AS is_read,
                   COALESCE(ris.is_saved, 0) AS is_saved
                 FROM research_items ri
                 LEFT JOIN research_sources rs ON ri.source_id = rs.id
                 LEFT JOIN research_item_state ris ON ris.user_id = ri.user_id AND ris.item_id = ri.id
                 WHERE ri.user_id = ? AND COALESCE(ris.is_read, 0) = 0
                 ORDER BY ri.fetched_at DESC LIMIT ? OFFSET ?`;
      } else if (filter === "saved") {
        query = `SELECT ri.*, rs.name AS source_name,
                   COALESCE(ris.is_read, 0) AS is_read,
                   COALESCE(ris.is_saved, 0) AS is_saved
                 FROM research_items ri
                 LEFT JOIN research_sources rs ON ri.source_id = rs.id
                 LEFT JOIN research_item_state ris ON ris.user_id = ri.user_id AND ris.item_id = ri.id
                 WHERE ri.user_id = ? AND COALESCE(ris.is_saved, 0) = 1
                 ORDER BY ri.fetched_at DESC LIMIT ? OFFSET ?`;
      } else {
        query = `SELECT ri.*, rs.name AS source_name,
                   COALESCE(ris.is_read, 0) AS is_read,
                   COALESCE(ris.is_saved, 0) AS is_saved
                 FROM research_items ri
                 LEFT JOIN research_sources rs ON ri.source_id = rs.id
                 LEFT JOIN research_item_state ris ON ris.user_id = ri.user_id AND ris.item_id = ri.id
                 WHERE ri.user_id = ?
                 ORDER BY ri.fetched_at DESC LIMIT ? OFFSET ?`;
      }

      params.push(limit, offset);

      const result = await db.prepare(query).bind(...params).all();
      return Response.json({ items: result.results || [] });
    } catch (err) {
      console.error("[research/feed]", err);
      return Response.json({ items: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
