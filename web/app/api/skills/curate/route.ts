export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = (await req.json()) as { keepNames?: string[] };
      const keepNames = body.keepNames;
      if (!Array.isArray(keepNames) || keepNames.length === 0) {
        return Response.json({ error: "keepNames array required" }, { status: 400 });
      }

      // Find skills NOT in the keep list
      const placeholders = keepNames.map(() => "?").join(",");
      const toDelete = await db
        .prepare(
          `SELECT id FROM skill_items WHERE user_id = ? AND name NOT IN (${placeholders})`,
        )
        .bind(session.user_id, ...keepNames)
        .all<{ id: string }>();

      const ids = (toDelete.results || []).map((r) => r.id);
      let deleted = 0;

      for (const skillId of ids) {
        // Cascade delete
        await db
          .prepare(
            `DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id IN (SELECT id FROM skill_lessons WHERE skill_id = ?)`,
          )
          .bind(session.user_id, skillId)
          .run();
        await db
          .prepare(`DELETE FROM skill_lessons WHERE skill_id = ? AND user_id = ?`)
          .bind(skillId, session.user_id)
          .run();
        await db
          .prepare(`DELETE FROM roadmap_items WHERE skill_id = ? AND user_id = ?`)
          .bind(skillId, session.user_id)
          .run();
        await db
          .prepare(`DELETE FROM skill_notes WHERE skill_id = ? AND user_id = ?`)
          .bind(skillId, session.user_id)
          .run();
        await db
          .prepare(`DELETE FROM skill_items WHERE id = ? AND user_id = ?`)
          .bind(skillId, session.user_id)
          .run();
        deleted++;
      }

      return Response.json({ ok: true, deleted });
    } catch (err) {
      return d1ErrorResponse("POST /api/skills/curate", err);
    }
  });
}
