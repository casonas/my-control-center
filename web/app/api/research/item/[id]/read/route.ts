export const runtime = "edge";
// web/app/api/research/item/[id]/read/route.ts — Mark item read/unread

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteContext) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const { id } = await ctx.params;
      const body = await req.json() as { isRead?: boolean };
      const isRead = body.isRead !== false ? 1 : 0;
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT INTO research_item_state (user_id, item_id, is_read, read_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, item_id) DO UPDATE SET is_read = ?, read_at = ?`
        )
        .bind(session.user_id, id, isRead, isRead ? now : null, isRead, isRead ? now : null)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("POST /api/research/item/:id/read", err);
    }
  });
}
