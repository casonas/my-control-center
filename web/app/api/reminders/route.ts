export const runtime = "edge";
// web/app/api/reminders/route.ts — Reminders CRUD

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

/**
 * GET /api/reminders?from=&to=&status=open
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ reminders: [] });

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "open";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    try {
      let query = `SELECT * FROM reminders WHERE user_id = ?`;
      const params: unknown[] = [userId];

      if (status !== "all") { query += ` AND status = ?`; params.push(status); }
      if (from) { query += ` AND due_at >= ?`; params.push(from); }
      if (to) { query += ` AND due_at <= ?`; params.push(to); }

      query += ` ORDER BY due_at ASC LIMIT 50`;

      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ reminders: r.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/reminders", err);
    }
  });
}

/**
 * POST /api/reminders — Create a reminder
 * Body: { title, dueAt, type? }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { title: string; dueAt: string; type?: string };
      if (!body.title || !body.dueAt) {
        return Response.json({ ok: false, error: "title and dueAt required" }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.prepare(
        `INSERT INTO reminders (id, user_id, type, title, due_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`
      ).bind(id, session.user_id, body.type || "general", body.title, body.dueAt, now).run();

      return Response.json({ ok: true, id });
    } catch (err) {
      return d1ErrorResponse("POST /api/reminders", err);
    }
  });
}
