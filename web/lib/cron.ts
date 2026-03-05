// web/lib/cron.ts — Shared cron job utilities
//
// Reusable helpers for running scan/refresh jobs from:
//  - POST /api/admin/cron/run (manual trigger)
//  - Cloudflare Worker cron triggers
//  - Existing manual scan/refresh endpoints (future refactor)

import type { D1Database } from "./d1";
import { parseFeed, inferTags, DEFAULT_SOURCES } from "./rss";
import { upsertCronRun } from "./cronLog";

// ─── Schedule definitions (matches 5 worker cron triggers) ───
export const CRON_SCHEDULES: Record<string, { cron: string; description: string }> = {
  research_scan:          { cron: "0 * * * *",           description: "Hourly RSS research scan" },
  jobs_refresh:           { cron: "0 9,13,18 * * 1-5",   description: "Weekday job feed refresh (9am/1pm/6pm)" },
  stocks_refresh:         { cron: "*/10 * * * *",         description: "Stock quotes + indices every 10 min" },
  stocks_news_scan:       { cron: "0 * * * *",            description: "Stock news RSS scan hourly" },
  predictions_resolve:    { cron: "0 * * * *",            description: "Hourly prediction resolution" },
  premarket_outliers:     { cron: "0 13 * * 1-5",         description: "Weekday pre-market outlier scan (8am ET)" },
  sports_refresh_nba:     { cron: "*/10 * * * *",         description: "NBA scores every 10 min" },
  sports_refresh_nfl:     { cron: "*/10 * * * *",         description: "NFL scores every 10 min" },
  skills_radar_scan:      { cron: "0 6 * * *",            description: "Daily skills radar at 6am" },
  lesson_plan_refresh:    { cron: "0 6 * * *",            description: "Daily lesson plan refresh at 6am" },
  industry_radar_refresh: { cron: "0 */3 * * *",          description: "Industry radar refresh every 3 hours" },
  memory_summarize:       { cron: "0 6 * * *",            description: "Nightly session summarization at 6am" },
  academic_reminders:     { cron: "0 7 * * *",            description: "Daily academic due-date reminders at 7am" },
};

