export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ ticker: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { ticker } = await ctx.params;
      await db.prepare(`DELETE FROM stock_watchlist WHERE user_id = ? AND ticker = ?`).bind(session.user_id, ticker.toUpperCase()).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/stocks/watchlist/:ticker", err); }
  });
}
