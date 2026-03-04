export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

function getCutoff(window: string): string {
  const now = new Date();
  switch (window) {
    case "week":
      now.setDate(now.getDate() - 7);
      break;
    case "month":
      now.setDate(now.getDate() - 30);
      break;
    default: // day
      now.setDate(now.getDate() - 1);
      break;
  }
  return now.toISOString();
}

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) {
      return Response.json({
        usage: { window: "day", total_input_tokens: 0, total_output_tokens: 0, total_estimated_cost: 0, by_model: [], by_scope: [], request_count: 0 },
      });
    }

    try {
      const url = new URL(req.url);
      const window = ["day", "week", "month"].includes(url.searchParams.get("window") || "")
        ? url.searchParams.get("window")!
        : "day";
      const cutoff = getCutoff(window);

      // Aggregate totals
      const totals = await db
        .prepare(
          `SELECT
             COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
             COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
             COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost,
             COUNT(*) AS request_count
           FROM model_usage_events
           WHERE user_id = ? AND created_at >= ?`
        )
        .bind(userId, cutoff)
        .first<{ total_input_tokens: number; total_output_tokens: number; total_estimated_cost: number; request_count: number }>();

      // By model
      const byModel = await db
        .prepare(
          `SELECT model,
             COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
             COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
             COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost,
             COUNT(*) AS request_count
           FROM model_usage_events
           WHERE user_id = ? AND created_at >= ?
           GROUP BY model`
        )
        .bind(userId, cutoff)
        .all();

      // By scope
      const byScope = await db
        .prepare(
          `SELECT feature_scope,
             COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
             COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
             COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost,
             COUNT(*) AS request_count
           FROM model_usage_events
           WHERE user_id = ? AND created_at >= ?
           GROUP BY feature_scope`
        )
        .bind(userId, cutoff)
        .all();

      return Response.json({
        usage: {
          window,
          total_input_tokens: totals?.total_input_tokens ?? 0,
          total_output_tokens: totals?.total_output_tokens ?? 0,
          total_estimated_cost: totals?.total_estimated_cost ?? 0,
          by_model: byModel.results || [],
          by_scope: byScope.results || [],
          request_count: totals?.request_count ?? 0,
        },
      });
    } catch (err) {
      return d1ErrorResponse("GET /api/settings/usage", err);
    }
  });
}
