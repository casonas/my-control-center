export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const PRESET_MODES = [
  { mode_key: "focus", name: "Focus Mode", active: 0, config_json: '{"mute_non_urgent":true,"minimal_ui":true}' },
  { mode_key: "research", name: "Research Mode", active: 0, config_json: '{"prioritize_research":true}' },
  { mode_key: "market", name: "Market Mode", active: 0, config_json: '{"prioritize_stocks":true,"prioritize_sports":true}' },
  { mode_key: "jobs", name: "Job Hunt Mode", active: 0, config_json: '{"prioritize_jobs":true}' },
  { mode_key: "study", name: "Study Mode", active: 0, config_json: '{"prioritize_school":true}' },
  { mode_key: "low_cost", name: "Low-Cost Mode", active: 0, config_json: '{"strict_caps":true,"reduced_cron":true}' },
];

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ modes: PRESET_MODES });

    try {
      const r = await db
        .prepare(`SELECT * FROM user_profiles WHERE user_id = ?`)
        .bind(userId)
        .all();
      const modes = r.results && r.results.length > 0 ? r.results : PRESET_MODES;
      return Response.json({ modes });
    } catch (err) {
      return d1ErrorResponse("GET /api/settings/modes", err);
    }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = (await req.json()) as {
        name: string;
        mode_key: string;
        config_json?: string;
      };
      if (!body.name || !body.mode_key) {
        return Response.json({ error: "name and mode_key required" }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const configJson = body.config_json || "{}";

      await db
        .prepare(
          `INSERT INTO user_profiles (id, user_id, mode_key, name, active, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
        )
        .bind(id, session.user_id, body.mode_key, body.name, configJson, now, now)
        .run();

      return Response.json(
        { mode: { id, user_id: session.user_id, mode_key: body.mode_key, name: body.name, active: 0, config_json: configJson, created_at: now, updated_at: now } },
        { status: 201 }
      );
    } catch (err) {
      return d1ErrorResponse("POST /api/settings/modes", err);
    }
  });
}
