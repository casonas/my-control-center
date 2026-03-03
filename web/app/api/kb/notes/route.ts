export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ notes: [] });
    const url = new URL(req.url);
    const source = url.searchParams.get("source") || "all";
    const tag = url.searchParams.get("tag");
    const q = url.searchParams.get("q");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      let query: string;
      const params: unknown[] = [userId];

      if (tag) {
        query = `SELECT n.*, GROUP_CONCAT(t.name) AS tags
          FROM kb_notes n
          JOIN kb_note_tags nt ON nt.note_id = n.id AND nt.user_id = n.user_id
          JOIN kb_tags t ON t.id = nt.tag_id
          WHERE n.user_id = ?`;
        if (source !== "all") { query += ` AND n.source = ?`; params.push(source); }
        query += ` AND t.name = ?`;
        params.push(tag);
        query += ` GROUP BY n.id ORDER BY n.updated_at DESC LIMIT ? OFFSET ?`;
      } else if (q) {
        query = `SELECT n.*, (SELECT GROUP_CONCAT(t2.name) FROM kb_note_tags nt2 JOIN kb_tags t2 ON t2.id = nt2.tag_id WHERE nt2.note_id = n.id AND nt2.user_id = n.user_id) AS tags
          FROM kb_notes n WHERE n.user_id = ? AND (n.title LIKE ? OR n.content_md LIKE ?)`;
        params.push(`%${q}%`, `%${q}%`);
        if (source !== "all") { query += ` AND n.source = ?`; params.push(source); }
        query += ` ORDER BY n.updated_at DESC LIMIT ? OFFSET ?`;
      } else {
        query = `SELECT n.*, (SELECT GROUP_CONCAT(t2.name) FROM kb_note_tags nt2 JOIN kb_tags t2 ON t2.id = nt2.tag_id WHERE nt2.note_id = n.id AND nt2.user_id = n.user_id) AS tags
          FROM kb_notes n WHERE n.user_id = ?`;
        if (source !== "all") { query += ` AND n.source = ?`; params.push(source); }
        query += ` ORDER BY n.updated_at DESC LIMIT ? OFFSET ?`;
      }
      params.push(limit, offset);

      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ notes: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/kb/notes", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as {
        title: string; contentMd: string; source?: string; sourceId?: string;
        courseId?: string; skillId?: string; lessonId?: string; tags?: string[];
      };
      if (!body.title || !body.contentMd) return Response.json({ error: "title and contentMd required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const source = ["general", "school", "skills", "research"].includes(body.source || "") ? body.source! : "general";

      await db.prepare(
        `INSERT INTO kb_notes (id, user_id, title, content_md, source, source_id, course_id, skill_id, lesson_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, body.title, body.contentMd, source, body.sourceId || null, body.courseId || null, body.skillId || null, body.lessonId || null, now, now).run();

      // Handle tags
      if (body.tags && body.tags.length > 0) {
        for (const tagName of body.tags) {
          const clean = tagName.trim().toLowerCase();
          if (!clean) continue;
          const tagId = crypto.randomUUID();
          await db.prepare(`INSERT OR IGNORE INTO kb_tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`)
            .bind(tagId, session.user_id, clean, now).run();
          const existingTag = await db.prepare(`SELECT id FROM kb_tags WHERE user_id = ? AND name = ?`)
            .bind(session.user_id, clean).first<{ id: string }>();
          if (existingTag) {
            await db.prepare(`INSERT OR IGNORE INTO kb_note_tags (user_id, note_id, tag_id) VALUES (?, ?, ?)`)
              .bind(session.user_id, id, existingTag.id).run();
          }
        }
      }

      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/kb/notes", err); }
  });
}
