export const runtime = "edge";
// web/app/api/outreach/draft/route.ts — Generate outreach draft from template + job

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { job_id: string; template_id: string };
      if (!body.job_id || !body.template_id) {
        return Response.json({ error: "job_id and template_id are required" }, { status: 400 });
      }

      const userId = session.user_id;

      // Fetch the job
      const job = await db
        .prepare(`SELECT * FROM job_items WHERE id = ? AND user_id = ?`)
        .bind(body.job_id, userId)
        .first<{ title: string; company: string; url: string; why_match: string | null; tags_json: string | null; match_score: number | null }>();

      if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

      // Fetch the template
      const template = await db
        .prepare(`SELECT * FROM outreach_templates WHERE id = ? AND user_id = ?`)
        .bind(body.template_id, userId)
        .first<{ name: string; subject: string; body_md: string }>();

      if (!template) return Response.json({ error: "Template not found" }, { status: 404 });

      // Extract skills from tags
      const tags: string[] = job.tags_json ? JSON.parse(job.tags_json) : [];
      const skillsMatch = tags.length > 0 ? tags.slice(0, 3).join(", ") : "cybersecurity and data analysis";

      // Replace placeholders
      const replacePlaceholders = (text: string) =>
        text
          .replace(/\{company\}/g, job.company || "your company")
          .replace(/\{role\}/g, job.title || "the role")
          .replace(/\{skills_match\}/g, skillsMatch)
          .replace(/\{job_link\}/g, job.url || "")
          .replace(/\{why_match\}/g, job.why_match || "Strong alignment with role requirements");

      const subject = replacePlaceholders(template.subject);
      const bodyMd = replacePlaceholders(template.body_md);

      // Save the draft
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT INTO outreach_drafts (id, user_id, job_id, template_id, subject, body_md, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
        )
        .bind(id, userId, body.job_id, body.template_id, subject, bodyMd, now, now)
        .run();

      return Response.json({ ok: true, id, subject, body_md: bodyMd }, { status: 201 });
    } catch (err) {
      return d1ErrorResponse("POST /api/outreach/draft", err);
    }
  });
}
