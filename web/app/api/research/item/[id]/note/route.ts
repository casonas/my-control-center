export const runtime = "edge";
// web/app/api/research/item/[id]/note/route.ts — Add/update notes on an item

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteContext) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const { id } = await ctx.params;
      const body = await req.json() as { notes_md?: string };

      await db
        .prepare(`UPDATE research_items SET notes_md = ? WHERE id = ? AND user_id = ?`)
        .bind(body.notes_md || null, id, session.user_id)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/research/item/:id/note", err);
    }
  });
}