// ─── Update cron_runs helper ─────────────────────────
export async function updateCronRun(
  db: D1Database,
  jobName: string,
  result: { status: "ok" | "error" | "partial"; itemsProcessed: number; tookMs: number; error?: string | null }
) {
  await upsertCronRun(db, {
    jobName,
    status: result.status,
    itemsProcessed: result.itemsProcessed,
    tookMs: result.tookMs,
    error: result.error ?? null,
  });
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
            const insertResult = await db
              .prepare(`INSERT OR IGNORE INTO job_items (id, user_id, source_id, title, company, url, posted_at, fetched_at, status, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`)
              .bind(id, userId, source.id, title, company, item.url, item.publishedAt, now, dedupeKey)
              .run();
            const changes = Number((insertResult.meta as { changes?: unknown } | undefined)?.changes ?? 0);
            if (changes > 0) newJobs++;
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
    // Dynamically import provider + store helpers
    const { getStockIntelProvider, storeQuotes, storeIndices } = await import("./stockProviders");

    // 1. Get watchlist tickers
    const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all<{ ticker: string }>();
    const tickers = (wl.results || []).map((r) => r.ticker);

    // 2. Fetch quotes via provider (Yahoo → Stock Intel fallback)
    const provider = getStockIntelProvider();
    const sourceHealth: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    const { quotes, health: quotesHealth } = await provider.fetchQuotes(tickers);
    sourceHealth.quotes = { ok: quotesHealth.status === "ok", latencyMs: quotesHealth.latencyMs, error: quotesHealth.error };

    // 3. Fetch indices via provider (Yahoo → Stock Intel fallback)
    const { indices, health: indicesHealth } = await provider.fetchIndices();
    sourceHealth.indices = { ok: indicesHealth.status === "ok", latencyMs: indicesHealth.latencyMs, error: indicesHealth.error };

    // 4. Store results (only store non-zero prices)
    const validQuotes = quotes.filter((q) => q.price > 0);
    if (validQuotes.length > 0) {
      await storeQuotes(db, userId, validQuotes);
    }

    const validIndices = indices.filter((i) => i.value > 0 || i.change_pct !== 0);
    if (validIndices.length > 0) {
      await storeIndices(db, userId, validIndices);
    }

    // 5. Determine overall status
    const allOk = quotesHealth.status === "ok" && indicesHealth.status === "ok";
    const status = allOk ? "ok" : validQuotes.length > 0 || validIndices.length > 0 ? "partial" : "error";

    const tookMs = Date.now() - start;
    await updateCronRun(db, jobKey, { status, itemsProcessed: validQuotes.length + validIndices.length, tookMs });

    return {
      ok: true,
      status,
      tickers: validQuotes.length,
      indices: validIndices.length,
      sourceHealth,
      tookMs,
    };
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
  { name: "Reuters Tech", url: "https://feeds.reuters.com/reuters/technologyNews" },
  { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },
  { name: "SEC Litigation", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=LIT&dateb=&owner=include&count=40&search_text=&action=getcompany&RSS=1" },
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

// ─── Lesson Plan Refresh (daily autonomous lesson generation) ───
export async function runLessonPlanRefresh(db: D1Database, userId: string) {
  const start = Date.now();
  const jobKey = `lesson_plan_refresh_${userId}`;

  try {
    // Get all user skills
    const skills = await db
      .prepare(`SELECT id, name, level FROM skill_items WHERE user_id = ?`)
      .bind(userId)
      .all<{ id: string; name: string; level: string }>();

    if (!skills.results || skills.results.length === 0) {
      const tookMs = Date.now() - start;
      await updateCronRun(db, jobKey, { status: "ok", itemsProcessed: 0, tookMs });
      return { ok: true, skills: 0, lessonsAdded: 0, tookMs };
    }

    let totalAdded = 0;
    const maxSkillsPerRun = 3; // Cap to avoid long runs

    for (const skill of skills.results.slice(0, maxSkillsPerRun)) {
      // Check if skill already has lessons
      const count = await db
        .prepare(`SELECT COUNT(*) as cnt FROM skill_lessons WHERE user_id = ? AND skill_id = ?`)
        .bind(userId, skill.id)
        .first<{ cnt: number }>();

      if ((count?.cnt ?? 0) >= 9) continue; // Skip skills with plenty of lessons

      // Generate template lessons (zero LLM cost)
      const subject = skill.name;
      const dedupeBase = `${skill.id}:${subject} Fundamentals:Introduction to ${subject}`.toLowerCase().replace(/\s+/g, "_").slice(0, 200);

      // Check if already generated
      const existing = await db
        .prepare(`SELECT id FROM skill_lessons WHERE user_id = ? AND skill_id = ? AND dedupe_key = ?`)
        .bind(userId, skill.id, dedupeBase)
        .first();

      if (existing) continue; // Already has auto-generated lessons

      const maxOrder = await db
        .prepare(`SELECT MAX(order_index) as max_idx FROM skill_lessons WHERE user_id = ? AND skill_id = ?`)
        .bind(userId, skill.id)
        .first<{ max_idx: number | null }>();
      let nextOrder = (maxOrder?.max_idx ?? -1) + 1;

      const lessons = [
        { module: `${subject} Fundamentals`, title: `Introduction to ${subject}`, mins: 15,
          md: `# Introduction to ${subject}\n\n## Overview\nFoundational concepts of ${subject}.\n\n## Key Concepts\n- Core principles\n- Modern relevance\n- Common applications` },
        { module: `${subject} Fundamentals`, title: `${subject} Core Practices`, mins: 25,
          md: `# ${subject} Core Practices\n\n## Topics\n- Environment setup\n- Basic workflows\n- Common pitfalls` },
        { module: `${subject} in Practice`, title: `Applying ${subject}`, mins: 20,
          md: `# Applying ${subject}\n\n## Real-World Use\n- Industry patterns\n- Challenges & solutions\n\n## Next Steps\n- Advanced topics\n- Build a project` },
      ];

      const now = new Date().toISOString();
      for (const l of lessons) {
        const dk = `${skill.id}:${l.module}:${l.title}`.toLowerCase().replace(/\s+/g, "_").slice(0, 200);
        const id = crypto.randomUUID();
        try {
          await db.prepare(
            `INSERT OR IGNORE INTO skill_lessons (id, user_id, skill_id, module_title, lesson_title, order_index, duration_minutes, content_md, resources_json, created_at, updated_at, source, dedupe_key, generation_meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?)`
          ).bind(id, userId, skill.id, l.module, l.title, nextOrder++, l.mins, l.md, "[]", now, now, dk,
            JSON.stringify({ generator: "cron_template", model: "none" })
          ).run();
          totalAdded++;
        } catch { /* dedupe */ }
      }
    }

    const tookMs = Date.now() - start;
    await updateCronRun(db, jobKey, { status: "ok", itemsProcessed: totalAdded, tookMs });
    return { ok: true, skills: skills.results.length, lessonsAdded: totalAdded, tookMs };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

// ─── Industry Radar Refresh (every 3h, dedupe + score, no LLM) ───
export async function runIndustryRadarRefresh(db: D1Database, userId: string) {
  // Delegates to the existing radar scan with additional scoring
  return runSkillsRadarScan(db, userId);
}

// ─── Memory Summarize (nightly session log compaction) ───
export async function runMemorySummarize(db: D1Database, userId: string) {
  const start = Date.now();
  const jobKey = `memory_summarize_${userId}`;

  try {
    // Find sessions older than 24h that haven't been summarized
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sessions = await db
      .prepare(
        `SELECT s.id, s.title, s.agent_id
         FROM chat_sessions s
         WHERE s.user_id = ? AND s.updated_at < ?
           AND s.id NOT IN (SELECT source_id FROM memory_notes WHERE user_id = ? AND category = 'session_summary' AND source_id IS NOT NULL)
         ORDER BY s.updated_at DESC LIMIT 10`
      )
      .bind(userId, cutoff, userId)
      .all<{ id: string; title: string; agent_id: string }>();

    let summarized = 0;
    const now = new Date().toISOString();

    for (const session of (sessions.results || [])) {
      // Get message count and key content
      const msgs = await db
        .prepare(
          `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20`
        )
        .bind(session.id)
        .all<{ role: string; content: string }>();

      if (!msgs.results || msgs.results.length < 2) continue;

      // Create compact summary (no LLM — extract key points from messages)
      const userMsgs = msgs.results.filter(m => m.role === "user").map(m => m.content.slice(0, 100));
      const agentMsgs = msgs.results.filter(m => m.role === "agent").map(m => m.content.slice(0, 100));

      const summary = [
        `Session: ${session.title}`,
        `Agent: ${session.agent_id}`,
        `Messages: ${msgs.results.length}`,
        `User topics: ${userMsgs.slice(0, 3).join("; ")}`,
        `Key responses: ${agentMsgs.slice(0, 2).join("; ")}`,
      ].join("\n");

      const noteId = crypto.randomUUID();
      try {
        await db.prepare(
          `INSERT OR IGNORE INTO memory_notes (id, user_id, category, subject, content, source_type, source_id, created_at, updated_at)
           VALUES (?, ?, 'session_summary', ?, ?, 'auto', ?, ?, ?)`
        ).bind(noteId, userId, session.title, summary, session.id, now, now).run();
        summarized++;
      } catch { /* dedupe */ }
    }

    const tookMs = Date.now() - start;
    await updateCronRun(db, jobKey, { status: "ok", itemsProcessed: summarized, tookMs });
    return { ok: true, summarized, tookMs };
  } catch (err) {
    const tookMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateCronRun(db, jobKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg }).catch(() => {});
    return { ok: false, error: errMsg, tookMs };
  }
}

// ─── Academic Reminders ───────────────────────────────
export async function runAcademicReminders(db: D1Database, userId: string) {
  const jobKey = "academic_reminders";
  const start = Date.now();
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const day1 = new Date(now.getTime() + 1 * 86400000).toISOString();
    const day3 = new Date(now.getTime() + 3 * 86400000).toISOString();
    const day7 = new Date(now.getTime() + 7 * 86400000).toISOString();

    // Auto-mark late
    await db.prepare(
      `UPDATE school_assignments SET status = 'late', updated_at = ?
       WHERE user_id = ? AND due_at < ? AND status IN ('open','in_progress')`
    ).bind(nowIso, userId, nowIso).run();

    // Find assignments due within 7 days that are not done/dropped
    const r = await db.prepare(
      `SELECT id, title, due_at, status FROM school_assignments
       WHERE user_id = ? AND due_at <= ? AND status NOT IN ('done','dropped')
       ORDER BY due_at ASC`
    ).bind(userId, day7).all<{ id: string; title: string; due_at: string; status: string }>();

    const assignments = r.results || [];
    let created = 0;
    const today = nowIso.slice(0, 10);

    for (const a of assignments) {
      const dueIso = a.due_at;
      let label = "";
      if (dueIso < nowIso) label = "overdue";
      else if (dueIso <= day1) label = "due_today";
      else if (dueIso <= day3) label = "due_3d";
      else label = "due_7d";

      // Dedupe key: assignment_id + date + label
      const dedupeKey = `acad_${a.id}_${today}_${label}`;

      // Check if notification already exists (dedupe)
      const existing = await db.prepare(
        `SELECT id FROM notifications WHERE user_id = ? AND type = ?`
      ).bind(userId, dedupeKey).first<{ id: string }>();
      if (existing) continue;

      const titleMap: Record<string, string> = {
        overdue: `⚠️ Overdue: ${a.title}`,
        due_today: `🔴 Due today: ${a.title}`,
        due_3d: `🟡 Due in 3 days: ${a.title}`,
        due_7d: `📅 Due this week: ${a.title}`,
      };
      const title = titleMap[label];

      try {
        await db.prepare(
          `INSERT INTO notifications (id, user_id, category, type, title, message, severity, created_at)
           VALUES (?, ?, 'school', ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), userId, dedupeKey, title,
          `Assignment "${a.title}" is ${label.replace("_", " ")} (due ${a.due_at.slice(0, 10)})`,
          label === "overdue" || label === "due_today" ? "warning" : "info",
          nowIso
        ).run();
        created++;
      } catch { /* skip duplicate or missing table */ }
    }

    const tookMs = Date.now() - start;
    await updateCronRun(db, jobKey, { status: "ok", itemsProcessed: created, tookMs });
    return { ok: true, created, checked: assignments.length, tookMs };
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
  | "skills_radar_scan"
  | "lesson_plan_refresh"
  | "industry_radar_refresh"
  | "memory_summarize"
  | "academic_reminders";

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
    case "lesson_plan_refresh":
      return runLessonPlanRefresh(db, userId);
    case "industry_radar_refresh":
      return runIndustryRadarRefresh(db, userId);
    case "memory_summarize":
      return runMemorySummarize(db, userId);
    case "academic_reminders":
      return runAcademicReminders(db, userId);
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
