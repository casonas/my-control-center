export const runtime = "edge";
// web/app/api/internal/lessons/generate/route.ts
//
// POST /api/internal/lessons/generate
// Input:  { userId, skillId, topic?, mode: "dry_run" | "apply" }
// Output: { added, updated, skipped, warnings, budget }
//
// Deterministic upsert logic with dedupe protection.
// Budget-aware: checks daily limits before LLM calls.
// Called by cron worker (HMAC auth) or admin panel.

import { withHmacAuth } from "@/lib/hmacAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import {
  checkBudget,
  recordUsage,
  enforceJobCaps,
  DEFAULT_JOB_CAPS,
  type JobCaps,
} from "@/lib/budget";
import {
  acquireIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  makeIdempotencyKey,
} from "@/lib/idempotency";

interface GenerateRequest {
  userId: string;
  skillId: string;
  topic?: string;
  mode: "dry_run" | "apply";
}

interface LessonPlan {
  moduleTitle: string;
  lessonTitle: string;
  contentMd: string;
  durationMinutes: number;
  resources: { label: string; url: string; type: string }[];
}

function validateInput(body: unknown): GenerateRequest {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== "object") throw new Error("Invalid request body");
  if (typeof b.userId !== "string" || b.userId.length === 0) throw new Error("userId is required");
  if (typeof b.skillId !== "string" || b.skillId.length === 0) throw new Error("skillId is required");
  if (b.mode !== "dry_run" && b.mode !== "apply") throw new Error("mode must be 'dry_run' or 'apply'");
  return {
    userId: b.userId,
    skillId: b.skillId,
    topic: typeof b.topic === "string" ? b.topic.slice(0, 200) : undefined,
    mode: b.mode,
  };
}

function makeDedupe(skillId: string, moduleTitle: string, lessonTitle: string): string {
  const raw = `${skillId}:${moduleTitle}:${lessonTitle}`.toLowerCase().replace(/\s+/g, "_");
  return raw.slice(0, 200);
}

/**
 * Generate lesson plans without LLM (template-based, zero cost).
 * Uses the skill name + topic to create structured lesson outlines.
 */
function generateLessonTemplates(skillName: string, level: string, topic?: string): LessonPlan[] {
  const subject = topic || skillName;
  const modules: LessonPlan[] = [
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
        `## Prerequisites`,
        level === "beginner" ? "- No prior experience required" : `- Basic understanding of ${skillName}`,
        "",
        `## Learning Objectives`,
        `By the end of this lesson, you will:`,
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
        `This lesson walks through the essential practices for ${subject}.`,
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
      lessonTitle: `Applying ${subject} — Real-World Scenarios`,
      contentMd: [
        `# Applying ${subject}`,
        "",
        `## Real-World Applications`,
        `Learn how ${subject} is used in production environments.`,
        "",
        `## Case Studies`,
        `- Industry adoption patterns`,
        `- Success stories and lessons learned`,
        `- Common challenges and solutions`,
        "",
        `## Next Steps`,
        `- Explore advanced topics`,
        `- Build a small project using ${subject}`,
        `- Join community discussions`,
      ].join("\n"),
      durationMinutes: 20,
      resources: [],
    },
  ];
  return modules;
}

