export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return new Response("D1 not available", { status: 500 });
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "md";
    const scope = url.searchParams.get("scope") || "all";
    const value = url.searchParams.get("value");

    try {
      let query = `SELECT n.*, (SELECT GROUP_CONCAT(t.name) FROM kb_note_tags nt JOIN kb_tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND nt.user_id = n.user_id) AS tags FROM kb_notes n WHERE n.user_id = ?`;
      const params: unknown[] = [userId];
      if (scope === "tag" && value) {
        query = `SELECT n.*, (SELECT GROUP_CONCAT(t2.name) FROM kb_note_tags nt2 JOIN kb_tags t2 ON t2.id = nt2.tag_id WHERE nt2.note_id = n.id AND nt2.user_id = n.user_id) AS tags
          FROM kb_notes n JOIN kb_note_tags nt ON nt.note_id = n.id JOIN kb_tags t ON t.id = nt.tag_id WHERE n.user_id = ? AND t.name = ?`;
        params.push(value);
      } else if (scope === "course" && value) { query += ` AND n.course_id = ?`; params.push(value); }
      else if (scope === "skill" && value) { query += ` AND n.skill_id = ?`; params.push(value); }
      query += ` ORDER BY n.updated_at DESC`;

      const r = await db.prepare(query).bind(...params).all<{ id: string; title: string; content_md: string; tags?: string; source: string; updated_at: string }>();
      const notes = r.results || [];

      if (format === "json") {
        return new Response(JSON.stringify({ notes }, null, 2), {
          headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="mcc-kb-${scope}.json"` },
        });
      }

      // Markdown export
      let md = `# MCC Knowledge Base Export\n\n_Exported: ${new Date().toISOString()}_\n\n---\n\n`;
      for (const n of notes) {
        md += `## ${n.title}\n\n`;
        md += `_Source: ${n.source} | Updated: ${n.updated_at}_\n`;
        if (n.tags) md += `_Tags: ${n.tags}_\n`;
        md += `\n${n.content_md}\n\n---\n\n`;
      }
      return new Response(md, {
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="mcc-kb-${scope}.md"` },
      });
    } catch { return new Response("Export failed", { status: 500 }); }
  });
}
