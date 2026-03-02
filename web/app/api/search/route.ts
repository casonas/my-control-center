export const runtime = "edge";
// web/app/api/search/route.ts — Global search across D1 collections

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

interface SearchResult {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  href: string;
  type: string;
}

/**
 * GET /api/search?q=...&scope=all|notes|jobs|research|chat
 * Returns grouped search results.
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const scope = url.searchParams.get("scope") || "all";

    if (!q) {
      return Response.json({ q: "", results: {} });
    }

    const db = getD1();
    if (!db) {
      // No D1 — return empty results
      return Response.json({ q, results: {}, note: "D1 not available" });
    }

    const results: Record<string, SearchResult[]> = {};
    const pattern = `%${q}%`;

    try {
      // Notes
      if (scope === "all" || scope === "notes") {
        const notes = await db
          .prepare(
            `SELECT id, title, content, updated_at FROM notes
             WHERE title LIKE ? OR content LIKE ?
             ORDER BY updated_at DESC LIMIT 10`
          )
          .bind(pattern, pattern)
          .all<{ id: string; title: string; content: string; updated_at: string }>();
        results.notes = (notes.results || []).map((n) => ({
          id: n.id,
          title: n.title,
          preview: (n.content || "").slice(0, 80),
          updated_at: n.updated_at,
          href: "/notes",
          type: "note",
        }));
      }

      // Assignments
      if (scope === "all" || scope === "school") {
        const assignments = await db
          .prepare(
            `SELECT id, title, course, created_at FROM assignments
             WHERE title LIKE ? OR course LIKE ?
             ORDER BY created_at DESC LIMIT 10`
          )
          .bind(pattern, pattern)
          .all<{ id: string; title: string; course: string; created_at: string }>();
        results.assignments = (assignments.results || []).map((a) => ({
          id: a.id,
          title: a.title,
          preview: a.course,
          updated_at: a.created_at,
          href: "/school",
          type: "assignment",
        }));
      }

      // Jobs
      if (scope === "all" || scope === "jobs") {
        const jobs = await db
          .prepare(
            `SELECT id, title, company, location, saved_at FROM jobs
             WHERE title LIKE ? OR company LIKE ?
             ORDER BY saved_at DESC LIMIT 10`
          )
          .bind(pattern, pattern)
          .all<{ id: string; title: string; company: string; location: string; saved_at: string }>();
        results.jobs = (jobs.results || []).map((j) => ({
          id: j.id,
          title: `${j.title} — ${j.company}`,
          preview: j.location,
          updated_at: j.saved_at,
          href: "/jobs",
          type: "job",
        }));
      }

      // Research
      if (scope === "all" || scope === "research") {
        const research = await db
          .prepare(
            `SELECT id, title, source, url, saved_at FROM research
             WHERE title LIKE ? OR source LIKE ?
             ORDER BY saved_at DESC LIMIT 10`
          )
          .bind(pattern, pattern)
          .all<{ id: string; title: string; source: string; url: string; saved_at: string }>();
        results.research = (research.results || []).map((r) => ({
          id: r.id,
          title: r.title,
          preview: r.source,
          updated_at: r.saved_at,
          href: r.url || "/research",
          type: "research",
        }));
      }

      // Chat sessions
      if (scope === "all" || scope === "chat") {
        const sessions = await db
          .prepare(
            `SELECT id, title, agent_id, updated_at FROM chat_sessions
             WHERE user_id = ? AND title LIKE ?
             ORDER BY updated_at DESC LIMIT 10`
          )
          .bind(userId, pattern)
          .all<{ id: string; title: string; agent_id: string; updated_at: string }>();
        results.sessions = (sessions.results || []).map((s) => ({
          id: s.id,
          title: s.title,
          preview: `Agent: ${s.agent_id}`,
          updated_at: s.updated_at,
          href: "/chat",
          type: "session",
        }));
      }

      return Response.json({ q, results });
    } catch (err) {
      console.error("[search] D1 error:", err);
      return Response.json({ q, results: {}, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
