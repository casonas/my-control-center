export const runtime = "edge";
// web/app/api/skills/[skillId]/lessons/auto-create/route.ts
//
// POST /api/skills/:skillId/lessons/auto-create
// On-demand lesson creation from UI or chat.
// User-authenticated (mutating auth with CSRF).
//
// Input:  { topic?: string }
// Output: { ok, added, updated, skipped, warnings, budget }

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import {
  checkBudget,
  recordUsage,
  enforceJobCaps,
  DEFAULT_JOB_CAPS,
  type JobCaps,
} from "@/lib/budget";

type Ctx = { params: Promise<{ skillId: string }> };

function makeDedupe(skillId: string, moduleTitle: string, lessonTitle: string): string {
  const raw = `${skillId}:${moduleTitle}:${lessonTitle}`.toLowerCase().replace(/\s+/g, "_");
  return raw.slice(0, 200);
}

interface LessonPlan {
  moduleTitle: string;
  lessonTitle: string;
  contentMd: string;
  durationMinutes: number;
  resources: { label: string; url: string; type: string }[];
}

function generateLessonTemplates(skillName: string, level: string, topic?: string): LessonPlan[] {
  const subject = topic || skillName;
  return [
    {
      moduleTitle: `${subject} Fundamentals`,
      lessonTitle: `Introduction to ${subject}`,
      contentMd: [
        `# Introduction to ${subject}`,
        "",
        `## Overview`,
        `This lesson covers the foundational concepts of ${subject}.`,
        "",
        `## Key Concepts`,
        `- Core principles and terminology`,
        `- Why ${subject} matters in modern development`,
        `- Common use cases and applications`,
        "",
        `## Learning Objectives`,
        `1. Understand the core concepts of ${subject}`,
        `2. Be able to explain key terminology`,
        `3. Know where to apply ${subject} in practice`,
      ].join("\n"),
      durationMinutes: 15,
      resources: [
        { label: `${subject} - Wikipedia`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(subject)}`, type: "reference" },
      ],
    },
    {
      moduleTitle: `${subject} Fundamentals`,
      lessonTitle: `${subject} Core Practices`,
      contentMd: [
        `# ${subject} Core Practices`,
        "",
        `## Hands-On Approach`,
        `Essential practices for working with ${subject}.`,
        "",
        `## Topics Covered`,
        `- Setting up your environment`,
        `- Basic workflows and patterns`,
        `- Common pitfalls to avoid`,
        "",
        `## Exercises`,
        `1. Set up a basic ${subject} environment`,
        `2. Complete a guided walkthrough`,
        `3. Review and reflect on what you learned`,
      ].join("\n"),
      durationMinutes: 25,
      resources: [],
    },
    {
      moduleTitle: `${subject} in Practice`,
      lessonTitle: `Applying ${subject}`,
      contentMd: [
        `# Applying ${subject}`,
        "",
        `## Real-World Applications`,
        `How ${subject} is used in production environments.`,
        "",
        `## Case Studies`,
        `- Industry adoption patterns`,
        `- Common challenges and solutions`,
        "",
        `## Next Steps`,
        `- Explore advanced topics`,
        `- Build a small project using ${subject}`,
      ].join("\n"),
      durationMinutes: 20,
      resources: [],
    },
  ];
}

export async function POST(req: Request, ctx: Ctx) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const { skillId } = await ctx.params;
      const body = await req.json() as { topic?: string };
      const topic = typeof body.topic === "string" ? body.topic.slice(0, 200) : undefined;

      // Verify skill exists
      const skill = await db
        .prepare(`SELECT id, name, level FROM skill_items WHERE id = ? AND user_id = ?`)
        .bind(skillId, session.user_id)
        .first<{ id: string; name: string; level: string }>();

      if (!skill) {
        return Response.json({ ok: false, error: "Skill not found" }, { status: 404 });
      }

      // Check budget
      const budgetCheck = await checkBudget(db, session.user_id, "lessons");
      if (!budgetCheck.allowed) {
        return Response.json({
          ok: false,
          error: budgetCheck.reason,
          budget: budgetCheck.remaining,
        }, { status: 429 });
      }

      const caps: JobCaps = enforceJobCaps(DEFAULT_JOB_CAPS.lessons, budgetCheck);
      const plans = generateLessonTemplates(skill.name, skill.level, topic).slice(0, caps.maxItems);

      // Get existing dedupe keys
      const existing = await db
        .prepare(`SELECT dedupe_key FROM skill_lessons WHERE user_id = ? AND skill_id = ? AND dedupe_key IS NOT NULL`)
        .bind(session.user_id, skillId)
        .all<{ dedupe_key: string }>();
      const existingKeys = new Set((existing.results || []).map((r) => r.dedupe_key));

      // Get max order_index
      const maxOrder = await db
        .prepare(`SELECT MAX(order_index) as max_idx FROM skill_lessons WHERE user_id = ? AND skill_id = ?`)
        .bind(session.user_id, skillId)
        .first<{ max_idx: number | null }>();
      let nextOrder = (maxOrder?.max_idx ?? -1) + 1;

      const results = { added: 0, updated: 0, skipped: 0, warnings: [] as string[] };

      for (const plan of plans) {
        const dedupeKey = makeDedupe(skillId, plan.moduleTitle, plan.lessonTitle);

        if (existingKeys.has(dedupeKey)) {
          results.skipped++;
          continue;
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db
          .prepare(
            `INSERT INTO skill_lessons (id, user_id, skill_id, module_title, lesson_title, order_index, duration_minutes, content_md, resources_json, created_at, updated_at, source, dedupe_key, quality_score, generation_meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?, NULL, ?)`
          )
          .bind(
            id, session.user_id, skillId,
            plan.moduleTitle, plan.lessonTitle, nextOrder++,
            plan.durationMinutes, plan.contentMd,
            JSON.stringify(plan.resources), now, now,
            dedupeKey,
            JSON.stringify({ generator: "template", model: "none", tokensUsed: 0 })
          )
          .run();
        results.added++;
      }

      // Record usage
      if (results.added > 0) {
        await recordUsage(db, session.user_id, "lessons", "template", 0, 0);
      }

      return Response.json({
        ok: true,
        ...results,
        budget: budgetCheck.remaining,
      }, { status: results.added > 0 ? 201 : 200 });
    } catch (err) {
      return d1ErrorResponse("POST /api/skills/:skillId/lessons/auto-create", err);
    }
  });
}
