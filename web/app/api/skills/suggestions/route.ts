export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ suggestions: [] });
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "new";
    try {
      const r = await db.prepare(`SELECT * FROM skill_suggestions WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 20`).bind(userId, status).all();
      return Response.json({ suggestions: r.results || [] });
    } catch { return Response.json({ suggestions: [] }); }
  });
}

export async function PATCH(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { id: string; status: string; saveToLessons?: boolean };
      if (!body.id || !body.status) return Response.json({ error: "id and status required" }, { status: 400 });
      const validStatuses = ["new", "saved", "dismissed", "added"];
      if (!validStatuses.includes(body.status)) return Response.json({ error: "Invalid status" }, { status: 400 });
      const now = new Date().toISOString();

      // Update the suggestion status
      await db.prepare(`UPDATE skill_suggestions SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(body.status, now, body.id, session.user_id).run();

      let replacement = null;
      let lessonCreated = false;

      // When saving, fetch a replacement from the remaining "new" pool (excluding current)
      if (body.status === "saved" || body.status === "dismissed") {
        const rep = await db.prepare(
          `SELECT * FROM skill_suggestions WHERE user_id = ? AND status = 'new' AND id != ? ORDER BY RANDOM() LIMIT 1`
        ).bind(session.user_id, body.id).first();
        if (rep) replacement = rep;
      }

      // "Save to Lessons" — create a lesson draft linked to the suggestion's skill
      if (body.saveToLessons && body.status === "saved") {
        const suggestion = await db.prepare(
          `SELECT proposed_skill_name, reason_md FROM skill_suggestions WHERE id = ? AND user_id = ?`
        ).bind(body.id, session.user_id).first<{ proposed_skill_name: string; reason_md: string }>();

        if (suggestion) {
          // Find or create the skill
          let skill = await db.prepare(
            `SELECT id FROM skill_items WHERE user_id = ? AND name = ?`
          ).bind(session.user_id, suggestion.proposed_skill_name).first<{ id: string }>();

          if (!skill) {
            const skillId = crypto.randomUUID();
            await db.prepare(
              `INSERT INTO skill_items (id, user_id, name, level, created_at, updated_at) VALUES (?, ?, ?, 'beginner', ?, ?)`
            ).bind(skillId, session.user_id, suggestion.proposed_skill_name, now, now).run();
            skill = { id: skillId };
          }

          // Create a draft lesson
          const lessonId = crypto.randomUUID();
          const nextOrder = (await db.prepare(
            `SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM skill_lessons WHERE user_id = ? AND skill_id = ?`
          ).bind(session.user_id, skill.id).first<{ next: number }>())?.next ?? 0;

          await db.prepare(
            `INSERT INTO skill_lessons (id, user_id, skill_id, module_title, lesson_title, order_index, content_md, created_at, updated_at, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggestion')`
          ).bind(lessonId, session.user_id, skill.id, suggestion.proposed_skill_name, `${suggestion.proposed_skill_name} — Draft`, nextOrder, suggestion.reason_md, now, now).run();

          // Mark suggestion as "added"
          await db.prepare(`UPDATE skill_suggestions SET status = 'added', updated_at = ? WHERE id = ? AND user_id = ?`)
            .bind(now, body.id, session.user_id).run();

          lessonCreated = true;
        }
      }

      return Response.json({ ok: true, replacement, lessonCreated });
    } catch (err) { return d1ErrorResponse("PATCH /api/skills/suggestions", err); }
  });
}
