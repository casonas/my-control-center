export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ notes: [] });
    const url = new URL(req.url);
    const courseId = url.searchParams.get("courseId");
    try {
      let r;
      if (courseId) {
        r = await db.prepare(`SELECT * FROM school_notes WHERE user_id = ? AND course_id = ? ORDER BY updated_at DESC`).bind(userId, courseId).all();
      } else {
        r = await db.prepare(`SELECT * FROM school_notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`).bind(userId).all();
      }
      return Response.json({ notes: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/school/notes", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { courseId?: string; title: string; contentMd: string };
      if (!body.title || !body.contentMd) return Response.json({ error: "title, contentMd required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO school_notes (id, user_id, course_id, title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, body.courseId || null, body.title, body.contentMd, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/school/notes", err); }
  });
}
