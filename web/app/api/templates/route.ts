export const runtime = "edge";
// web/app/api/templates/route.ts — Outreach templates CRUD

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const DEFAULT_TEMPLATES = [
  {
    name: "Cold Email — Hiring Manager",
    subject: "Interest in {role} at {company}",
    body_md: "Hi,\n\nI came across the {role} position at {company} and wanted to reach out. My background in {skills_match} aligns well with this role.\n\n{why_match}\n\nI'd love to learn more about the opportunity. Here's the posting I found: {job_link}\n\nBest regards",
  },
  {
    name: "LinkedIn Connection Request",
    subject: "Connecting re: {role} at {company}",
    body_md: "Hi! I noticed {company} is hiring for {role}. With my experience in {skills_match}, I believe I could contribute to your team. Would love to connect and learn more.\n\n{job_link}",
  },
  {
    name: "Follow-up After Application",
    subject: "Following up on my {role} application — {company}",
    body_md: "Hi,\n\nI recently applied for the {role} position at {company} and wanted to follow up. My skills in {skills_match} make me a strong fit for this role.\n\n{why_match}\n\nI'd appreciate any updates on the hiring timeline. Thank you!\n\nBest regards",
  },
  {
    name: "Thank You — Post Interview",
    subject: "Thank you — {role} interview at {company}",
    body_md: "Hi,\n\nThank you for taking the time to discuss the {role} position at {company}. I enjoyed learning more about the team and the role.\n\nI'm excited about the opportunity to bring my {skills_match} expertise to your organization.\n\nPlease don't hesitate to reach out if you need any additional information.\n\nBest regards",
  },
];

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ templates: [] });

    try {
      const result = await db
        .prepare(`SELECT * FROM outreach_templates WHERE user_id = ? ORDER BY created_at`)
        .bind(userId)
        .all();

      let templates = result.results || [];

      // Seed default templates if none exist
      if (templates.length === 0) {
        const now = new Date().toISOString();
        for (const t of DEFAULT_TEMPLATES) {
          const id = crypto.randomUUID();
          await db
            .prepare(`INSERT OR IGNORE INTO outreach_templates (id, user_id, name, subject, body_md, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(id, userId, t.name, t.subject, t.body_md, now)
            .run();
        }
        const refreshed = await db
          .prepare(`SELECT * FROM outreach_templates WHERE user_id = ? ORDER BY created_at`)
          .bind(userId)
          .all();
        templates = refreshed.results || [];
      }

      return Response.json({ templates });
    } catch (err) {
      return d1ErrorResponse("GET /api/templates", err);
    }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { name: string; subject: string; body_md: string };
      if (!body.name || !body.subject || !body.body_md) {
        return Response.json({ error: "name, subject, and body_md are required" }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db
        .prepare(`INSERT INTO outreach_templates (id, user_id, name, subject, body_md, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, session.user_id, body.name, body.subject, body.body_md, now)
        .run();

      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) {
      return d1ErrorResponse("POST /api/templates", err);
    }
  });
}
