export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { resolvePredictions } from "@/lib/predictionEngine";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const start = Date.now();
      const result = await resolvePredictions(db, session.user_id);
      return Response.json({ ok: true, resolved: result.resolved, tookMs: Date.now() - start });
    } catch (err) { return d1ErrorResponse("POST /api/stocks/predictions/resolve", err); }
  });
}
