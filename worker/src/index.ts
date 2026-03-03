// worker/src/index.ts — Cloudflare Worker with cron triggers
//
// This worker runs on a schedule to execute scan/refresh jobs for all users.
// It accesses D1 directly (same binding as Pages) and requires CRON_SECRET.
//
// Deploy: cd worker && npx wrangler deploy
// Test locally: npx wrangler dev --test-scheduled

export interface Env {
  DB: D1Database;
  CRON_SECRET: string;
}

// ─── Cron schedule → job mapping ─────────────────────
// Cloudflare cron triggers call the scheduled() handler.
// We map cron expressions to job names based on schedule patterns.
const SCHEDULE_MAP: Record<string, string[]> = {
  // Hourly jobs (minute 0)
  "research_scan": ["0 * * * *"],
  // Stocks refresh every 10 min
  "stocks_refresh": ["*/10 * * * *"],
  // Stocks news hourly at :15
  "stocks_news_scan": ["15 * * * *"],
  // Skills radar daily at 8am
  "skills_radar_scan": ["0 8 * * *"],
  // Jobs refresh weekdays
  "jobs_refresh": ["0 9,13,18 * * 1-5"],
  // Sports every 15 min
  "sports_refresh_nba": ["*/15 * * * *"],
};

// Determine which jobs to run based on the cron trigger expression
function getJobsForCron(cron: string): string[] {
  const jobs: string[] = [];
  for (const [job, crons] of Object.entries(SCHEDULE_MAP)) {
    if (crons.includes(cron)) {
      jobs.push(job);
    }
  }
  // If no exact match, run a sensible default set based on frequency
  if (jobs.length === 0) {
    // For the generic triggers in wrangler.toml, run all applicable jobs
    return ["research_scan", "jobs_refresh", "stocks_refresh", "stocks_news_scan", "skills_radar_scan", "sports_refresh_nba"];
  }
  return jobs;
}

// ─── Shared job runner (mirrors lib/cron.ts logic) ───
// We inline minimal versions here since Workers can't import from Pages lib/.
// In production, you'd use a shared package or call internal APIs.

async function getAllUserIds(db: D1Database): Promise<string[]> {
  try {
    const result = await db.prepare(`SELECT DISTINCT user_id FROM user_settings LIMIT 100`).all();
    return (result.results || []).map((r: Record<string, unknown>) => String(r.user_id));
  } catch {
    return [];
  }
}

async function updateCronRun(
  db: D1Database,
  jobName: string,
  result: { status: string; itemsProcessed: number; tookMs: number; error?: string | null }
) {
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, took_ms, error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(jobName, now, result.status, result.itemsProcessed, result.tookMs, result.error ?? null, now)
      .run();
  } catch (e) {
    console.error(`[cron] Failed to update cron_runs for ${jobName}:`, e);
  }
}

// Minimal RSS parser for Worker context (no external deps)
function parseFeedItems(xml: string): { title: string; url: string; publishedAt: string | null; summary: string | null }[] {
  const items: { title: string; url: string; publishedAt: string | null; summary: string | null }[] = [];
  // Match <item> or <entry> blocks
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() || "";
    const link = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ||
                 block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ||
                 block.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i)?.[1]?.trim() || "";
    const pubDate = block.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i)?.[1]?.trim() || null;
    const desc = block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim().slice(0, 400) || null;
    if (title && link) {
      items.push({ title, url: link, publishedAt: pubDate, summary: desc });
    }
  }
  return items;
}

