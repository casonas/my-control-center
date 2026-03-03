export const runtime = "edge";
// web/app/api/notifications/clear/route.ts — Clear (mark read) notifications

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { before?: string; category?: string };
      const now = new Date().toISOString();

      let query = `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`;
      const params: unknown[] = [now, session.user_id];

      if (body.before) { query += ` AND created_at <= ?`; params.push(body.before); }
      if (body.category) { query += ` AND category = ?`; params.push(body.category); }

      await db.prepare(query).bind(...params).run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("POST /api/notifications/clear", err);
    }
  });
}
