export const runtime = "edge";
// web/app/api/notifications/route.ts — Notification center (list + auto-creation helper)

import { withReadAuth } from "@/lib/readAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

/**
 * GET /api/notifications?filter=all|unread&category=all|school|jobs|...&limit=50&offset=0
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ notifications: [] });

    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const category = url.searchParams.get("category") || "all";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      let query = `SELECT * FROM notifications WHERE user_id = ?`;
      const params: unknown[] = [userId];

      if (filter === "unread") { query += ` AND read_at IS NULL`; }
      if (category !== "all") { query += ` AND category = ?`; params.push(category); }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ notifications: r.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/notifications", err);
    }
  });
}
