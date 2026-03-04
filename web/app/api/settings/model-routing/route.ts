export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const DEFAULT_ROUTING = {
  routing: {
    chat: { default_model: "gpt-4o-mini", backup_model: "kimi", max_tokens: 4096, max_retries: 2 },
    research: { default_model: "gpt-4o-mini", backup_model: "kimi", max_tokens: 4096, max_retries: 2 },
    jobs: { default_model: "gpt-4o-mini", backup_model: "kimi", max_tokens: 2048, max_retries: 2 },
    stocks: { default_model: "gpt-4o-mini", backup_model: "kimi", max_tokens: 2048, max_retries: 1 },
    sports: { default_model: "gpt-4o-mini", backup_model: "kimi", max_tokens: 2048, max_retries: 1 },
    home: { default_model: "gpt-4o-mini", backup_model: "kimi", max_tokens: 1024, max_retries: 1 },
    system: { default_model: "gpt-4o-mini", backup_model: "kimi", max_tokens: 1024, max_retries: 1 },
  },
  use_cheap_for_cron: true,
  premium_on_explicit_only: false,
};

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json(DEFAULT_ROUTING);

    try {
      const row = await db
        .prepare(`SELECT settings_json FROM user_settings WHERE user_id = ?`)
        .bind(userId)
        .first<{ settings_json: string }>();

      if (row) {
        const settings = JSON.parse(row.settings_json);
        if (settings.model_routing) {
          // Merge user overrides on top of defaults
          return Response.json({
            routing: { ...DEFAULT_ROUTING.routing, ...settings.model_routing.routing },
            use_cheap_for_cron: settings.model_routing.use_cheap_for_cron ?? DEFAULT_ROUTING.use_cheap_for_cron,
            premium_on_explicit_only: settings.model_routing.premium_on_explicit_only ?? DEFAULT_ROUTING.premium_on_explicit_only,
          });
        }
      }

      return Response.json(DEFAULT_ROUTING);
    } catch (err) {
      return d1ErrorResponse("GET /api/settings/model-routing", err);
    }
  });
}

export async function PATCH(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const partial = (await req.json()) as Record<string, unknown>;
      const now = new Date().toISOString();

      // Load current settings
      const row = await db
        .prepare(`SELECT settings_json FROM user_settings WHERE user_id = ?`)
        .bind(session.user_id)
        .first<{ settings_json: string }>();

      const current = row ? JSON.parse(row.settings_json) : {};
      const existingRouting = current.model_routing || {};

      // Merge partial into existing model_routing
      const merged = { ...existingRouting };
      for (const [key, value] of Object.entries(partial)) {
        if (key === "routing" && typeof value === "object" && value !== null) {
          merged.routing = { ...(merged.routing || {}), ...(value as Record<string, unknown>) };
        } else {
          merged[key] = value;
        }
      }

      current.model_routing = merged;
      const json = JSON.stringify(current);

      if (row) {
        await db
          .prepare(`UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?`)
          .bind(json, now, session.user_id)
          .run();
      } else {
        await db
          .prepare(`INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)`)
          .bind(session.user_id, json, now)
          .run();
      }

      // Log to audit
      await db
        .prepare(
          `INSERT INTO settings_audit_log (id, user_id, action_type, before_json, after_json, actor, created_at)
           VALUES (?, ?, 'model_override', ?, ?, 'user', ?)`
        )
        .bind(
          crypto.randomUUID(),
          session.user_id,
          JSON.stringify(existingRouting),
          JSON.stringify(merged),
          now
        )
        .run();

      return Response.json({
        ok: true,
        routing: {
          ...DEFAULT_ROUTING.routing,
          ...(merged.routing || {}),
        },
        use_cheap_for_cron: merged.use_cheap_for_cron ?? DEFAULT_ROUTING.use_cheap_for_cron,
        premium_on_explicit_only: merged.premium_on_explicit_only ?? DEFAULT_ROUTING.premium_on_explicit_only,
      });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/settings/model-routing", err);
    }
  });
}
