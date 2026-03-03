export const runtime = "edge";
// web/app/api/notifications/badges/route.ts — Badge counts per category

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ school: 0, jobs: 0, research: 0, stocks: 0, sports: 0, agents: 0, total: 0 });

    try {
      const r = await db
        .prepare(
          `SELECT category, COUNT(*) as c FROM notifications
           WHERE user_id = ? AND read_at IS NULL
           GROUP BY category`
        )
        .bind(userId)
        .all<{ category: string; c: number }>();

      const badges: Record<string, number> = { school: 0, jobs: 0, research: 0, stocks: 0, sports: 0, agents: 0, system: 0 };
      let total = 0;
      for (const row of r.results || []) {
        badges[row.category] = row.c;
        total += row.c;
      }

      return Response.json({ ...badges, total });
    } catch {
      return Response.json({ school: 0, jobs: 0, research: 0, stocks: 0, sports: 0, agents: 0, total: 0 });
    }
  });
}
