export const runtime = "edge";
// web/app/api/settings/route.ts — GET + PATCH user settings

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const DEFAULT_SETTINGS = {
  notifications: { inApp: true },
  connectors: {
    rss: { enabled: true, feeds: [] as string[] },
    imap: { enabled: false, host: "", port: 993, tls: true, user: "" },
    ics: { enabled: false, urls: [] as string[] },
    vps: { bridgeUrl: "https://bridge.my-control-center.com", enabled: true },
  },
  ui: { defaultTab: "home", defaultAgent: "main" },
};

/**
 * GET /api/settings — returns user settings (creates defaults if not exist)
 */
export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) {
      // No D1 — return defaults (localStorage MVP)
      return Response.json({ settings: DEFAULT_SETTINGS });
    }

    try {
      const row = await db
        .prepare(`SELECT settings_json FROM user_settings WHERE user_id = ?`)
        .bind(userId)
        .first<{ settings_json: string }>();

      if (row) {
        return Response.json({ settings: JSON.parse(row.settings_json) });
      }

      // Create default settings
      const now = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)`
        )
        .bind(userId, JSON.stringify(DEFAULT_SETTINGS), now)
        .run();

      return Response.json({ settings: DEFAULT_SETTINGS });
    } catch (err) {
      return d1ErrorResponse("GET /api/settings", err);
    }
  });
}

/**
 * PATCH /api/settings — merge partial settings
 */
export async function PATCH(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) {
      return Response.json({ settings: DEFAULT_SETTINGS, note: "D1 not available; settings not persisted" });
    }

    try {
      const partial = await req.json() as Record<string, unknown>;

      // Load current settings
      const row = await db
        .prepare(`SELECT settings_json FROM user_settings WHERE user_id = ?`)
        .bind(session.user_id)
        .first<{ settings_json: string }>();

      const current = row ? JSON.parse(row.settings_json) : { ...DEFAULT_SETTINGS };

      // Deep merge (one level)
      const merged = { ...current };
      for (const [key, value] of Object.entries(partial)) {
        if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof merged[key] === "object") {
          merged[key] = { ...merged[key], ...value };
        } else {
          merged[key] = value;
        }
      }

      const now = new Date().toISOString();
      const json = JSON.stringify(merged);

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

      return Response.json({ settings: merged });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/settings", err);
    }
  });
}
