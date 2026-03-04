export const runtime = "edge";
// web/app/api/research/entities/watch/route.ts — Toggle watch on an entity

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { entity_id: string; watch: boolean };
      if (!body.entity_id) {
        return Response.json({ error: "entity_id required" }, { status: 400 });
      }

      const watchVal = body.watch !== false ? 1 : 0;

      await db
        .prepare(`UPDATE research_entities SET watch = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(watchVal, new Date().toISOString(), body.entity_id, session.user_id)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("POST /api/research/entities/watch", err);
    }
  });
}