export async function POST(req: Request) {
  return withHmacAuth(req, async () => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    let input: GenerateRequest;
    try {
      const body = await req.json();
      input = validateInput(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid input";
      return Response.json({ ok: false, error: msg }, { status: 400 });
    }

    try {
      // Verify skill exists
      const skill = await db
        .prepare(`SELECT id, name, level FROM skill_items WHERE id = ? AND user_id = ?`)
        .bind(input.skillId, input.userId)
        .first<{ id: string; name: string; level: string }>();

      if (!skill) {
        return Response.json({ ok: false, error: "Skill not found" }, { status: 404 });
      }

      // Check budget
      const budgetCheck = await checkBudget(db, input.userId, "lessons");
      if (!budgetCheck.allowed) {
        return Response.json({
          ok: false,
          error: budgetCheck.reason,
          budget: budgetCheck.remaining,
        }, { status: 429 });
      }

      const caps: JobCaps = enforceJobCaps(DEFAULT_JOB_CAPS.lessons, budgetCheck);

      // Generate lesson plans (template-based, no LLM cost)
      const plans = generateLessonTemplates(skill.name, skill.level, input.topic)
        .slice(0, caps.maxItems);

      // dry_run: return plan without writing anything
      if (input.mode === "dry_run") {
        // Get existing lessons for dedupe check
        const existing = await db
          .prepare(`SELECT dedupe_key FROM skill_lessons WHERE user_id = ? AND skill_id = ? AND dedupe_key IS NOT NULL`)
          .bind(input.userId, input.skillId)
          .all<{ dedupe_key: string }>();
        const existingKeys = new Set((existing.results || []).map((r) => r.dedupe_key));

        let wouldAdd = 0;
        let wouldSkip = 0;
        for (const plan of plans) {
          const dk = makeDedupe(input.skillId, plan.moduleTitle, plan.lessonTitle);
          if (existingKeys.has(dk)) { wouldSkip++; } else { wouldAdd++; }
        }
        return Response.json({
          ok: true,
          mode: "dry_run",
          added: wouldAdd,
          updated: 0,
          skipped: wouldSkip,
          warnings: [],
          budget: budgetCheck.remaining,
        });
      }

      // apply mode — use idempotency key to prevent duplicate runs
      const idemKey = makeIdempotencyKey("lesson_gen", input.userId, input.skillId, input.topic ?? "default");
      const idem = await acquireIdempotencyKey(db, idemKey, 600);
      if (!idem.acquired) {
        return Response.json({
          ok: true,
          mode: "apply",
          added: 0, updated: 0, skipped: 0,
          warnings: ["Duplicate request — already processed or in progress"],
          cached: idem.existing?.result_json ? JSON.parse(idem.existing.result_json) : null,
          budget: budgetCheck.remaining,
        });
      }

      try {
        // Get existing lessons for dedupe
        const existing = await db
          .prepare(`SELECT dedupe_key FROM skill_lessons WHERE user_id = ? AND skill_id = ? AND dedupe_key IS NOT NULL`)
          .bind(input.userId, input.skillId)
          .all<{ dedupe_key: string }>();
        const existingKeys = new Set((existing.results || []).map((r) => r.dedupe_key));

        // Get max order_index
        const maxOrder = await db
          .prepare(`SELECT MAX(order_index) as max_idx FROM skill_lessons WHERE user_id = ? AND skill_id = ?`)
          .bind(input.userId, input.skillId)
          .first<{ max_idx: number | null }>();
        let nextOrder = (maxOrder?.max_idx ?? -1) + 1;

        const results = { added: 0, updated: 0, skipped: 0, warnings: [] as string[] };

        for (const plan of plans) {
          const dedupeKey = makeDedupe(input.skillId, plan.moduleTitle, plan.lessonTitle);

          if (existingKeys.has(dedupeKey)) {
            // Only update auto-generated lessons — never overwrite manual edits
            await db
              .prepare(
                `UPDATE skill_lessons SET content_md = ?, resources_json = ?, duration_minutes = ?, updated_at = ?
                 WHERE user_id = ? AND skill_id = ? AND dedupe_key = ? AND (source = 'auto' OR source IS NULL)`
              )
              .bind(
                plan.contentMd,
                JSON.stringify(plan.resources),
                plan.durationMinutes,
                new Date().toISOString(),
                input.userId,
                input.skillId,
                dedupeKey
              )
              .run();
            results.updated++;
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
              id, input.userId, input.skillId,
              plan.moduleTitle, plan.lessonTitle, nextOrder++,
              plan.durationMinutes, plan.contentMd,
              JSON.stringify(plan.resources), now, now,
              dedupeKey,
              JSON.stringify({ generator: "template", model: "none", tokensUsed: 0 })
            )
            .run();
          results.added++;
        }

        // Record zero-cost usage for tracking
        if (results.added > 0) {
          await recordUsage(db, input.userId, "lessons", "template", 0, 0);
        }

        const response = { ok: true, mode: "apply", ...results, budget: budgetCheck.remaining };
        await completeIdempotencyKey(db, idemKey, response);
        return Response.json(response);
      } catch (err) {
        await releaseIdempotencyKey(db, idemKey).catch(() => {});
        throw err;
      }
    } catch (err) {
      return d1ErrorResponse("POST /api/internal/lessons/generate", err);
    }
  });
}
