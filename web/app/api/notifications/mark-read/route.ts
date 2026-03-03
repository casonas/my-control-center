export const runtime = "edge";
// web/app/api/notifications/mark-read/route.ts — Mark notifications as read

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { ids: string[] };
      if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
        return Response.json({ ok: false, error: "ids array required" }, { status: 400 });
      }

      const now = new Date().toISOString();
      // Batch update — limit to 50 at a time
      const ids = body.ids.slice(0, 50);
      const placeholders = ids.map(() => "?").join(",");
      await db
        .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${placeholders})`)
        .bind(now, session.user_id, ...ids)
        .run();

      return Response.json({ ok: true, updated: ids.length });
    } catch (err) {
      return d1ErrorResponse("POST /api/notifications/mark-read", err);
    }
  });
}
