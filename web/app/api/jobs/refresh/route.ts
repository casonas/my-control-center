export const runtime = "edge";
// web/app/api/jobs/refresh/route.ts — Ingest job feeds from RSS sources + score

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { parseFeed } from "@/lib/rss";
import { scoreJob, detectRemoteFlag } from "@/lib/jobScoring";
import { DEFAULT_JOB_SOURCES, canonicalizeUrl } from "@/lib/jobSources";

const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 8000;

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

      let fetched = 0;
      let inserted = 0;
      let deduped = 0;
      let scored = 0;
      let failedSources = 0;
      const now = new Date().toISOString();

      for (const source of sources) {
        if (source.type !== "rss") continue;
        try {
          const res = await fetch(source.url, {
            signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
            headers: { "User-Agent": "MCC-Jobs/1.0" },
          });
          if (!res.ok) { failedSources++; continue; }

          const xml = await res.text();
          const items = parseFeed(xml);

          for (const item of items) {
            if (!item.url || !item.title) continue;
            fetched++;

            const id = crypto.randomUUID();
            // Extract company from title heuristic: "Role at Company" or "Role - Company"
            const companyMatch = item.title.match(/(?:at|@|-|–|—)\s*(.+?)(?:\s*\(|$)/i);
            const company = companyMatch ? companyMatch[1].trim() : "Unknown";
            const title = item.title.replace(/(?:at|@)\s*.+$/, "").trim() || item.title;
            const location = item.summary?.match(/(?:Location|loc):\s*([^,\n]+)/i)?.[1]?.trim() || null;

            // Dedupe key = canonicalized URL
            const dedupeKey = canonicalizeUrl(item.url);

            // Score the job
            const remoteFlag = detectRemoteFlag(title, location);
            const scoring = scoreJob(title, company, location, remoteFlag);

            try {
              await db
                .prepare(
                  `INSERT OR IGNORE INTO job_items
                   (id, user_id, source_id, title, company, location, url, posted_at, fetched_at, status, dedupe_key, match_score, why_match, tags_json, remote_flag)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`
                )
                .bind(id, userId, source.id, title, company, location, item.url, item.publishedAt, now, dedupeKey,
                  scoring.match_score, scoring.why_match, scoring.tags_json, remoteFlag)
                .run();
              inserted++;
              scored++;
            } catch {
              deduped++;
            }
          }
        } catch {
          failedSources++;
        }
      }

      // Score any existing unscored jobs
      try {
        const unscored = await db
          .prepare(`SELECT id, title, company, location, remote_flag FROM job_items WHERE user_id = ? AND (match_score IS NULL OR match_score = 0) LIMIT 100`)
          .bind(userId)
          .all<{ id: string; title: string; company: string; location: string | null; remote_flag: string | null }>();

        for (const job of (unscored.results || [])) {
          const scoring = scoreJob(job.title, job.company, job.location, job.remote_flag);
          const rf = job.remote_flag || detectRemoteFlag(job.title, job.location);
          await db
            .prepare(`UPDATE job_items SET match_score = ?, why_match = ?, tags_json = ?, remote_flag = ? WHERE id = ? AND user_id = ?`)
            .bind(scoring.match_score, scoring.why_match, scoring.tags_json, rf, job.id, userId)
            .run();
          scored++;
        }
      } catch {
        // Non-critical: scoring of old items can fail gracefully
      }

      const tookMs = Date.now() - start;

      // Update cron_runs
      await db
        .prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
        .bind(`jobs_refresh_${userId}`, now, inserted)
        .run();

      return Response.json({
        ok: true,
        fetched,
        inserted,
        deduped,
        scored,
        failedSources,
        sources: sources.length,
        tookMs,
        newJobs: inserted,
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/jobs/refresh", err);
    }
  });
}

