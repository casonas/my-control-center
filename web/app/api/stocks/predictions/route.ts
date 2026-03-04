export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { createPrediction } from "@/lib/predictionEngine";
import type { PredictionInput } from "@/lib/predictionEngine";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ predictions: [], metrics: {} });
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const ticker = url.searchParams.get("ticker");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

    try {
      let query = `SELECT * FROM stock_predictions WHERE user_id = ?`;
      const params: (string | number)[] = [userId];
      if (status) { query += ` AND status = ?`; params.push(status); }
      if (ticker) { query += ` AND ticker = ?`; params.push(ticker.toUpperCase()); }
      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);
      const r = await db.prepare(query).bind(...params).all();

      // Also fetch metrics
      let metrics = {};
      try {
        const m = await db.prepare(`SELECT * FROM stock_agent_metrics WHERE user_id = ?`).bind(userId).all();
        const metricsArr = m.results || [];
        metrics = Object.fromEntries(metricsArr.map((r: Record<string, unknown>) => [r.window, r]));
      } catch { /* metrics table may not exist yet */ }

      return Response.json({ predictions: r.results || [], metrics });
    } catch { return Response.json({ predictions: [], metrics: {} }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as PredictionInput;
      if (!body.ticker || !body.prediction_text) {
        return Response.json({ error: "ticker and prediction_text required" }, { status: 400 });
      }
      if (!body.confidence || body.confidence < 0 || body.confidence > 100) {
        return Response.json({ error: "confidence must be 0-100" }, { status: 400 });
      }
      const prediction = await createPrediction(db, session.user_id, body);
      return Response.json({ ok: true, prediction }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/stocks/predictions", err); }
  });
}
