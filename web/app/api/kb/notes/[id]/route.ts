export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ note: null });
    try {
      const { id } = await ctx.params;
      const note = await db.prepare(`SELECT * FROM kb_notes WHERE id = ? AND user_id = ?`).bind(id, userId).first();
      if (!note) return Response.json({ error: "Not found" }, { status: 404 });
      // Fetch tags
      const tags = await db.prepare(
        `SELECT t.name FROM kb_note_tags nt JOIN kb_tags t ON t.id = nt.tag_id WHERE nt.note_id = ? AND nt.user_id = ?`
      ).bind(id, userId).all<{ name: string }>();
      return Response.json({ note, tags: (tags.results || []).map((t) => t.name) });
    } catch (err) { return d1ErrorResponse("GET /api/kb/notes/:id", err); }
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      const body = await req.json() as { title?: string; contentMd?: string; tags?: string[] };
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (body.title) { sets.push("title = ?"); vals.push(body.title); }
      if (body.contentMd) { sets.push("content_md = ?"); vals.push(body.contentMd); }
      if (sets.length === 0 && !body.tags) return Response.json({ error: "No fields" }, { status: 400 });
      const now = new Date().toISOString();
      if (sets.length > 0) {
        sets.push("updated_at = ?"); vals.push(now);
        vals.push(id, session.user_id);
        await db.prepare(`UPDATE kb_notes SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals).run();
      }
      // Replace tags
      if (body.tags) {
        await db.prepare(`DELETE FROM kb_note_tags WHERE note_id = ? AND user_id = ?`).bind(id, session.user_id).run();
        for (const tagName of body.tags) {
          const clean = tagName.trim().toLowerCase();
          if (!clean) continue;
          const tagId = crypto.randomUUID();
          await db.prepare(`INSERT OR IGNORE INTO kb_tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`)
            .bind(tagId, session.user_id, clean, now).run();
          const existing = await db.prepare(`SELECT id FROM kb_tags WHERE user_id = ? AND name = ?`)
            .bind(session.user_id, clean).first<{ id: string }>();
          if (existing) {
            await db.prepare(`INSERT OR IGNORE INTO kb_note_tags (user_id, note_id, tag_id) VALUES (?, ?, ?)`)
              .bind(session.user_id, id, existing.id).run();
          }
        }
      }
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("PATCH /api/kb/notes/:id", err); }
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const { id } = await ctx.params;
      await db.prepare(`DELETE FROM kb_notes WHERE id = ? AND user_id = ?`).bind(id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/kb/notes/:id", err); }
  });
}
