// web/lib/cron.ts — Shared cron job utilities
//
// Reusable helpers for running scan/refresh jobs from:
//  - POST /api/admin/cron/run (manual trigger)
//  - Cloudflare Worker cron triggers
//  - Existing manual scan/refresh endpoints (future refactor)

import type { D1Database } from "./d1";
import { parseFeed, inferTags, DEFAULT_SOURCES } from "./rss";

// ─── Schedule definitions ────────────────────────────
export const CRON_SCHEDULES: Record<string, { cron: string; description: string }> = {
  research_scan:      { cron: "0 * * * *",           description: "Hourly RSS research scan" },
  jobs_refresh:       { cron: "0 9,13,18 * * 1-5",   description: "Weekday job feed refresh (9am/1pm/6pm)" },
  stocks_refresh:     { cron: "*/10 * * * *",         description: "Stock quotes + indices every 10 min" },
  stocks_news_scan:   { cron: "15 * * * *",           description: "Stock news RSS scan hourly at :15" },
  sports_refresh_nba: { cron: "*/15 * * * *",         description: "NBA scores every 15 min" },
  sports_refresh_nfl: { cron: "0 */4 * * *",          description: "NFL scores every 4 hours" },
  skills_radar_scan:  { cron: "0 8 * * *",            description: "Daily skills radar at 8am" },
};

// ─── Update cron_runs helper ─────────────────────────
export async function updateCronRun(
  db: D1Database,
  jobName: string,
  result: { status: "ok" | "error" | "partial"; itemsProcessed: number; tookMs: number; error?: string | null }
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, took_ms, error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(jobName, now, result.status, result.itemsProcessed, result.tookMs, result.error ?? null, now)
    .run();
}

// ─── Job runners ─────────────────────────────────────
// Each runner takes a D1 handle + userId and returns a result summary.
// They mirror the logic in existing scan/refresh route handlers.

