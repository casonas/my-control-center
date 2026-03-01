export const runtime = "edge";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * "Think Like Me" Engine — Next Actions API
 *
 * Computes the top-5 next actions based on:
 *   1. Deadline proximity (assignments due soon)
 *   2. Incomplete skill lessons (spaced repetition)
 *   3. Unread research articles
 *   4. Job postings not yet applied to
 *   5. Time-of-day patterns (morning = school, evening = research)
 *
 * MVP: rule-based scoring. Production: add user_events feedback loop
 * to learn which suggestions the user acts on vs. dismisses.
 */

interface NextAction {
  id: string;
  title: string;
  reasoning: string;
  sourceType: "deadline" | "skill_gap" | "unread" | "job_apply" | "pattern";
  sourceId: string | null;
  confidence: number;
  priority: number;
  tab: string;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // In production this reads from D1 tables and user_events.
  // MVP: generate rule-based suggestions from time-of-day heuristics.
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sunday

  const actions: NextAction[] = [];

  // Rule 1: Morning focus on school (weekdays 6-12)
  if (hour >= 6 && hour < 12 && dayOfWeek >= 1 && dayOfWeek <= 5) {
    actions.push({
      id: "na-school-morning",
      title: "Review upcoming assignments",
      reasoning: "It's a weekday morning — prime time for academic work.",
      sourceType: "pattern",
      sourceId: null,
      confidence: 0.85,
      priority: 1,
      tab: "school",
    });
  }

  // Rule 2: Afternoon skill building (13-17)
  if (hour >= 13 && hour < 17) {
    actions.push({
      id: "na-skill-afternoon",
      title: "Continue your next skill lesson",
      reasoning: "Afternoon sessions are best for hands-on learning. Spaced repetition works.",
      sourceType: "skill_gap",
      sourceId: null,
      confidence: 0.75,
      priority: 2,
      tab: "skills",
    });
  }

  // Rule 3: Evening research (18-23)
  if (hour >= 18 && hour < 23) {
    actions.push({
      id: "na-research-evening",
      title: "Catch up on unread articles",
      reasoning: "Evening is ideal for reading and deep dives.",
      sourceType: "unread",
      sourceId: null,
      confidence: 0.7,
      priority: 3,
      tab: "research",
    });
  }

  // Rule 4: Job applications (always relevant)
  actions.push({
    id: "na-jobs-apply",
    title: "Apply to saved job postings",
    reasoning: "You have saved positions waiting. Consistent applications increase success.",
    sourceType: "job_apply",
    sourceId: null,
    confidence: 0.65,
    priority: 4,
    tab: "jobs",
  });

  // Rule 5: Check sports on weekends or evenings
  if (dayOfWeek === 0 || dayOfWeek === 6 || hour >= 19) {
    actions.push({
      id: "na-sports-check",
      title: "Check today's scores and lines",
      reasoning: "Games are typically on evenings and weekends.",
      sourceType: "pattern",
      sourceId: null,
      confidence: 0.6,
      priority: 5,
      tab: "sports",
    });
  }

  // Sort by priority, take top 5
  actions.sort((a, b) => a.priority - b.priority);
  const top5 = actions.slice(0, 5);

  return NextResponse.json({
    actions: top5,
    generatedAt: now.toISOString(),
    engine: "rules-v1",
  });
}
