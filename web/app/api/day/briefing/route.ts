export const runtime = "edge";
// web/app/api/day/briefing/route.ts — GET /api/day/briefing?date=YYYY-MM-DD

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ briefing: null });

    const url = new URL(req.url);
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

    try {
      const row = await db
        .prepare(`SELECT * FROM daily_briefings WHERE user_id = ? AND date = ?`)
        .bind(userId, date)
        .first();

      return Response.json({ briefing: row || null });
    } catch {
      return Response.json({ briefing: null });
    }
  });
}
