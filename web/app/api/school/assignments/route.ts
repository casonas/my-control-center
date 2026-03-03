export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ assignments: [] });
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const courseId = url.searchParams.get("courseId");
    try {
      let query = `SELECT a.*, c.code AS course_code, c.name AS course_name, c.color AS course_color
        FROM school_assignments a LEFT JOIN courses c ON a.course_id = c.id
        WHERE a.user_id = ?`;
      const params: unknown[] = [userId];

      if (courseId) { query += ` AND a.course_id = ?`; params.push(courseId); }
      if (filter === "open") { query += ` AND a.status IN ('open','in_progress')`; }
      else if (filter === "due_soon") {
        const soon = new Date(Date.now() + 7 * 86400000).toISOString();
        query += ` AND a.due_at <= ? AND a.status IN ('open','in_progress')`;
        params.push(soon);
      }
      else if (filter === "late") {
        const now = new Date().toISOString();
        query += ` AND a.due_at < ? AND a.status IN ('open','in_progress')`;
        params.push(now);
      }

      query += ` ORDER BY a.due_at ASC LIMIT 100`;
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ assignments: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/school/assignments", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { courseId?: string; title: string; description?: string; dueAt: string; priority?: string };
      if (!body.title || !body.dueAt) return Response.json({ error: "title and dueAt required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const priority = ["low", "medium", "high"].includes(body.priority || "") ? body.priority! : null;
      await db.prepare(
        `INSERT INTO school_assignments (id, user_id, course_id, title, description, due_at, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
      ).bind(id, session.user_id, body.courseId || null, body.title, body.description || null, body.dueAt, priority, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/school/assignments", err); }
  });
}
