export const runtime = "edge";
// web/app/api/jobs/feed/route.ts — List job items

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ items: [] });

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "all";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      let query: string;
      const params: unknown[] = [userId];

      if (status !== "all") {
        query = `SELECT * FROM job_items WHERE user_id = ? AND status = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`;
        params.push(status, limit, offset);
      } else {
        query = `SELECT * FROM job_items WHERE user_id = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }

      const result = await db.prepare(query).bind(...params).all();
      return Response.json({ items: result.results || [] });
    } catch (err) {
      console.error("[jobs/feed]", err);
      return Response.json({ items: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
