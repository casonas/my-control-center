export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      const body = await req.json() as { status?: string; prediction_text?: string; confidence?: number; rationale_md?: string };

      // Only allow editing open predictions
      const existing = await db.prepare(`SELECT status FROM stock_predictions WHERE id = ? AND user_id = ?`).bind(id, session.user_id).first<{ status: string }>();
      if (!existing) return Response.json({ error: "Prediction not found" }, { status: 404 });
      if (existing.status !== "open") return Response.json({ error: "Can only edit open predictions" }, { status: 400 });

      const updates: string[] = [];
      const values: (string | number)[] = [];

      if (body.status === "canceled") { updates.push("status = ?"); values.push("canceled"); }
      if (body.prediction_text) { updates.push("prediction_text = ?"); values.push(body.prediction_text); }
      if (body.confidence !== undefined) { updates.push("confidence = ?"); values.push(Math.max(0, Math.min(100, body.confidence))); }
      if (body.rationale_md !== undefined) { updates.push("rationale_md = ?"); values.push(body.rationale_md); }

      if (updates.length === 0) return Response.json({ error: "No valid fields to update" }, { status: 400 });

      values.push(id, session.user_id);
      await db.prepare(`UPDATE stock_predictions SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`).bind(...values).run();

      const updated = await db.prepare(`SELECT * FROM stock_predictions WHERE id = ?`).bind(id).first();
      return Response.json({ ok: true, prediction: updated });
    } catch (err) { return d1ErrorResponse("PATCH /api/stocks/predictions/:id", err); }
  });
}
