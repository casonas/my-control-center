export const runtime = "edge";
// web/app/api/jobs/pipeline/route.ts — Pipeline counts by status

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ pipeline: {} });

    try {
      const result = await db
        .prepare(`SELECT status, COUNT(*) as count FROM job_items WHERE user_id = ? GROUP BY status`)
        .bind(userId)
        .all<{ status: string; count: number }>();

      const pipeline: Record<string, number> = {};
      for (const row of result.results || []) {
        pipeline[row.status] = row.count;
      }
      return Response.json({ pipeline });
    } catch (err) {
      console.error("[jobs/pipeline]", err);
      return Response.json({ pipeline: {} });
    }
  });
}
