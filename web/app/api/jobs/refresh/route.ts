export const runtime = "edge";
// web/app/api/jobs/refresh/route.ts — Ingest job feeds from RSS sources + score

import { withMutatingOrInternalAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { apiError, apiJson } from "@/lib/apiJson";
import { parseFeed } from "@/lib/rss";
import { scoreJob, detectRemoteFlag } from "@/lib/jobScoring";
import { DEFAULT_JOB_SOURCES, buildDedupeKey, fetchWithRetry } from "@/lib/jobSources";

const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

export async function POST(req: Request) {
  return withMutatingOrInternalAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return apiError("D1 not available", 500);

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
          return apiError(`Please wait ${waitSec}s before refreshing again`, 429);
        }
      }

      // Ensure sources exist
      const srcResult = await db
        .prepare(`SELECT id, name, url, type FROM job_sources WHERE user_id = ? AND enabled = 1`)
        .bind(userId)
        .all<{ id: string; name: string; url: string; type: string }>();

      let sources = srcResult.results || [];

      // Always upsert missing defaults so users don't get stuck with one source.
      const seededAt = new Date().toISOString();
      for (const src of DEFAULT_JOB_SOURCES) {
        await db
          .prepare(`INSERT OR IGNORE INTO job_sources (id, user_id, name, type, url, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
          .bind(crypto.randomUUID(), userId, src.name, src.type, src.url, seededAt)
          .run();
      }
      const refreshed = await db
        .prepare(`SELECT id, name, url, type FROM job_sources WHERE user_id = ? AND enabled = 1`)
        .bind(userId)
        .all<{ id: string; name: string; url: string; type: string }>();
      sources = refreshed.results || sources;

      let fetched = 0;
      let inserted = 0;
      let deduped = 0;
      let scored = 0;
      let failedSources = 0;
      const now = new Date().toISOString();

      // Process each source independently — one failure does NOT abort others
      for (const source of sources) {
        if (source.type !== "rss") continue;
        try {
          // Per-source timeout + single retry with jitter
          const res = await fetchWithRetry(source.url, 8000);
          if (!res) { failedSources++; continue; }

          const xml = await res.text();
          const items = parseFeed(xml);

          for (const item of items) {
            if (!item.url || !item.title) continue;
            fetched++;

            const id = crypto.randomUUID();
            const summaryText = item.summary || "";
            const companyFromSummary =
              summaryText.match(/\bcompany\s*:\s*([^|\n\r<]+)/i)?.[1]?.trim() ||
              summaryText.match(/\bemployer\s*:\s*([^|\n\r<]+)/i)?.[1]?.trim() ||
              summaryText.match(/\bat\s+([A-Z][\w&.,' -]{1,80})/i)?.[1]?.trim() ||
              null;
            const companyMatch = item.title.match(/(?:at|@|-|–|—)\s*(.+?)(?:\s*\(|$)/i);
            let company = companyFromSummary || (companyMatch ? companyMatch[1].trim() : "Unknown");
            if (/^weworkremotely$/i.test(company)) company = "Unknown";
            const title = item.title.replace(/(?:at|@)\s*.+$/, "").trim() || item.title;
            const location = item.summary?.match(/(?:Location|loc):\s*([^,\n]+)/i)?.[1]?.trim() || null;

            // Deterministic dedupe: hash(canonical_url + normalized_title + normalized_company)
            const dedupeKey = buildDedupeKey(item.url, title, company);

            const remoteFlag = detectRemoteFlag(title, location);
            const scoring = scoreJob(title, company, location, remoteFlag);

            // INSERT OR IGNORE: preserves existing rows — never overwrites saved/applied/etc status
            try {
              const insertResult = await db
                .prepare(
                  `INSERT OR IGNORE INTO job_items
                   (id, user_id, source_id, title, company, location, url, posted_at, fetched_at, status, dedupe_key, match_score, why_match, match_factors_json, tags_json, remote_flag)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`
                )
                .bind(id, userId, source.id, title, company, location, item.url, item.publishedAt, now, dedupeKey,
                  scoring.match_score, scoring.why_match, scoring.match_factors_json, scoring.tags_json, remoteFlag)
                .run();
              const changes = Number((insertResult.meta as { changes?: unknown } | undefined)?.changes ?? 0);
              if (changes > 0) {
                inserted++;
                scored++;
              } else {
                deduped++;
              }
            } catch {
              deduped++;
            }
          }
        } catch {
          // Source-level failure — continue to next source
          failedSources++;
        }
      }

      // Score any existing unscored jobs (backfill, throttled to 100 per refresh)
      try {
        const unscored = await db
          .prepare(`SELECT id, title, company, location, remote_flag FROM job_items WHERE user_id = ? AND (match_score IS NULL OR match_score = 0) LIMIT 100`)
          .bind(userId)
          .all<{ id: string; title: string; company: string; location: string | null; remote_flag: string | null }>();

        for (const job of (unscored.results || [])) {
          const scoring = scoreJob(job.title, job.company, job.location, job.remote_flag);
          const rf = job.remote_flag || detectRemoteFlag(job.title, job.location);
          await db
            .prepare(`UPDATE job_items SET match_score = ?, why_match = ?, match_factors_json = ?, tags_json = ?, remote_flag = ? WHERE id = ? AND user_id = ?`)
            .bind(scoring.match_score, scoring.why_match, scoring.match_factors_json, scoring.tags_json, rf, job.id, userId)
            .run();
          scored++;
        }
      } catch {
        // Non-critical: scoring of old items can fail gracefully
      }

      const tookMs = Date.now() - start;

      // Update cron_runs — record success even if some sources failed
      const cronStatus = failedSources > 0 && inserted === 0 ? "partial" : "success";
      await db
        .prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, ?, ?, ?)`)
        .bind(`jobs_refresh_${userId}`, now, cronStatus, inserted,
          failedSources > 0 ? `${failedSources} source(s) failed` : null)
        .run();

      const sourceHealth = [
        {
          name: "job-rss-sources",
          status: failedSources > 0 ? (inserted > 0 ? "partial" : "error") : "ok",
          latencyMs: Date.now() - start,
          error: failedSources > 0 ? `${failedSources} source(s) failed` : undefined,
        },
      ];

      return apiJson({
        ok: true,
        status: cronStatus === "success" ? "ok" : "partial",
        fetched,
        inserted,
        deduped,
        scored,
        failedSources,
        sources: sources.length,
        tookMs,
        newJobs: inserted,
        sourceHealth,
        staleFallbackUsed: false,
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/jobs/refresh", err);
    }
  });
}
