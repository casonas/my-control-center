import type { D1Database } from "./d1";

type CronRunInput = {
  jobName: string;
  lastRunAt?: string;
  status: string;
  itemsProcessed: number;
  tookMs?: number | null;
  error?: string | null;
  updatedAt?: string;
};

/**
 * Writes cron_runs with backward compatibility:
 * - New schema: includes took_ms + updated_at
 * - Old schema: only basic columns
 */
export async function upsertCronRun(db: D1Database, input: CronRunInput): Promise<void> {
  const now = new Date().toISOString();
  const lastRunAt = input.lastRunAt || now;
  const updatedAt = input.updatedAt || now;

  try {
    await db.prepare(
      `INSERT OR REPLACE INTO cron_runs
       (job_name, last_run_at, status, items_processed, took_ms, error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.jobName,
      lastRunAt,
      input.status,
      input.itemsProcessed,
      input.tookMs ?? null,
      input.error ?? null,
      updatedAt,
    ).run();
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/no such column|has no column/i.test(msg)) throw err;
  }

  await db.prepare(
    `INSERT OR REPLACE INTO cron_runs
     (job_name, last_run_at, status, items_processed, error)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(
    input.jobName,
    lastRunAt,
    input.status,
    input.itemsProcessed,
    input.error ?? null,
  ).run();
}

