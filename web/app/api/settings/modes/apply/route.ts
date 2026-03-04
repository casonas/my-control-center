export const runtime = "edge";

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const PRESET_CONFIGS: Record<string, { name: string; config_json: string }> = {
  focus: { name: "Focus Mode", config_json: '{"mute_non_urgent":true,"minimal_ui":true}' },
  research: { name: "Research Mode", config_json: '{"prioritize_research":true}' },
  market: { name: "Market Mode", config_json: '{"prioritize_stocks":true,"prioritize_sports":true}' },
  jobs: { name: "Job Hunt Mode", config_json: '{"prioritize_jobs":true}' },
  study: { name: "Study Mode", config_json: '{"prioritize_school":true}' },
  low_cost: { name: "Low-Cost Mode", config_json: '{"strict_caps":true,"reduced_cron":true}' },
};

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = (await req.json()) as { mode_key: string };
      if (!body.mode_key) {
        return Response.json({ error: "mode_key required" }, { status: 400 });
      }

      const now = new Date().toISOString();

      // Deactivate all profiles for this user
      await db
        .prepare(`UPDATE user_profiles SET active = 0 WHERE user_id = ?`)
        .bind(session.user_id)
        .run();

      // Activate the selected mode
      const result = await db
        .prepare(
          `UPDATE user_profiles SET active = 1, updated_at = ? WHERE user_id = ? AND mode_key = ?`
        )
        .bind(now, session.user_id, body.mode_key)
        .run();

      // If no row was updated, insert a preset profile with active=1
      const changed = result.meta?.changes as number | undefined;
      if (!changed || changed === 0) {
        const preset = PRESET_CONFIGS[body.mode_key];
        if (!preset) {
          return Response.json({ error: "Unknown mode_key" }, { status: 400 });
        }
        const id = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO user_profiles (id, user_id, mode_key, name, active, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
          )
          .bind(id, session.user_id, body.mode_key, preset.name, preset.config_json, now, now)
          .run();
      }

      // Log to audit
      await db
        .prepare(
          `INSERT INTO settings_audit_log (id, user_id, action_type, after_json, actor, created_at)
           VALUES (?, ?, 'mode_change', ?, 'user', ?)`
        )
        .bind(crypto.randomUUID(), session.user_id, JSON.stringify({ mode_key: body.mode_key }), now)
        .run();

      return Response.json({ ok: true, mode_key: body.mode_key, message: "Mode applied" });
    } catch (err) {
      return d1ErrorResponse("POST /api/settings/modes/apply", err);
    }
  });
}