export async function runResearchScan(db: D1Database, userId: string) {
  const start = Date.now();
  const jobKey = `research_scan_${userId}`;
  let newItems = 0;
  let sourcesFailed = 0;

  try {
    // Load enabled sources (seed defaults if none)
    const srcResult = await db
      .prepare(`SELECT id, name, url FROM research_sources WHERE user_id = ? AND enabled = 1`)
      .bind(userId)
      .all<{ id: string; name: string; url: string }>();
    let sources = srcResult.results || [];

    if (sources.length === 0) {
      const now = new Date().toISOString();
      for (const src of DEFAULT_SOURCES) {
        const id = crypto.randomUUID();
        await db
          .prepare(`INSERT OR IGNORE INTO research_sources (id, user_id, name, url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`)
          .bind(id, userId, src.name, src.url, now)
          .run();
      }
      const refreshed = await db
        .prepare(`SELECT id, name, url FROM research_sources WHERE user_id = ? AND enabled = 1`)
        .bind(userId)
        .all<{ id: string; name: string; url: string }>();
      sources = refreshed.results || [];
    }

    const now = new Date().toISOString();
    for (const source of sources) {
      try {
        const res = await fetch(source.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Research/1.0" } });
        if (!res.ok) { sourcesFailed++; continue; }
        const xml = await res.text();
        const items = parseFeed(xml);
        for (const item of items) {
          if (!item.url || !item.title) continue;
          const id = crypto.randomUUID();
          const tags = inferTags(item.title);
          try {
            await db
              .prepare(`INSERT OR IGNORE INTO research_items (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
              .bind(id, userId, source.id, item.title, item.url, item.publishedAt, now, item.summary, JSON.stringify(tags))
              .run();
            newItems++;
          } catch { /* dedupe */ }
        }
      } catch { sourcesFailed++; }
    }

    const tookMs = Date.now() - start;
    const status = sourcesFailed === 0 ? "ok" : sourcesFailed < sources.length ? "partial" : "error";
    await updateCronRun(db, jobKey, { status, itemsProcessed: newItems, tookMs });
    return { ok: true, newItems, sources: sources.length, sourcesFailed, tookMs, status };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

export async function runJobsRefresh(db: D1Database, userId: string) {
  const start = Date.now();
  const jobKey = `jobs_refresh_${userId}`;
  let newJobs = 0;
  let sourcesFailed = 0;

  const DEFAULT_JOB_SOURCES = [
    { name: "LinkedIn Cybersecurity Jobs RSS", type: "rss", url: "https://www.linkedin.com/jobs/search/?keywords=cybersecurity&f_TPR=r604800" },
    { name: "Indeed Cybersecurity RSS", type: "rss", url: "https://www.indeed.com/rss?q=cybersecurity&sort=date" },
  ];

  try {
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

    const now = new Date().toISOString();
    for (const source of sources) {
      if (source.type !== "rss") continue;
      try {
        const res = await fetch(source.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Jobs/1.0" } });
        if (!res.ok) { sourcesFailed++; continue; }
        const xml = await res.text();
        const items = parseFeed(xml);
        for (const item of items) {
          if (!item.url || !item.title) continue;
          const id = crypto.randomUUID();
          const companyMatch = item.title.match(/(?:at|@|-|–|—)\s*(.+?)(?:\s*\(|$)/i);
          const company = companyMatch ? companyMatch[1].trim() : "Unknown";
          const title = item.title.replace(/(?:at|@)\s*.+$/, "").trim() || item.title;
          const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
          try {
            await db
              .prepare(`INSERT OR IGNORE INTO job_items (id, user_id, source_id, title, company, url, posted_at, fetched_at, status, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`)
              .bind(id, userId, source.id, title, company, item.url, item.publishedAt, now, dedupeKey)
              .run();
            newJobs++;
          } catch { /* dedupe */ }
        }
      } catch { sourcesFailed++; }
    }

    const tookMs = Date.now() - start;
    const status = sourcesFailed === 0 ? "ok" : sourcesFailed < sources.length ? "partial" : "error";
    await updateCronRun(db, jobKey, { status, itemsProcessed: newJobs, tookMs });
    return { ok: true, newJobs, sources: sources.length, sourcesFailed, tookMs, status };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

export async function runStocksRefresh(db: D1Database, userId: string) {
  const start = Date.now();
  const jobKey = `stocks_refresh_${userId}`;

  try {
    const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all<{ ticker: string }>();
    const tickers = (wl.results || []).map((r) => r.ticker);
    const now = new Date().toISOString();

    for (const ticker of tickers) {
      await db.prepare(
        `INSERT OR REPLACE INTO stock_quotes (user_id, ticker, price, change, change_pct, currency, asof, source) VALUES (?, ?, 0, 0, 0, 'USD', ?, 'pending')`
      ).bind(userId, ticker, now).run();
    }
    for (const sym of ["SPX", "IXIC", "BTC"]) {
      await db.prepare(
        `INSERT OR REPLACE INTO market_indices (user_id, symbol, value, change_pct, asof, source) VALUES (?, ?, 0, 0, ?, 'pending')`
      ).bind(userId, sym, now).run();
    }

    const tookMs = Date.now() - start;
    await updateCronRun(db, jobKey, { status: "ok", itemsProcessed: tickers.length, tookMs });
    return { ok: true, tickers: tickers.length, indices: 3, tookMs, source: "pending" };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

const STOCK_NEWS_FEEDS = [
  { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
];

export async function runStocksNewsScan(db: D1Database, userId: string) {
  const start = Date.now();
  const jobKey = `stocks_news_scan_${userId}`;
  let newItems = 0;
  let sourcesFailed = 0;

  try {
    const now = new Date().toISOString();
    for (const feed of STOCK_NEWS_FEEDS) {
      try {
        const res = await fetch(feed.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Stocks/1.0" } });
        if (!res.ok) { sourcesFailed++; continue; }
        const xml = await res.text();
        const items = parseFeed(xml);
        for (const item of items) {
          if (!item.url || !item.title) continue;
          const id = crypto.randomUUID();
          const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
          try {
            await db.prepare(
              `INSERT OR IGNORE INTO stock_news_items (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?)`
            ).bind(id, userId, item.title.slice(0, 300), feed.name, item.url, item.publishedAt, now, item.summary?.slice(0, 400) || null, dedupeKey).run();
            newItems++;
          } catch { /* dedupe */ }
        }
      } catch { sourcesFailed++; }
    }

    const tookMs = Date.now() - start;
    const status = sourcesFailed === 0 ? "ok" : sourcesFailed < STOCK_NEWS_FEEDS.length ? "partial" : "error";
    await updateCronRun(db, jobKey, { status, itemsProcessed: newItems, tookMs });
    return { ok: true, newItems, sources: STOCK_NEWS_FEEDS.length, sourcesFailed, tookMs, status };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

export async function runSportsRefresh(db: D1Database, userId: string, league = "nba") {
  const start = Date.now();
  const jobKey = `sports_refresh_${league}_${userId}`;

  try {
    const now = new Date().toISOString();
    // MVP: Sports data provider placeholder — update cron_runs to track refresh attempts
    await updateCronRun(db, jobKey, { status: "ok", itemsProcessed: 0, tookMs: Date.now() - start });
    return { ok: true, league, games: 0, tookMs: Date.now() - start, source: "pending" };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

const DEFAULT_RADAR_SOURCES = [
  { name: "Hacker News", url: "https://hnrss.org/newest?points=100" },
  { name: "Dev.to", url: "https://dev.to/feed" },
  { name: "InfoSec Write-ups", url: "https://infosecwriteups.com/feed" },
  { name: "SANS ISC", url: "https://isc.sans.edu/rssfeed.xml" },
  { name: "Kubernetes Blog", url: "https://kubernetes.io/feed.xml" },
  { name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/" },
  { name: "AWS News", url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/" },
  { name: "GitHub Blog", url: "https://github.blog/feed/" },
];

const TRENDING_KEYWORDS = [
  { pattern: /zero.?trust/i, skill: "Zero Trust Architecture" },
  { pattern: /sbom|software.?bill/i, skill: "SBOM & Supply Chain Security" },
  { pattern: /kubernetes|k8s/i, skill: "Kubernetes" },
  { pattern: /\brust\b/i, skill: "Rust Programming" },
  { pattern: /\bwasm\b|webassembly/i, skill: "WebAssembly" },
  { pattern: /devsecops/i, skill: "DevSecOps" },
  { pattern: /rag\b|retrieval.?augmented/i, skill: "RAG & LLM Applications" },
];

export async function runSkillsRadarScan(db: D1Database, userId: string) {
  const start = Date.now();
  const jobKey = `skills_radar_scan_${userId}`;
  let newItems = 0;
  let sourcesFailed = 0;

  try {
    const srcResult = await db
      .prepare(`SELECT id, name, url FROM skill_radar_sources WHERE user_id = ? AND enabled = 1`)
      .bind(userId)
      .all<{ id: string; name: string; url: string }>();
    let sources = srcResult.results || [];

    if (sources.length === 0) {
      const now = new Date().toISOString();
      for (const src of DEFAULT_RADAR_SOURCES) {
        const id = crypto.randomUUID();
        await db.prepare(`INSERT OR IGNORE INTO skill_radar_sources (id, user_id, name, url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`).bind(id, userId, src.name, src.url, now).run();
      }
      const refreshed = await db.prepare(`SELECT id, name, url FROM skill_radar_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all<{ id: string; name: string; url: string }>();
      sources = refreshed.results || [];
    }

    const now = new Date().toISOString();
    const suggestions = new Map<string, string>();

    for (const source of sources) {
      try {
        const res = await fetch(source.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Radar/1.0" } });
        if (!res.ok) { sourcesFailed++; continue; }
        const xml = await res.text();
        const items = parseFeed(xml);
        for (const item of items) {
          if (!item.url || !item.title) continue;
          const id = crypto.randomUUID();
          const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
          const tags = inferTags(item.title);
          try {
            await db.prepare(
              `INSERT OR IGNORE INTO skill_radar_items (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, relevance_score, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
            ).bind(id, userId, source.id, item.title.slice(0, 300), item.url, item.publishedAt, now, item.summary?.slice(0, 400) || null, JSON.stringify(tags), dedupeKey).run();
            newItems++;
            for (const kw of TRENDING_KEYWORDS) {
              if (kw.pattern.test(item.title)) {
                suggestions.set(kw.skill, `Trending in "${source.name}": ${item.title.slice(0, 80)}`);
              }
            }
          } catch { /* dedupe */ }
        }
      } catch { sourcesFailed++; }
    }

    // Create skill suggestions
    for (const [skillName, reason] of suggestions) {
      const sugId = crypto.randomUUID();
      try {
        await db.prepare(
          `INSERT OR IGNORE INTO skill_suggestions (id, user_id, proposed_skill_name, reason_md, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?)`
        ).bind(sugId, userId, skillName, reason, now, now).run();
      } catch { /* dedupe */ }
    }

    const tookMs = Date.now() - start;
    const status = sourcesFailed === 0 ? "ok" : sourcesFailed < sources.length ? "partial" : "error";
    await updateCronRun(db, jobKey, { status, itemsProcessed: newItems, tookMs });
    return { ok: true, newItems, sources: sources.length, sourcesFailed, suggestions: suggestions.size, tookMs, status };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

// ─── Dispatcher — run a named job for a user ─────────
export type CronJobName =
  | "research_scan"
  | "jobs_refresh"
  | "stocks_refresh"
  | "stocks_news_scan"
  | "sports_refresh_nba"
  | "sports_refresh_nfl"
  | "skills_radar_scan";

export async function runCronJob(db: D1Database, userId: string, jobName: CronJobName) {
  switch (jobName) {
    case "research_scan":
      return runResearchScan(db, userId);
    case "jobs_refresh":
      return runJobsRefresh(db, userId);
    case "stocks_refresh":
      return runStocksRefresh(db, userId);
    case "stocks_news_scan":
      return runStocksNewsScan(db, userId);
    case "sports_refresh_nba":
      return runSportsRefresh(db, userId, "nba");
    case "sports_refresh_nfl":
      return runSportsRefresh(db, userId, "nfl");
    case "skills_radar_scan":
      return runSkillsRadarScan(db, userId);
    default:
      return { ok: false, error: `Unknown job: ${jobName}` };
  }
}

// ─── Get all user IDs (for cron worker to iterate) ───
export async function getAllUserIds(db: D1Database): Promise<string[]> {
  try {
    const result = await db
      .prepare(`SELECT DISTINCT user_id FROM user_settings LIMIT 100`)
      .all<{ user_id: string }>();
    return (result.results || []).map((r) => r.user_id);
  } catch {
    return [];
  }
}
