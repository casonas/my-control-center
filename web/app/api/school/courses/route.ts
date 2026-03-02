export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ courses: [] });
    try {
      const r = await db.prepare(`SELECT * FROM courses WHERE user_id = ? ORDER BY updated_at DESC`).bind(userId).all();
      return Response.json({ courses: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/school/courses", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { code: string; name?: string; term?: string; color?: string };
      if (!body.code) return Response.json({ error: "code required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT OR IGNORE INTO courses (id, user_id, code, name, term, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, body.code, body.name || null, body.term || null, body.color || null, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/school/courses", err); }
  });
}
