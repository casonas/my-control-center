export const runtime = "edge";
// web/app/api/jobs/refresh/route.ts — Ingest job feeds from RSS sources

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { parseFeed } from "@/lib/rss";

const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

const DEFAULT_JOB_SOURCES = [
  { name: "LinkedIn Cybersecurity Jobs RSS", type: "rss" as const, url: "https://www.linkedin.com/jobs/search/?keywords=cybersecurity&f_TPR=r604800" },
  { name: "Indeed Cybersecurity RSS", type: "rss" as const, url: "https://www.indeed.com/rss?q=cybersecurity&sort=date" },
];

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const userId = session.user_id;
    const start = Date.now();

    try {
      // Throttle
      const lastRun = await db
        .prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`)
        .bind(`jobs_refresh_${userId}`)
        .first<{ last_run_at: string }>();

      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < REFRESH_COOLDOWN_MS) {
          const waitSec = Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000);
          return Response.json({ ok: false, error: `Please wait ${waitSec}s before refreshing again` }, { status: 429 });
        }
      }

      // Ensure sources exist
      const srcResult = await db
        .prepare(`SELECT id, name, url, type FROM job_sources WHERE user_id = ? AND enabled = 1`)
        .bind(userId)
        .all<{ id: string; name: string; url: string; type: string }>();

      let sources = srcResult.results || [];

      if (sources.length === 0) {
        const now = new Date().toISOString();
        for (const src of DEFAULT_JOB_SOURCES) {
          const id = crypto.randomUUID();
          await db
            .prepare(`INSERT OR IGNORE INTO job_sources (id, user_id, name, type, url, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
            .bind(id, userId, src.name, src.type, src.url, now)
            .run();
        }
        const refreshed = await db
          .prepare(`SELECT id, name, url, type FROM job_sources WHERE user_id = ? AND enabled = 1`)
          .bind(userId)
          .all<{ id: string; name: string; url: string; type: string }>();
        sources = refreshed.results || [];
      }

      let newJobs = 0;
      const now = new Date().toISOString();

      for (const source of sources) {
        if (source.type !== "rss") continue;
        try {
          const res = await fetch(source.url, {
            signal: AbortSignal.timeout(8000),
            headers: { "User-Agent": "MCC-Jobs/1.0" },
          });
          if (!res.ok) continue;

          const xml = await res.text();
          const items = parseFeed(xml);

          for (const item of items) {
            if (!item.url || !item.title) continue;

            const id = crypto.randomUUID();
            // Extract company from title heuristic: "Role at Company" or "Role - Company"
            const companyMatch = item.title.match(/(?:at|@|-|–|—)\s*(.+?)(?:\s*\(|$)/i);
            const company = companyMatch ? companyMatch[1].trim() : "Unknown";
            const title = item.title.replace(/(?:at|@)\s*.+$/, "").trim() || item.title;

            // Dedupe key = normalized URL
            const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();

            try {
              await db
                .prepare(
                  `INSERT OR IGNORE INTO job_items
                   (id, user_id, source_id, title, company, url, posted_at, fetched_at, status, dedupe_key)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
                )
                .bind(id, userId, source.id, title, company, item.url, item.publishedAt, now, dedupeKey)
                .run();
              newJobs++;
            } catch {
              // Duplicate — expected
            }
          }
        } catch {
          // Feed fetch failed — continue
        }
      }

      // Update cron_runs
      await db
        .prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
        .bind(`jobs_refresh_${userId}`, now, newJobs)
        .run();

      return Response.json({ ok: true, newJobs, sources: sources.length, tookMs: Date.now() - start });
    } catch (err) {
      return d1ErrorResponse("POST /api/jobs/refresh", err);
    }
  });
}

