export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ lessonId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { lessonId } = await ctx.params;
      const body = await req.json() as { status?: string; lastPosition?: string };
      const status = ["not_started", "in_progress", "completed"].includes(body.status || "") ? body.status! : "in_progress";
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO lesson_progress (user_id, lesson_id, status, last_position, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, lesson_id) DO UPDATE SET status = ?, last_position = ?, completed_at = ?, updated_at = ?`
      ).bind(
        session.user_id, lessonId, status, body.lastPosition || null,
        status === "completed" ? now : null, now,
        status, body.lastPosition || null, status === "completed" ? now : null, now
      ).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("POST /api/lessons/:lessonId/progress", err); }
  });
}
