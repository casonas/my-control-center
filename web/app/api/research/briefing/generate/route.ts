export const runtime = "edge";
// web/app/api/research/briefing/generate/route.ts — Generate briefing (rule-based fallback)

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { generateRuleBasedBriefing } from "@/lib/rss";

/**
 * POST /api/research/briefing/generate?scope=daily|theme|entity
 * Body: { theme?: string, entity_id?: string }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    const userId = session.user_id;
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") || "daily";

    try {
      const body = await req.json().catch(() => ({})) as { theme?: string; entity_id?: string };

      let items: { title: string; score: number; urgency: string; url: string; tags_json?: string }[];

      if (scope === "entity" && body.entity_id) {
        // Entity-focused briefing
        const result = await db
          .prepare(
            `SELECT ri.title, ri.score, ri.urgency, ri.url, ri.tags_json
             FROM research_items ri
             INNER JOIN research_item_entities rie ON rie.item_id = ri.id
             WHERE ri.user_id = ? AND rie.entity_id = ?
             ORDER BY ri.score DESC LIMIT 20`
          )
          .bind(userId, body.entity_id)
          .all<{ title: string; score: number; urgency: string; url: string; tags_json?: string }>();
        items = result.results || [];
      } else if (scope === "theme" && body.theme) {
        // Theme-focused briefing
        const result = await db
          .prepare(
            `SELECT title, score, urgency, url, tags_json
             FROM research_items
             WHERE user_id = ? AND (title LIKE ? OR summary LIKE ?)
             ORDER BY score DESC LIMIT 20`
          )
          .bind(userId, `%${body.theme}%`, `%${body.theme}%`)
          .all<{ title: string; score: number; urgency: string; url: string; tags_json?: string }>();
        items = result.results || [];
      } else {
        // Daily briefing — top scored items from last 24h
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const result = await db
          .prepare(
            `SELECT title, score, urgency, url, tags_json
             FROM research_items
             WHERE user_id = ? AND fetched_at >= ?
             ORDER BY score DESC LIMIT 30`
          )
          .bind(userId, since)
          .all<{ title: string; score: number; urgency: string; url: string; tags_json?: string }>();
        items = result.results || [];
      }

      // Generate rule-based briefing (cost: $0)
      const bodyMd = generateRuleBasedBriefing(items);
      const title = scope === "daily"
        ? `Daily Brief — ${new Date().toISOString().slice(0, 10)}`
        : scope === "theme"
          ? `Deep Dive: ${body.theme || "Unknown"}`
          : `Entity Brief: ${body.entity_id || "Unknown"}`;

      // Save briefing
      const briefingId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT INTO research_briefings (id, user_id, title, scope, body_md, model_used, created_at)
           VALUES (?, ?, ?, ?, ?, 'rule-based', ?)`
        )
        .bind(briefingId, userId, title, scope, bodyMd, now)
        .run();

      return Response.json({
        ok: true,
        briefing: {
          id: briefingId,
          title,
          scope,
          body_md: bodyMd,
          model_used: "rule-based",
          created_at: now,
        },
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/research/briefing/generate", err);
    }
  });
}
