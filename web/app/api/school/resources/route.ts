export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ resources: [] });
    const url = new URL(req.url);
    const courseId = url.searchParams.get("courseId");
    const category = url.searchParams.get("category");
    try {
      let query = `SELECT * FROM school_resources WHERE user_id = ?`;
      const params: unknown[] = [userId];
      if (courseId) { query += ` AND course_id = ?`; params.push(courseId); }
      if (category) { query += ` AND category = ?`; params.push(category); }
      query += ` ORDER BY updated_at DESC`;
      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ resources: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/school/resources", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = (await req.json()) as {
        courseId?: string; category?: string; name: string; url?: string; notes?: string;
      };
      if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
      const validCats = ["lms", "library", "tutoring", "writing", "career", "other"];
      const cat = validCats.includes(body.category || "") ? body.category! : "other";
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO school_resources (id, user_id, course_id, category, name, url, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, body.courseId || null, cat, body.name, body.url || null, body.notes || null, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/school/resources", err); }
  });
}
