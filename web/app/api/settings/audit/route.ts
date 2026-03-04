export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ entries: [] });

    try {
      const r = await db
        .prepare(
          `SELECT * FROM settings_audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
        )
        .bind(userId)
        .all();
      return Response.json({ entries: r.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/settings/audit", err);
    }
  });
}
