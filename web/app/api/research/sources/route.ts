export const runtime = "edge";
// web/app/api/research/sources/route.ts — List / manage research RSS sources

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ sources: [] });

    try {
      const result = await db
        .prepare(`SELECT * FROM research_sources WHERE user_id = ? ORDER BY name`)
        .bind(userId)
        .all();
      return Response.json({ sources: result.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/research/sources", err);
    }
  });
}

export async function PATCH(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as {
        action: "add" | "enable" | "disable" | "remove";
        id?: string;
        name?: string;
        url?: string;
      };

      if (body.action === "add" && body.name && body.url) {
        const id = crypto.randomUUID();
        await db
          .prepare(`INSERT INTO research_sources (id, user_id, name, url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`)
          .bind(id, session.user_id, body.name, body.url, new Date().toISOString())
          .run();
        return Response.json({ ok: true, id });
      }

      if (body.action === "enable" && body.id) {
        await db.prepare(`UPDATE research_sources SET enabled = 1 WHERE id = ? AND user_id = ?`).bind(body.id, session.user_id).run();
        return Response.json({ ok: true });
      }

      if (body.action === "disable" && body.id) {
        await db.prepare(`UPDATE research_sources SET enabled = 0 WHERE id = ? AND user_id = ?`).bind(body.id, session.user_id).run();
        return Response.json({ ok: true });
      }

      if (body.action === "remove" && body.id) {
        await db.prepare(`DELETE FROM research_sources WHERE id = ? AND user_id = ?`).bind(body.id, session.user_id).run();
        return Response.json({ ok: true });
      }

      return Response.json({ error: "Invalid action" }, { status: 400 });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/research/sources", err);
    }
  });
}
