export const runtime = "edge";
// web/app/api/home/digest/latest/route.ts — Latest digest

import { withReadAuth } from "@/lib/readAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ digest: null });

    try {
      const row = await db
        .prepare(
          `SELECT id, digest_type, title, body_md, created_at
           FROM home_digest_history
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .bind(userId)
        .first<{
          id: string;
          digest_type: string;
          title: string;
          body_md: string;
          created_at: string;
        }>();

      return Response.json({ digest: row ?? null });
    } catch (err) {
      return d1ErrorResponse("GET /api/home/digest/latest", err);
    }
  });
}
