export const runtime = "edge";
// web/app/api/research/item/[id]/archive/route.ts — Archive/unarchive item

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteContext) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const { id } = await ctx.params;
      const body = await req.json() as { isArchived?: boolean };
      const isArchived = body.isArchived !== false ? 1 : 0;

      await db
        .prepare(
          `INSERT INTO research_item_state (user_id, item_id, is_archived)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, item_id) DO UPDATE SET is_archived = ?`
        )
        .bind(session.user_id, id, isArchived, isArchived)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/research/item/:id/archive", err);
    }
  });
}
