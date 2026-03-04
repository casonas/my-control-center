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

// ─── Cron schedule → job mapping (matches 5 wrangler.toml triggers) ──
const SCHEDULE_MAP: Record<string, string[]> = {
  // Every 10 min
  "stocks_refresh":        ["*/10 * * * *"],
  "sports_refresh_nba":    ["*/10 * * * *"],
  "sports_refresh_nfl":    ["*/10 * * * *"],
  "sports_refresh_mlb":    ["*/10 * * * *"],
  "sports_refresh_nhl":    ["*/10 * * * *"],
  // Hourly
  "research_scan":         ["0 * * * *"],
  "stocks_news_scan":      ["0 * * * *"],
  // Every 3 hours
  "industry_radar_refresh": ["0 */3 * * *"],
  // Daily 6am UTC
  "lesson_plan_refresh":   ["0 6 * * *"],
  "skills_radar_scan":     ["0 6 * * *"],
  "memory_summarize":      ["0 6 * * *"],
  // Weekday 9am/1pm/6pm
  "jobs_refresh":          ["0 9,13,18 * * 1-5"],
};

function getJobsForCron(cron: string): string[] {
  const jobs: string[] = [];
  for (const [job, crons] of Object.entries(SCHEDULE_MAP)) {
    if (crons.includes(cron)) {
      jobs.push(job);
    }
  }
  if (jobs.length === 0) {
    console.warn(`[cron] No jobs matched cron expression: "${cron}"`);
  }
  return jobs;
}

// ─── Shared helpers (inlined — Workers can't import from Pages) ───

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

// ─── Idempotency helpers (inlined for worker) ────────

function makeIdempotencyKey(jobName: string, userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${jobName}:${userId}:${today}`;
}

async function isAlreadyCompleted(db: D1Database, key: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const row = await db
      .prepare(`SELECT 1 FROM idempotency_keys WHERE idempotency_key = ? AND status = 'completed' AND expires_at > ?`)
      .bind(key, now)
      .first();
    return !!row;
  } catch {
    return false; // If table doesn't exist yet, allow the job to run
  }
}

async function markCompleted(db: D1Database, key: string): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO idempotency_keys (idempotency_key, status, result_json, completed_at, expires_at, created_at)
         VALUES (?, 'completed', NULL, ?, ?, ?)`
      )
      .bind(key, now, expiresAt, now)
      .run();
  } catch {
    // Non-critical — continue even if idempotency table not available
  }
}

// ─── Minimal RSS parser ──────────────────────────────

