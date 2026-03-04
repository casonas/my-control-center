export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ budgets: [] });

    try {
      const r = await db
        .prepare(`SELECT * FROM token_budgets WHERE user_id = ?`)
        .bind(userId)
        .all();
      return Response.json({ budgets: r.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/settings/token-budgets", err);
    }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = (await req.json()) as {
        period: string;
        feature_scope: string;
        max_input_tokens?: number;
        max_output_tokens?: number;
        max_cost_usd?: number;
      };
      if (!body.period || !body.feature_scope) {
        return Response.json({ error: "period and feature_scope required" }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT OR REPLACE INTO token_budgets (id, user_id, period, feature_scope, max_input_tokens, max_output_tokens, max_cost_usd, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          session.user_id,
          body.period,
          body.feature_scope,
          body.max_input_tokens ?? null,
          body.max_output_tokens ?? null,
          body.max_cost_usd ?? null,
          now,
          now
        )
        .run();

      // Log to audit
      await db
        .prepare(
          `INSERT INTO settings_audit_log (id, user_id, action_type, after_json, actor, created_at)
           VALUES (?, ?, 'budget_update', ?, 'user', ?)`
        )
        .bind(
          crypto.randomUUID(),
          session.user_id,
          JSON.stringify({ period: body.period, feature_scope: body.feature_scope }),
          now
        )
        .run();

      return Response.json(
        {
          budget: {
            id,
            user_id: session.user_id,
            period: body.period,
            feature_scope: body.feature_scope,
            max_input_tokens: body.max_input_tokens ?? null,
            max_output_tokens: body.max_output_tokens ?? null,
            max_cost_usd: body.max_cost_usd ?? null,
            created_at: now,
            updated_at: now,
          },
        },
        { status: 201 }
      );
    } catch (err) {
      return d1ErrorResponse("POST /api/settings/token-budgets", err);
    }
  });
}
