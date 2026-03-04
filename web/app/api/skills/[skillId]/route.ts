export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ skillId: string }> },
) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    const { skillId } = await params;
    if (!skillId) return Response.json({ error: "skillId required" }, { status: 400 });

    try {
      // Verify ownership
      const skill = await db
        .prepare(`SELECT id FROM skill_items WHERE id = ? AND user_id = ?`)
        .bind(skillId, session.user_id)
        .first<{ id: string }>();
      if (!skill) return Response.json({ error: "Skill not found" }, { status: 404 });

      // Cascade delete: lesson_progress → skill_lessons → roadmap_items → skill_notes → skill_items
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

      return Response.json({ ok: true, deleted: 1 });
    } catch (err) {
      return d1ErrorResponse("DELETE /api/skills/[skillId]", err);
    }
  });
}