function parseFeedItems(xml: string): { title: string; url: string; publishedAt: string | null; summary: string | null }[] {
  const items: { title: string; url: string; publishedAt: string | null; summary: string | null }[] = [];
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

// ─── Job runners ─────────────────────────────────────

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

// ─── Inline scoring engine (Workers can't import from Pages) ──────
const ROLE_KW = [
  { re: /\bsecurity analyst\b/i, w: 20 }, { re: /\bsoc analyst\b/i, w: 20 },
  { re: /\bthreat hunt/i, w: 18 }, { re: /\bincident response\b/i, w: 16 },
  { re: /\binformation security\b/i, w: 15 }, { re: /\bcyber/i, w: 14 },
  { re: /\bcompliance analyst\b/i, w: 12 }, { re: /\bdata scientist?\b/i, w: 10 },
  { re: /\banalyst\b/i, w: 8 },
];
const SKILL_KW = [
  { re: /\bpython\b/i, w: 8 }, { re: /\bsplunk\b/i, w: 8 }, { re: /\bsiem\b/i, w: 8 },
  { re: /\blog analysis\b/i, w: 6 }, { re: /\bdetection\b/i, w: 5 },
  { re: /\bdata\b/i, w: 3 },
];
const EXP_BOOST = [{ re: /\bjunior\b/i, d: 8 }, { re: /\bentry[- ]level\b/i, d: 10 }, { re: /\bassociate\b/i, d: 6 }];
const EXP_PEN = [{ re: /\bsenior\b/i, d: -10 }, { re: /\bprincipal\b/i, d: -15 }, { re: /\bdirector\b/i, d: -15 }];

function scoreJobInline(title: string, company: string, location: string | null): { score: number; why: string; tags: string; factors: string } {
  const text = `${title} ${company} ${location || ""}`.toLowerCase();
  let score = 0; const reasons: string[] = []; const tags: string[] = [];
  const factors: { category: string; label: string; delta: number }[] = [];
  for (const k of ROLE_KW) if (k.re.test(text)) { score += k.w; reasons.push(k.re.source.replace(/\\b/g, "")); tags.push(k.re.source.replace(/\\b/g, "")); factors.push({ category: "role", label: k.re.source.replace(/\\b/g, ""), delta: k.w }); }
  for (const k of SKILL_KW) if (k.re.test(text)) { score += k.w; tags.push(k.re.source.replace(/\\b/g, "")); factors.push({ category: "skill", label: k.re.source.replace(/\\b/g, ""), delta: k.w }); }
  for (const e of EXP_BOOST) if (e.re.test(text)) { score += e.d; factors.push({ category: "experience", label: "entry-level boost", delta: e.d }); break; }
  for (const e of EXP_PEN) if (e.re.test(text)) { score += e.d; factors.push({ category: "experience", label: "seniority penalty", delta: e.d }); break; }
  if (/\bremote\b/i.test(text) || /\bhybrid\b/i.test(text)) { score += 5; tags.push("remote-friendly"); factors.push({ category: "remote", label: "remote/hybrid", delta: 5 }); }
  const fs = Math.max(0, Math.min(100, score));
  return { score: fs, why: reasons.length > 0 ? `Matches: ${reasons.slice(0, 4).join(", ")}` : "No strong keyword matches", tags: JSON.stringify([...new Set(tags)]), factors: JSON.stringify(factors) };
}

function detectRemote(title: string, location: string | null): string {
  const t = `${title} ${location || ""}`.toLowerCase();
  if (/\bremote\b/.test(t)) return "1";
  if (/\bon[- ]?site\b/.test(t)) return "0";
  return "unknown";
}

// Deterministic dedupe key: hash(canonical_url + normalized_title + normalized_company)
// Uses djb2 hash: ((hash << 5) + hash + char) with unsigned 32-bit wrap
function workerBuildDedupeKey(rawUrl: string, title: string, company: string): string {
  const canonical = rawUrl.replace(/[?#].*$/, "").toLowerCase();
  const normTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normCompany = company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const input = `${canonical}|${normTitle}|${normCompany}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `${hash.toString(36)}_${normTitle.slice(0, 40).replace(/\s+/g, "_")}`;
}

// Per-source fetch with single retry + jitter
async function workerFetchWithRetry(url: string, timeoutMs: number = 8000): Promise<{ ok: boolean; text: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "MCC-Cron/1.0" } });
      if (res.ok) return { ok: true, text: await res.text() };
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500)); continue; }
      return null;
    } catch {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500)); continue; }
      return null;
    }
  }
  return null;
}

async function runJobsRefresh(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  let newJobs = 0, sourcesFailed = 0;
  const sources = await db.prepare(`SELECT id, url, type FROM job_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all();
  const now = new Date().toISOString();
  for (const src of (sources.results || [])) {
    if (String(src.type) !== "rss") continue;
    try {
      const result = await workerFetchWithRetry(String(src.url), 8000);
      if (!result) { sourcesFailed++; continue; }
      for (const item of parseFeedItems(result.text)) {
        if (!item.url || !item.title) continue;
        const companyMatch = item.title.match(/(?:at|@|-|–|—)\s*(.+?)(?:\s*\(|$)/i);
        const company = companyMatch ? companyMatch[1].trim() : "Unknown";
        const title = item.title.replace(/(?:at|@)\s*.+$/, "").trim() || item.title;
        const dedupeKey = workerBuildDedupeKey(item.url, title, company);
        const rf = detectRemote(title, null);
        const scoring = scoreJobInline(title, company, null);
        // INSERT OR IGNORE: preserves existing rows — never overwrites user workflow state
        try {
          await db.prepare(
            `INSERT OR IGNORE INTO job_items (id, user_id, source_id, title, company, url, posted_at, fetched_at, status, dedupe_key, match_score, why_match, match_factors_json, tags_json, remote_flag)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), userId, String(src.id), title, company, item.url, item.publishedAt, now, dedupeKey, scoring.score, scoring.why, scoring.factors, scoring.tags, rf).run();
          newJobs++;
        } catch { /* dedupe — existing row preserved */ }
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

// ─── New autonomous job runners ──────────────────────

async function runLessonPlanRefresh(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  let added = 0;
  const skills = await db.prepare(`SELECT id, name, level FROM skill_items WHERE user_id = ?`).bind(userId).all();
  const maxSkillsPerRun = 3;
  const now = new Date().toISOString();

  for (const sk of (skills.results || []).slice(0, maxSkillsPerRun)) {
    const skillId = String(sk.id);
    const name = String(sk.name);
    const count = await db.prepare(`SELECT COUNT(*) as cnt FROM skill_lessons WHERE user_id = ? AND skill_id = ?`).bind(userId, skillId).first();
    if (((count as Record<string, unknown>)?.cnt as number ?? 0) >= 9) continue;

    const dedupeBase = `${skillId}:${name} fundamentals:introduction to ${name}`.toLowerCase().replace(/\s+/g, "_").slice(0, 200);
    const existing = await db.prepare(`SELECT id FROM skill_lessons WHERE user_id = ? AND skill_id = ? AND dedupe_key = ?`).bind(userId, skillId, dedupeBase).first();
    if (existing) continue;

    const maxOrder = await db.prepare(`SELECT MAX(order_index) as max_idx FROM skill_lessons WHERE user_id = ? AND skill_id = ?`).bind(userId, skillId).first();
    let nextOrder = ((maxOrder as Record<string, unknown>)?.max_idx as number ?? -1) + 1;

    const lessons = [
      { mod: `${name} Fundamentals`, title: `Introduction to ${name}`, mins: 15,
        md: `# Introduction to ${name}\n\n## Overview\nFoundational concepts of ${name}.\n\n## Key Concepts\n- Core principles\n- Modern relevance\n- Common applications` },
      { mod: `${name} Fundamentals`, title: `${name} Core Practices`, mins: 25,
        md: `# ${name} Core Practices\n\n## Topics\n- Environment setup\n- Basic workflows\n- Common pitfalls` },
      { mod: `${name} in Practice`, title: `Applying ${name}`, mins: 20,
        md: `# Applying ${name}\n\n## Real-World Use\n- Industry patterns\n- Challenges & solutions` },
    ];

    for (const l of lessons) {
      const dk = `${skillId}:${l.mod}:${l.title}`.toLowerCase().replace(/\s+/g, "_").slice(0, 200);
      try {
        await db.prepare(
          `INSERT OR IGNORE INTO skill_lessons (id, user_id, skill_id, module_title, lesson_title, order_index, duration_minutes, content_md, resources_json, created_at, updated_at, source, dedupe_key, generation_meta_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'auto', ?, ?)`
        ).bind(crypto.randomUUID(), userId, skillId, l.mod, l.title, nextOrder++, l.mins, l.md, now, now, dk,
          JSON.stringify({ generator: "cron_template", model: "none" })
        ).run();
        added++;
      } catch { /* dedupe */ }
    }
  }
  return { items: added, failed: 0 };
}

async function runIndustryRadarRefresh(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  return runSkillsRadarScan(db, userId);
}

async function runMemorySummarize(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  let summarized = 0;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  try {
    const sessions = await db.prepare(
      `SELECT s.id, s.title, s.agent_id FROM chat_sessions s
       WHERE s.user_id = ? AND s.updated_at < ?
         AND s.id NOT IN (SELECT source_id FROM memory_notes WHERE user_id = ? AND category = 'session_summary' AND source_id IS NOT NULL)
       ORDER BY s.updated_at DESC LIMIT 10`
    ).bind(userId, cutoff, userId).all();

    for (const sess of (sessions.results || [])) {
      const msgs = await db.prepare(
        `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20`
      ).bind(String(sess.id)).all();

      if (!msgs.results || msgs.results.length < 2) continue;

      const userMsgs = msgs.results.filter(m => String(m.role) === "user").map(m => String(m.content).slice(0, 100));
      const agentMsgs = msgs.results.filter(m => String(m.role) === "agent").map(m => String(m.content).slice(0, 100));

      const summary = [
        `Session: ${String(sess.title)}`,
        `Agent: ${String(sess.agent_id)}`,
        `Messages: ${msgs.results.length}`,
        `User topics: ${userMsgs.slice(0, 3).join("; ")}`,
        `Key responses: ${agentMsgs.slice(0, 2).join("; ")}`,
      ].join("\n");

      try {
        await db.prepare(
          `INSERT OR IGNORE INTO memory_notes (id, user_id, category, subject, content, source_type, source_id, created_at, updated_at)
           VALUES (?, ?, 'session_summary', ?, ?, 'auto', ?, ?, ?)`
        ).bind(crypto.randomUUID(), userId, String(sess.title), summary, String(sess.id), now, now).run();
        summarized++;
      } catch { /* dedupe */ }
    }
  } catch {
    // memory_notes table may not exist yet
  }
  return { items: summarized, failed: 0 };
}

// ─── Sports refresh (inlined — Workers can't import from Pages) ──

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_LEAGUE_MAP: Record<string, string> = {
  nba: "basketball/nba", nfl: "football/nfl", mlb: "baseball/mlb", nhl: "hockey/nhl",
};

const SPORTS_NEWS_FEEDS: Record<string, { url: string; source: string }[]> = {
  nba: [{ url: "https://www.espn.com/espn/rss/nba/news", source: "ESPN NBA" }],
  nfl: [{ url: "https://www.espn.com/espn/rss/nfl/news", source: "ESPN NFL" }],
  mlb: [{ url: "https://www.espn.com/espn/rss/mlb/news", source: "ESPN MLB" }],
  nhl: [{ url: "https://www.espn.com/espn/rss/nhl/news", source: "ESPN NHL" }],
};

function mapEspnStatus(s: string): string {
  const lower = (s || "").toLowerCase();
  if (lower.includes("final")) return "final";
  if (lower.includes("progress") || lower.includes("in ")) return "live";
  if (lower.includes("postponed") || lower.includes("canceled")) return "postponed";
  return "scheduled";
}

async function runSportsRefreshJob(db: D1Database, userId: string, league: string): Promise<JobResult> {
  let items = 0, failed = 0;
  const now = new Date().toISOString();

  // 1. Fetch ESPN scoreboard
  const espnPath = ESPN_LEAGUE_MAP[league];
  if (espnPath) {
    try {
      const res = await fetch(`${ESPN_SCOREBOARD}/${espnPath}/scoreboard`, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "MCC-Cron/1.0" },
      });
      if (res.ok) {
        const data = await res.json() as { events?: Array<Record<string, unknown>> };
        for (const ev of data.events || []) {
          try {
            const comp = (ev.competitions as Array<Record<string, unknown>>)?.[0];
            if (!comp) continue;
            const competitors = comp.competitors as Array<Record<string, unknown>>;
            const home = competitors?.find((c) => c.homeAway === "home");
            const away = competitors?.find((c) => c.homeAway === "away");
            if (!home || !away) continue;
            const statusObj = comp.status as Record<string, unknown> || {};
            const typeObj = (statusObj.type || {}) as Record<string, unknown>;
            const homeTeam = home.team as Record<string, unknown> || {};
            const awayTeam = away.team as Record<string, unknown> || {};
            const gameId = `espn_${league}_${ev.id}`;
            await db.prepare(
              `INSERT INTO sports_games (id, user_id, league, start_time, status, home_team_id, home_team_name, away_team_id, away_team_name, home_score, away_score, period, clock, updated_at, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET status=excluded.status, home_score=excluded.home_score, away_score=excluded.away_score, period=excluded.period, clock=excluded.clock, updated_at=excluded.updated_at`
            ).bind(
              gameId, userId, league,
              String(ev.date || now),
              mapEspnStatus(String(typeObj.description || "scheduled")),
              String(homeTeam.abbreviation || homeTeam.id || "UNK"),
              String(homeTeam.displayName || homeTeam.shortDisplayName || "Home"),
              String(awayTeam.abbreviation || awayTeam.id || "UNK"),
              String(awayTeam.displayName || awayTeam.shortDisplayName || "Away"),
              home.score != null ? Number(home.score) : null,
              away.score != null ? Number(away.score) : null,
              statusObj.period ? String(statusObj.period) : null,
              statusObj.displayClock ? String(statusObj.displayClock) : null,
              now, "espn"
            ).run();
            items++;
          } catch { failed++; }
        }
      }
    } catch (err) {
      console.warn(`[cron] ESPN ${league} fetch failed:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  // 2. Fetch RSS news
  const feeds = SPORTS_NEWS_FEEDS[league] || [];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "MCC-Cron/1.0" },
      });
      if (res.ok) {
        const xml = await res.text();
        const newsItems = parseFeedItems(xml);
        for (const n of newsItems) {
          const urlStr = n.url.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "");
          let hash = 0;
          for (let i = 0; i < urlStr.length; i++) hash = ((hash << 5) - hash + urlStr.charCodeAt(i)) | 0;
          const dedupeKey = `news_${Math.abs(hash).toString(36)}`;
          try {
            await db.prepare(
              `INSERT OR IGNORE INTO sports_news_items (id, user_id, league, team_id, title, source, url, published_at, fetched_at, dedupe_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(`news_${dedupeKey}`, userId, league, null, n.title, feed.source, n.url, n.publishedAt, now, dedupeKey).run();
            items++;
          } catch { /* dedupe */ }
        }
      }
    } catch (err) {
      console.warn(`[cron] News ${feed.source} fetch failed:`, err instanceof Error ? err.message : err);
    }
  }

  return { items, failed };
}

// ─── Job dispatcher with retry ───────────────────────
type JobResult = { items: number; failed: number };

async function runJob(db: D1Database, userId: string, jobName: string): Promise<JobResult> {
  switch (jobName) {
    case "research_scan": return runResearchScan(db, userId);
    case "jobs_refresh": return runJobsRefresh(db, userId);
    case "stocks_news_scan": return runStocksNewsScan(db, userId);
    case "skills_radar_scan": return runSkillsRadarScan(db, userId);
    case "lesson_plan_refresh": return runLessonPlanRefresh(db, userId);
    case "industry_radar_refresh": return runIndustryRadarRefresh(db, userId);
    case "memory_summarize": return runMemorySummarize(db, userId);
    case "stocks_refresh": {
      const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all();
      return { items: (wl.results || []).length, failed: 0 };
    }
    case "sports_refresh_nba":
      return runSportsRefreshJob(db, userId, "nba");
    case "sports_refresh_nfl":
      return runSportsRefreshJob(db, userId, "nfl");
    case "sports_refresh_mlb":
      return runSportsRefreshJob(db, userId, "mlb");
    case "sports_refresh_nhl":
      return runSportsRefreshJob(db, userId, "nhl");
    default:
      return { items: 0, failed: 0 };
  }
}

const MAX_RETRIES = 1;

async function runJobWithRetry(db: D1Database, userId: string, jobName: string): Promise<JobResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await runJob(db, userId, jobName);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        console.warn(`[cron] ${jobName} for ${userId} attempt ${attempt + 1} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
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
        const jobKey = `${jobName}_${userId}`;

        // Idempotency: skip if already completed today
        const idemKey = makeIdempotencyKey(jobName, userId);
        // Only apply daily idempotency to infrequent jobs
        const dailyJobs = ["lesson_plan_refresh", "memory_summarize", "skills_radar_scan"];
        if (dailyJobs.includes(jobName) && await isAlreadyCompleted(db, idemKey)) {
          console.log(`[cron] ${jobName} for ${userId}: already completed today, skipping`);
          continue;
        }

        try {
          const result = await runJobWithRetry(db, userId, jobName);
          const tookMs = Date.now() - start;
          const totalSources = result.items + result.failed;
          const status = result.failed === 0 ? "ok" : (totalSources > 0 && result.failed < totalSources) ? "partial" : "error";
          await updateCronRun(db, jobKey, { status, itemsProcessed: result.items, tookMs });

          // Mark daily jobs as completed for idempotency
          if (dailyJobs.includes(jobName)) {
            await markCompleted(db, idemKey);
          }

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
