export const runtime = "edge";
// web/app/api/admin/cron/route.ts — Admin cron status + manual trigger

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { runCronJob, CRON_SCHEDULES, type CronJobName } from "@/lib/cron";

/**
 * GET /api/admin/cron — returns cron_runs status for all jobs
 */
export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ jobs: [], note: "D1 not available" });

    try {
      // Get all cron_runs rows for this user (pattern: jobname_userId)
      const result = await db
        .prepare(`SELECT * FROM cron_runs WHERE job_name LIKE ? ORDER BY last_run_at DESC`)
        .bind(`%_${userId}`)
        .all();

      const jobs = (result.results || []).map((row: Record<string, unknown>) => {
        const jobName = String(row.job_name || "").replace(`_${userId}`, "");
        const schedule = CRON_SCHEDULES[jobName];
        return {
          jobName,
          fullKey: row.job_name,
          lastRunAt: row.last_run_at,
          status: row.status,
          itemsProcessed: row.items_processed,
          tookMs: row.took_ms,
          error: row.error,
          updatedAt: row.updated_at,
          cron: schedule?.cron ?? null,
          description: schedule?.description ?? null,
        };
      });

      // Add entries for jobs that haven't run yet
      const existingKeys = new Set(jobs.map((j: { jobName: string }) => j.jobName));
      for (const [name, schedule] of Object.entries(CRON_SCHEDULES)) {
        if (!existingKeys.has(name)) {
          jobs.push({
            jobName: name,
            fullKey: `${name}_${userId}`,
            lastRunAt: null,
            status: null,
            itemsProcessed: 0,
            tookMs: null,
            error: null,
            updatedAt: null,
            cron: schedule.cron,
            description: schedule.description,
          });
        }
      }

      return Response.json({ jobs });
    } catch (err) {
      return d1ErrorResponse("GET /api/admin/cron", err);
    }
  });
}

const VALID_JOBS: CronJobName[] = [
  "research_scan", "jobs_refresh", "stocks_refresh",
  "stocks_news_scan", "sports_refresh_nba", "sports_refresh_nfl",
  "skills_radar_scan",
];

/**
 * POST /api/admin/cron — run a job manually
 * Body: { jobName: string }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as { jobName?: string };
      const jobName = body.jobName as CronJobName;

      if (!jobName || !VALID_JOBS.includes(jobName)) {
        return Response.json(
          { ok: false, error: `Invalid job name. Valid: ${VALID_JOBS.join(", ")}` },
          { status: 400 }
        );
      }

      const result = await runCronJob(db, session.user_id, jobName);
      return Response.json({ ok: true, jobName, result });
    } catch (err) {
      return d1ErrorResponse("POST /api/admin/cron", err);
    }
  });
}
