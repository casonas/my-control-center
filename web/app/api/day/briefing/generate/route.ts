export const runtime = "edge";
// web/app/api/day/briefing/generate/route.ts — Generate daily briefing

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const userId = session.user_id;
    const body = await req.json() as { date?: string };
    const date = body.date || new Date().toISOString().slice(0, 10);

    try {
      // Gather data for briefing
      const sections: string[] = [];
      sections.push(`# Daily Briefing — ${date}\n`);

      // School
      try {
        const todayStart = `${date}T00:00:00.000Z`;
        const todayEnd = `${date}T23:59:59.999Z`;
        const assignments = await db
          .prepare(`SELECT title, due_at, status FROM school_assignments WHERE user_id = ? AND due_at >= ? AND due_at <= ? ORDER BY due_at ASC LIMIT 5`)
          .bind(userId, todayStart, todayEnd)
          .all();
        if ((assignments.results || []).length > 0) {
          sections.push("## 📚 Assignments Due Today\n");
          for (const a of assignments.results || []) {
            sections.push(`- **${a.title}** (${a.status}) — due ${String(a.due_at).slice(11, 16)}`);
          }
          sections.push("");
        }
      } catch { /* table may not exist */ }

      // Research
      try {
        const items = await db
          .prepare(`SELECT title, url FROM research_items WHERE user_id = ? ORDER BY fetched_at DESC LIMIT 5`)
          .bind(userId)
          .all();
        if ((items.results || []).length > 0) {
          sections.push("## 🔬 Top Research Signals\n");
          for (const item of items.results || []) {
            sections.push(`- [${item.title}](${item.url})`);
          }
          sections.push("");
        }
      } catch { /* table may not exist */ }

      // Jobs
      try {
        const newCount = await db
          .prepare(`SELECT COUNT(*) as c FROM job_items WHERE user_id = ? AND status = 'new'`)
          .bind(userId)
          .first<{ c: number }>();
        if (newCount && newCount.c > 0) {
          sections.push(`## 💼 Jobs Pipeline\n`);
          sections.push(`- **${newCount.c}** new job postings to review\n`);
        }
      } catch { /* table may not exist */ }

      // Stock news
      try {
        const news = await db
          .prepare(`SELECT title, url FROM stock_news_items WHERE user_id = ? ORDER BY fetched_at DESC LIMIT 3`)
          .bind(userId)
          .all();
        if ((news.results || []).length > 0) {
          sections.push("## 📈 Market News\n");
          for (const n of news.results || []) {
            sections.push(`- [${n.title}](${n.url})`);
          }
          sections.push("");
        }
      } catch { /* table may not exist */ }

      // What to do next
      sections.push("## ✅ What to Do Next\n");
      sections.push("- [ ] Review new research signals");
      sections.push("- [ ] Check job postings pipeline");
      sections.push("- [ ] Complete due assignments");
      sections.push("");

      const contentMd = sections.join("\n");
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      // Upsert briefing
      await db.prepare(
        `INSERT OR REPLACE INTO daily_briefings (id, user_id, date, title, content_md, created_at, updated_at)
         VALUES (?, ?, ?, 'Daily Briefing', ?, ?, ?)`
      ).bind(id, userId, date, contentMd, now, now).run();

      return Response.json({ ok: true, briefingId: id, date });
    } catch (err) {
      return d1ErrorResponse("POST /api/day/briefing/generate", err);
    }
  });
}
