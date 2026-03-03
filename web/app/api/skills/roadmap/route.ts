export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

/** Seed defaults if user has no skills/roadmap */
const SEED_SKILLS = [
  { name: "Cloudflare Workers", category: "cloud", level: "intermediate", desc: "Edge compute with Cloudflare Workers, D1, R2, KV" },
  { name: "Next.js", category: "dev", level: "intermediate", desc: "Full-stack React framework with App Router" },
  { name: "D1 & SQL", category: "cloud", level: "beginner", desc: "Cloudflare D1 SQLite database, migrations, queries" },
  { name: "CompTIA Security+", category: "security", level: "beginner", desc: "Foundational cybersecurity certification" },
  { name: "Splunk Basics", category: "security", level: "beginner", desc: "SIEM log analysis and threat detection" },
  { name: "OAuth & Cookie Auth", category: "security", level: "intermediate", desc: "Web authentication patterns and session management" },
  { name: "RSS & Web Scraping Ethics", category: "dev", level: "beginner", desc: "Responsible data collection from public feeds" },
  { name: "PostgreSQL", category: "dev", level: "intermediate", desc: "Advanced SQL, indexing, performance tuning" },
];

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ roadmap: [] });
    try {
      // Check if roadmap exists; seed if empty
      let roadmap = await db.prepare(
        `SELECT r.*, s.name AS skill_name, s.category, s.level, s.description AS skill_description,
          (SELECT COUNT(*) FROM skill_lessons l WHERE l.skill_id = r.skill_id AND l.user_id = r.user_id) AS total_lessons,
          (SELECT COUNT(*) FROM lesson_progress p JOIN skill_lessons l2 ON p.lesson_id = l2.id WHERE l2.skill_id = r.skill_id AND p.user_id = r.user_id AND p.status = 'completed') AS completed_lessons
         FROM roadmap_items r
         JOIN skill_items s ON r.skill_id = s.id
         WHERE r.user_id = ?
         ORDER BY r.order_index`
      ).bind(userId).all();

      if (!roadmap.results || roadmap.results.length === 0) {
        // Seed
        const now = new Date().toISOString();
        for (let i = 0; i < SEED_SKILLS.length; i++) {
          const sk = SEED_SKILLS[i];
          const skillId = crypto.randomUUID();
          const roadmapId = crypto.randomUUID();
          await db.prepare(
            `INSERT OR IGNORE INTO skill_items (id, user_id, name, category, level, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(skillId, userId, sk.name, sk.category, sk.level, sk.desc, now, now).run();
          await db.prepare(
            `INSERT OR IGNORE INTO roadmap_items (id, user_id, skill_id, order_index, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'planned', ?, ?)`
          ).bind(roadmapId, userId, skillId, i, now, now).run();
        }
        // Re-fetch
        roadmap = await db.prepare(
          `SELECT r.*, s.name AS skill_name, s.category, s.level, s.description AS skill_description, 0 AS total_lessons, 0 AS completed_lessons
           FROM roadmap_items r JOIN skill_items s ON r.skill_id = s.id WHERE r.user_id = ? ORDER BY r.order_index`
        ).bind(userId).all();
      }

      return Response.json({ roadmap: roadmap.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/skills/roadmap", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = await req.json() as { skillId: string; orderIndex?: number; prereqSkillIds?: string[] };
      if (!body.skillId) return Response.json({ error: "skillId required" }, { status: 400 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT OR IGNORE INTO roadmap_items (id, user_id, skill_id, order_index, status, prereq_skill_ids_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'planned', ?, ?, ?)`
      ).bind(id, session.user_id, body.skillId, body.orderIndex ?? 99, body.prereqSkillIds ? JSON.stringify(body.prereqSkillIds) : null, now, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/skills/roadmap", err); }
  });
}