async function runResearchScan(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  let newItems = 0, sourcesFailed = 0;
  const sources = await db.prepare(`SELECT id, url FROM research_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all();
  const now = new Date().toISOString();
  for (const src of (sources.results || [])) {
    try {
      const res = await fetch(String(src.url), { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Cron/1.0" } });
      if (!res.ok) { sourcesFailed++; continue; }
      const xml = await res.text();
      for (const item of parseFeedItems(xml)) {
        if (!item.url || !item.title) continue;
        try {
          await db.prepare(`INSERT OR IGNORE INTO research_items (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0)`)
            .bind(crypto.randomUUID(), userId, String(src.id), item.title, item.url, item.publishedAt, now, item.summary).run();
          newItems++;
        } catch { /* dedupe */ }
      }
    } catch { sourcesFailed++; }
  }
  return { items: newItems, failed: sourcesFailed };
}

async function runStocksNewsScan(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  const feeds = [
    { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
    { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
  ];
  let newItems = 0, sourcesFailed = 0;
  const now = new Date().toISOString();
  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Cron/1.0" } });
      if (!res.ok) { sourcesFailed++; continue; }
      const xml = await res.text();
      for (const item of parseFeedItems(xml)) {
        if (!item.url || !item.title) continue;
        const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
        try {
          await db.prepare(`INSERT OR IGNORE INTO stock_news_items (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?)`)
            .bind(crypto.randomUUID(), userId, item.title.slice(0, 300), feed.name, item.url, item.publishedAt, now, item.summary?.slice(0, 400) || null, dedupeKey).run();
          newItems++;
        } catch { /* dedupe */ }
      }
    } catch { sourcesFailed++; }
  }
  return { items: newItems, failed: sourcesFailed };
}

async function runJobsRefresh(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  let newJobs = 0, sourcesFailed = 0;
  const sources = await db.prepare(`SELECT id, url, type FROM job_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all();
  const now = new Date().toISOString();
  for (const src of (sources.results || [])) {
    if (String(src.type) !== "rss") continue;
    try {
      const res = await fetch(String(src.url), { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Cron/1.0" } });
      if (!res.ok) { sourcesFailed++; continue; }
      const xml = await res.text();
      for (const item of parseFeedItems(xml)) {
        if (!item.url || !item.title) continue;
        const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
        try {
          await db.prepare(`INSERT OR IGNORE INTO job_items (id, user_id, source_id, title, company, url, posted_at, fetched_at, status, dedupe_key) VALUES (?, ?, ?, ?, 'Unknown', ?, ?, ?, 'new', ?)`)
            .bind(crypto.randomUUID(), userId, String(src.id), item.title, item.url, item.publishedAt, now, dedupeKey).run();
          newJobs++;
        } catch { /* dedupe */ }
      }
    } catch { sourcesFailed++; }
  }
  return { items: newJobs, failed: sourcesFailed };
}

async function runSkillsRadarScan(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  let newItems = 0, sourcesFailed = 0;
  const sources = await db.prepare(`SELECT id, url FROM skill_radar_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all();
  const now = new Date().toISOString();
  for (const src of (sources.results || [])) {
    try {
      const res = await fetch(String(src.url), { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Cron/1.0" } });
      if (!res.ok) { sourcesFailed++; continue; }
      const xml = await res.text();
      for (const item of parseFeedItems(xml)) {
        if (!item.url || !item.title) continue;
        const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
        try {
          await db.prepare(`INSERT OR IGNORE INTO skill_radar_items (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, relevance_score, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?)`)
            .bind(crypto.randomUUID(), userId, String(src.id), item.title.slice(0, 300), item.url, item.publishedAt, now, item.summary?.slice(0, 400) || null, dedupeKey).run();
          newItems++;
        } catch { /* dedupe */ }
      }
    } catch { sourcesFailed++; }
  }
  return { items: newItems, failed: sourcesFailed };
}

// ─── Job dispatcher ──────────────────────────────────
type JobResult = { items: number; failed: number };

async function runJob(db: D1Database, userId: string, jobName: string): Promise<JobResult> {
  switch (jobName) {
    case "research_scan": return runResearchScan(db, userId);
    case "jobs_refresh": return runJobsRefresh(db, userId);
    case "stocks_news_scan": return runStocksNewsScan(db, userId);
    case "skills_radar_scan": return runSkillsRadarScan(db, userId);
    case "stocks_refresh": {
      // MVP: placeholder — real provider integration point
      const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all();
      return { items: (wl.results || []).length, failed: 0 };
    }
    case "sports_refresh_nba":
    case "sports_refresh_nfl":
      // MVP: placeholder — real provider integration point
      return { items: 0, failed: 0 };
    default:
      return { items: 0, failed: 0 };
  }
}

// ─── Main scheduled handler ──────────────────────────
export default {
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const db = env.DB;
    if (!db) {
      console.error("[cron] D1 binding not available");
      return;
    }

    if (!env.CRON_SECRET) {
      console.error("[cron] CRON_SECRET not set — refusing to run");
      return;
    }

    const cron = event.cron;
    const jobs = getJobsForCron(cron);
    console.log(`[cron] Triggered by "${cron}", running jobs: ${jobs.join(", ")}`);

    const userIds = await getAllUserIds(db);
    if (userIds.length === 0) {
      console.log("[cron] No users found in user_settings — skipping");
      return;
    }

    for (const userId of userIds) {
      for (const jobName of jobs) {
        const start = Date.now();
        const jobKey = jobName.includes("_nba") || jobName.includes("_nfl")
          ? `${jobName}_${userId}`
          : `${jobName}_${userId}`;
        try {
          const result = await runJob(db, userId, jobName);
          const tookMs = Date.now() - start;
          const totalSources = result.items + result.failed;
          const status = result.failed === 0 ? "ok" : (totalSources > 0 && result.failed < totalSources) ? "partial" : "error";
          await updateCronRun(db, jobKey, { status, itemsProcessed: result.items, tookMs });
          console.log(`[cron] ${jobName} for ${userId}: ${status}, ${result.items} items, ${tookMs}ms`);
        } catch (err) {
          const tookMs = Date.now() - start;
          const errMsg = err instanceof Error ? err.message : String(err);
          await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg });
          console.error(`[cron] ${jobName} for ${userId} FAILED:`, errMsg);
        }
      }
    }
  },

  // Optional: HTTP handler for manual health checks
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "mcc-cron", time: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("MCC Cron Worker", { status: 200 });
  },
};

// Type stubs for Cloudflare Worker
interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  all(): Promise<D1Result>;
}

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
}
