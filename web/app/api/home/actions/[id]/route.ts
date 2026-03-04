export const runtime = "edge";
// web/app/api/home/actions/[id]/route.ts — Accept/dismiss/done an action

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_STATUSES = ["accepted", "dismissed", "done"];

export async function PATCH(req: Request, ctx: RouteContext) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db)
      return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const { id } = await ctx.params;
      const body = (await req.json()) as { status?: string };

      if (!body.status || !VALID_STATUSES.includes(body.status)) {
        return Response.json(
          { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 },
        );
      }

      const now = new Date().toISOString();
      await db
        .prepare(
          `UPDATE home_actions SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(body.status, now, id, session.user_id)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/home/actions/:id", err);
    }
  });
}
