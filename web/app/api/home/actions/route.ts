export const runtime = "edge";
// web/app/api/home/actions/route.ts — List & create next-best actions

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ actions: [] });

    try {
      const r = await db
        .prepare(
          `SELECT * FROM home_actions
           WHERE user_id = ? AND status IN ('new','accepted')
           ORDER BY priority ASC, created_at DESC
           LIMIT 20`,
        )
        .bind(userId)
        .all();
      return Response.json({ actions: r.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/home/actions", err);
    }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db)
      return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = (await req.json()) as {
        title?: string;
        source_type?: string;
        priority?: number;
        urgency?: string;
      };

      if (!body.title)
        return Response.json({ error: "title required" }, { status: 400 });

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const source_type = body.source_type ?? "manual";
      const priority = body.priority ?? 3;
      const urgency = body.urgency ?? "low";
      const status = "new";

      await db
        .prepare(
          `INSERT INTO home_actions
           (id, user_id, title, source_type, priority, urgency, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          session.user_id,
          body.title,
          source_type,
          priority,
          urgency,
          status,
          now,
          now,
        )
        .run();

      return Response.json(
        {
          action: {
            id,
            user_id: session.user_id,
            title: body.title,
            source_type,
            priority,
            urgency,
            status,
            created_at: now,
            updated_at: now,
          },
        },
        { status: 201 },
      );
    } catch (err) {
      return d1ErrorResponse("POST /api/home/actions", err);
    }
  });
}
