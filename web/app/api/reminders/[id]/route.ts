export const runtime = "edge";
// web/app/api/reminders/[id]/route.ts — PATCH (mark done/dismiss) + DELETE

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id } = await params;

    try {
      const body = await req.json() as { status: string };
      if (!body.status || !["done", "dismissed", "open"].includes(body.status)) {
        return Response.json({ ok: false, error: "status must be done, dismissed, or open" }, { status: 400 });
      }

      await db
        .prepare(`UPDATE reminders SET status = ? WHERE id = ? AND user_id = ?`)
        .bind(body.status, id, session.user_id)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/reminders/[id]", err);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id } = await params;

    try {
      await db
        .prepare(`DELETE FROM reminders WHERE id = ? AND user_id = ?`)
        .bind(id, session.user_id)
        .run();
      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("DELETE /api/reminders/[id]", err);
    }
  });
}
