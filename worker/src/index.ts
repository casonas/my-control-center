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

// ─── Cron schedule → fan-out sub-job mapping (5 triggers only) ──
// Each cron expression fans out to multiple sub-jobs.
// Sub-jobs are logged individually as "pulse:<subjob>" in cron_runs.
// Each sub-job has its own timeout and failure isolation.

const SUBJOB_TIMEOUT_MS = 25_000; // per-subjob hard timeout

interface SubJob {
  name: string;            // logged as "pulse:<name>_<userId>" in cron_runs
  timeoutMs?: number;      // override default timeout
}

const FANOUT_MAP: Record<string, SubJob[]> = {
  // Every 10 min — high-frequency data refreshes
  "*/10 * * * *": [
    { name: "stocks_refresh" },
    { name: "sports_refresh_nba" },
    { name: "sports_refresh_nfl" },
    { name: "sports_refresh_mlb" },
    { name: "sports_refresh_nhl" },
  ],
  // Hourly — scans
  "0 * * * *": [
    { name: "research_scan" },
    { name: "stocks_news_scan" },
    { name: "predictions_resolve" },
  ],
  // Every 3 hours
  "0 */3 * * *": [
    { name: "industry_radar_refresh" },
    { name: "research_trends_update" },
  ],
  // Daily 6am UTC
  "0 6 * * *": [
    { name: "lesson_plan_refresh" },
    { name: "skills_radar_scan" },
    { name: "memory_summarize" },
    { name: "daily_briefing_generate" },
  ],
  // Weekday 9am/1pm/6pm
  "0 9,13,18 * * 1-5": [
    { name: "jobs_refresh" },
  ],
  // Weekday pre-market (13:00 UTC = 8am ET)
  "0 13 * * 1-5": [
    { name: "premarket_outliers" },
  ],
};

function getSubJobsForCron(cron: string): SubJob[] {
  const subjobs = FANOUT_MAP[cron];
  if (!subjobs || subjobs.length === 0) {
    console.warn(`[cron] No sub-jobs mapped for cron expression: "${cron}"`);
    return [];
  }
  return subjobs;
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

// ─── Inlined scoring/classification for worker (mirrors web/lib/rss.ts) ──

const SCORE_BOOSTS: { pattern: RegExp; boost: number }[] = [
  { pattern: /active.?exploit|exploit.?in.?the.?wild|under.?attack/i, boost: 30 },
  { pattern: /zero.?day|0.?day/i, boost: 25 },
  { pattern: /\bkev\b|known.?exploited/i, boost: 20 },
  { pattern: /critical.?patch|emergency.?patch|out.?of.?band/i, boost: 20 },
  { pattern: /ransomware|supply.?chain.?attack/i, boost: 18 },
  { pattern: /\bcve-\d{4}-\d{4,}\b/i, boost: 15 },
  { pattern: /government|healthcare|infrastructure|energy|financial/i, boost: 12 },
  { pattern: /data.?breach|leak|exposed/i, boost: 10 },
  { pattern: /microsoft|google|apple|cisco|fortinet|palo.?alto|crowdstrike/i, boost: 8 },
  { pattern: /\bai\b|artificial.?intelligence|llm|machine.?learning/i, boost: 5 },
];

function workerScoreItem(title: string, summary?: string | null): { score: number; urgency: string } {
  const text = `${title} ${summary || ""}`;
  let score = 10;
  for (const { pattern, boost } of SCORE_BOOSTS) {
    if (pattern.test(text)) score += boost;
  }
  score = Math.min(score, 100);
  const urgency = score >= 70 ? "critical" : score >= 50 ? "high" : score >= 30 ? "medium" : "low";
  return { score, urgency };
}

function workerClassifyType(title: string, summary?: string | null): string {
  const text = `${title} ${summary || ""}`.toLowerCase();
  if (/\bcve-\d{4}-\d{4,}\b/.test(text)) return "cve";
  if (/\badvisory\b|\balert\b|\bbulletin\b|\bkev\b|\bcisa\b/.test(text)) return "advisory";
  if (/\bpolicy\b|\bregulat\b|\bcompliance\b|\bexecutive order\b/.test(text)) return "policy";
  if (/\brumor\b|\bunconfirmed\b|\balleged\b/.test(text)) return "rumor";
  if (/\banalysis\b|\bdeep dive\b|\binvestigat\b|\bresearch\b|\breport\b/.test(text)) return "analysis";
  return "news";
}

function workerInferTags(title: string): string[] {
  const lower = title.toLowerCase();
  const tags: string[] = [];
  if (/\bai\b|artificial intelligence|machine learning|llm|gpt/i.test(lower)) tags.push("AI");
  if (/security|cyber|hack|breach|malware|vulnerability|cve|ransomware/i.test(lower)) tags.push("Security");
  if (/cloud|aws|azure|gcp|serverless|kubernetes/i.test(lower)) tags.push("Cloud");
  if (/vulnerabilit|cve-|exploit|zero.?day|patch/i.test(lower)) tags.push("Vulnerability");
  if (/policy|regulation|compliance|gdpr|government|law/i.test(lower)) tags.push("Policy");
  if (/privacy|data.?protection|surveillance/i.test(lower)) tags.push("Privacy");
  return tags.length > 0 ? tags : ["Tech"];
}

function workerMakeDedupeKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "source"]) {
      u.searchParams.delete(p);
    }
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString().toLowerCase();
  } catch {
    return url.replace(/[?#].*$/, "").toLowerCase();
  }
}

// ─── Job runners ─────────────────────────────────────

async function runResearchScan(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  let newItems = 0, sourcesFailed = 0;
  const sources = await db.prepare(`SELECT id, url FROM research_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all();
  const now = new Date().toISOString();
  for (const src of (sources.results || [])) {
    try {
      const res = await fetch(String(src.url), { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Cron/2.0" } });
      if (!res.ok) { sourcesFailed++; continue; }
      const xml = await res.text();
      for (const item of parseFeedItems(xml)) {
        if (!item.url || !item.title) continue;
        const tags = workerInferTags(item.title);
        const { score, urgency } = workerScoreItem(item.title, item.summary);
        const itemType = workerClassifyType(item.title, item.summary);
        const dedupeKey = workerMakeDedupeKey(item.url);
        try {
          await db.prepare(
            `INSERT OR IGNORE INTO research_items (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, score, urgency, item_type, dedupe_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), userId, String(src.id), item.title, item.url, item.publishedAt, now, item.summary, JSON.stringify(tags), score, urgency, itemType, dedupeKey).run();
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

// ─── Research Trends Update ──────────────────────────

async function runResearchTrendsUpdate(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  const now = new Date().toISOString();
  let updated = 0;

  try {
    // Count tag mentions in last 24h
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get all tags from recent items for 24h window
    const recent = await db.prepare(
      `SELECT tags_json FROM research_items WHERE user_id = ? AND fetched_at >= ?`
    ).bind(userId, since24h).all();

    const tagCounts24h: Record<string, number> = {};
    for (const row of (recent.results || [])) {
      try {
        const tags = JSON.parse(String(row.tags_json) || "[]") as string[];
        for (const tag of tags) {
          tagCounts24h[tag] = (tagCounts24h[tag] || 0) + 1;
        }
      } catch { /* skip bad JSON */ }
    }

    // Get 7d counts for momentum comparison
    const week = await db.prepare(
      `SELECT tags_json FROM research_items WHERE user_id = ? AND fetched_at >= ?`
    ).bind(userId, since7d).all();

    const tagCounts7d: Record<string, number> = {};
    for (const row of (week.results || [])) {
      try {
        const tags = JSON.parse(String(row.tags_json) || "[]") as string[];
        for (const tag of tags) {
          tagCounts7d[tag] = (tagCounts7d[tag] || 0) + 1;
        }
      } catch { /* skip bad JSON */ }
    }

    // Upsert trends for 24h window
    for (const [topic, count] of Object.entries(tagCounts24h)) {
      const weekAvg = (tagCounts7d[topic] || 0) / 7;
      const momentum = weekAvg > 0 ? count / weekAvg : count;
      const momentumRounded = Math.round(momentum * 100) / 100;
      try {
        // Delete existing then insert (D1 SQLite upsert workaround)
        await db.prepare(
          `DELETE FROM research_trends WHERE user_id = ? AND topic = ? AND window = '24h'`
        ).bind(userId, topic).run();
        await db.prepare(
          `INSERT INTO research_trends (id, user_id, topic, window, mention_count, momentum_score, updated_at)
           VALUES (?, ?, ?, '24h', ?, ?, ?)`
        ).bind(crypto.randomUUID(), userId, topic, count, momentumRounded, now).run();
        updated++;
      } catch { /* non-critical */ }
    }

    // Upsert trends for 7d window
    for (const [topic, count] of Object.entries(tagCounts7d)) {
      try {
        await db.prepare(
          `DELETE FROM research_trends WHERE user_id = ? AND topic = ? AND window = '7d'`
        ).bind(userId, topic).run();
        await db.prepare(
          `INSERT INTO research_trends (id, user_id, topic, window, mention_count, momentum_score, updated_at)
           VALUES (?, ?, ?, '7d', ?, 1.0, ?)`
        ).bind(crypto.randomUUID(), userId, topic, count, now).run();
      } catch { /* non-critical */ }
    }
  } catch (err) {
    console.warn("[cron] research_trends_update failed:", err instanceof Error ? err.message : err);
    return { items: updated, failed: 1 };
  }

  return { items: updated, failed: 0 };
}

// ─── Daily Briefing Generate ─────────────────────────

async function runDailyBriefingGenerate(db: D1Database, userId: string): Promise<{ items: number; failed: number }> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const items = await db.prepare(
      `SELECT title, score, urgency, url, tags_json
       FROM research_items WHERE user_id = ? AND fetched_at >= ?
       ORDER BY score DESC LIMIT 30`
    ).bind(userId, since).all();

    const rows = (items.results || []) as { title: string; score: number; urgency: string; url: string; tags_json?: string }[];
    if (rows.length === 0) return { items: 0, failed: 0 };

    // Rule-based briefing (no LLM cost)
    const top = rows.slice(0, 5);
    const lines = ["# Daily Intelligence Brief\n"];
    lines.push(`*Generated ${new Date().toISOString().slice(0, 10)} — Rule-based summary*\n`);
    lines.push("## Top Developments\n");

    for (let i = 0; i < top.length; i++) {
      const item = top[i];
      const badge = item.urgency === "critical" ? "🔴" : item.urgency === "high" ? "🟠" : item.urgency === "medium" ? "🟡" : "🟢";
      lines.push(`${i + 1}. ${badge} **${item.title}** (score: ${item.score})`);
      lines.push(`   - [Read more](${item.url})`);
    }

    const critical = rows.filter(i => i.urgency === "critical").length;
    const high = rows.filter(i => i.urgency === "high").length;
    lines.push("\n## Action Summary\n");
    if (critical > 0) lines.push(`- 🔴 **${critical} critical** items require immediate attention`);
    if (high > 0) lines.push(`- 🟠 **${high} high** priority items to review today`);
    lines.push(`- Total items scored: ${rows.length}`);

    const bodyMd = lines.join("\n");
    const now = new Date().toISOString();
    const title = `Daily Brief — ${now.slice(0, 10)}`;

    await db.prepare(
      `INSERT INTO research_briefings (id, user_id, title, scope, body_md, model_used, created_at)
       VALUES (?, ?, ?, 'daily', ?, 'rule-based', ?)`
    ).bind(crypto.randomUUID(), userId, title, bodyMd, now).run();

    return { items: 1, failed: 0 };
  } catch (err) {
    console.warn("[cron] daily_briefing_generate failed:", err instanceof Error ? err.message : err);
    return { items: 0, failed: 1 };
  }
}

// ─── Predictions resolver (inlined for worker) ──────

async function runPredictionsResolve(db: D1Database, userId: string): Promise<JobResult> {
  try {
    const now = new Date().toISOString();
    const rows = await db
      .prepare(`SELECT id, ticker, prediction_type, prediction_text, target_price, target_change_pct, confidence FROM stock_predictions WHERE user_id = ? AND status = 'open' AND due_at <= ?`)
      .bind(userId, now)
      .all<{ id: string; ticker: string; prediction_type: string; prediction_text: string; target_price: number | null; target_change_pct: number | null; confidence: number }>();
    const predictions = rows.results || [];
    let resolved = 0;

    for (const pred of predictions) {
      try {
        const quote = await db
          .prepare(`SELECT price, change_pct FROM stock_quotes WHERE user_id = ? AND ticker = ?`)
          .bind(userId, pred.ticker)
          .first<{ price: number; change_pct: number }>();
        if (!quote) continue;

        const actualChangePct = quote.change_pct || 0;
        const predictedUp = pred.prediction_text.toLowerCase().includes("up") ||
          pred.prediction_text.toLowerCase().includes("bull") ||
          (pred.target_change_pct !== null && pred.target_change_pct > 0);
        const hit = (pred.prediction_type === "direction")
          ? (predictedUp === (actualChangePct > 0) ? 1 : 0)
          : (pred.target_price !== null && quote.price >= pred.target_price ? 1 : 0);

        const forecastProb = pred.confidence / 100;
        const brierScore = Math.round(Math.pow(forecastProb - hit, 2) * 10000) / 10000;
        const outcomeJson = JSON.stringify({ actual_price: quote.price, actual_change_pct: actualChangePct, resolved_at: now });

        await db.prepare(
          `UPDATE stock_predictions SET status = 'resolved', resolved_at = ?, actual_outcome_json = ?, score_brier = ?, score_hit = ? WHERE id = ? AND user_id = ?`
        ).bind(now, outcomeJson, brierScore, hit, pred.id, userId).run();
        resolved++;
      } catch { /* individual failure */ }
    }

    // Update aggregate metrics
    if (resolved > 0) {
      for (const w of [{ name: "7d", days: 7 }, { name: "30d", days: 30 }, { name: "90d", days: 90 }]) {
        try {
          const since = new Date(Date.now() - w.days * 24 * 60 * 60 * 1000).toISOString();
          const stats = await db.prepare(
            `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
             AVG(CASE WHEN status = 'resolved' THEN score_hit ELSE NULL END) as hit_rate,
             AVG(CASE WHEN status = 'resolved' THEN score_brier ELSE NULL END) as avg_brier
             FROM stock_predictions WHERE user_id = ? AND created_at >= ?`
          ).bind(userId, since).first<{ total: number; resolved: number; hit_rate: number | null; avg_brier: number | null }>();
          if (stats) {
            await db.prepare(
              `INSERT OR REPLACE INTO stock_agent_metrics (user_id, window, total_predictions, resolved_predictions, hit_rate, avg_brier, calibration_score, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
            ).bind(userId, w.name, stats.total, stats.resolved, stats.hit_rate, stats.avg_brier, now).run();
          }
        } catch { /* non-fatal */ }
      }
    }

    return { items: resolved, failed: 0 };
  } catch (err) {
    console.warn("[cron] predictions_resolve failed:", err instanceof Error ? err.message : err);
    return { items: 0, failed: 1 };
  }
}

// ─── Pre-market outlier scanner (inlined for worker) ─

const OUTLIER_GAP_THRESHOLD = 3.0;

async function runPremarketOutliers(db: D1Database, userId: string): Promise<JobResult> {
  try {
    const now = new Date().toISOString();
    const qr = await db
      .prepare(`SELECT ticker, price, change_pct, premarket_price, premarket_change_pct, volume FROM stock_quotes WHERE user_id = ?`)
      .bind(userId)
      .all<{ ticker: string; price: number; change_pct: number; premarket_price: number | null; premarket_change_pct: number | null; volume: number | null }>();
    const quotes = qr.results || [];
    let outlierCount = 0;

    for (const q of quotes) {
      const changePct = q.premarket_change_pct ?? q.change_pct ?? 0;
      if (Math.abs(changePct) >= OUTLIER_GAP_THRESHOLD) {
        const type = changePct > 0 ? "gap_up" : "gap_down";
        const zScore = Math.abs(changePct) / OUTLIER_GAP_THRESHOLD;
        try {
          await db.prepare(
            `INSERT INTO stock_outliers (id, user_id, ticker, asof, outlier_type, z_score, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), userId, q.ticker, now, type, Math.round(zScore * 100) / 100,
            JSON.stringify({ change_pct: changePct, price: q.price, premarket_price: q.premarket_price, severity: zScore >= 2 ? "high" : "medium", source: "premarket_scout" })).run();
          outlierCount++;
        } catch { /* non-fatal */ }
      }
    }

    return { items: outlierCount, failed: 0 };
  } catch (err) {
    console.warn("[cron] premarket_outliers failed:", err instanceof Error ? err.message : err);
    return { items: 0, failed: 1 };
  }
}

// ─── Job dispatcher with retry ───────────────────────
type JobResult = { items: number; failed: number };

async function runJob(db: D1Database, userId: string, jobName: string): Promise<JobResult> {
  switch (jobName) {
    case "research_scan": return runResearchScan(db, userId);
    case "research_trends_update": return runResearchTrendsUpdate(db, userId);
    case "daily_briefing_generate": return runDailyBriefingGenerate(db, userId);
    case "jobs_refresh": return runJobsRefresh(db, userId);
    case "stocks_news_scan": return runStocksNewsScan(db, userId);
    case "skills_radar_scan": return runSkillsRadarScan(db, userId);
    case "lesson_plan_refresh": return runLessonPlanRefresh(db, userId);
    case "industry_radar_refresh": return runIndustryRadarRefresh(db, userId);
    case "memory_summarize": return runMemorySummarize(db, userId);
    case "predictions_resolve": return runPredictionsResolve(db, userId);
    case "premarket_outliers": return runPremarketOutliers(db, userId);
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

/**
 * Run a single sub-job with timeout + single retry.
 * Returns result or throws on permanent failure.
 */
async function runSubJobWithRetry(db: D1Database, userId: string, jobName: string, timeoutMs: number): Promise<JobResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Race the job against a hard timeout
      const result = await Promise.race([
        runJob(db, userId, jobName),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        console.warn(`[cron] pulse:${jobName} for ${userId} attempt ${attempt + 1} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ─── Main scheduled handler (fan-out dispatcher) ─────
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
    const subjobs = getSubJobsForCron(cron);
    console.log(`[cron] Triggered by "${cron}", fan-out to ${subjobs.length} sub-jobs: ${subjobs.map(s => s.name).join(", ")}`);

    const userIds = await getAllUserIds(db);
    if (userIds.length === 0) {
      console.log("[cron] No users found in user_settings — skipping");
      return;
    }

    // Daily-only jobs that use idempotency
    const dailyJobs = new Set(["lesson_plan_refresh", "memory_summarize", "skills_radar_scan", "daily_briefing_generate"]);

    for (const userId of userIds) {
      for (const subjob of subjobs) {
        const jobName = subjob.name;
        const pulseKey = `pulse:${jobName}_${userId}`;
        const timeout = subjob.timeoutMs ?? SUBJOB_TIMEOUT_MS;
        const start = Date.now();

        // Idempotency: skip daily jobs already completed today
        if (dailyJobs.has(jobName)) {
          const idemKey = makeIdempotencyKey(jobName, userId);
          if (await isAlreadyCompleted(db, idemKey)) {
            console.log(`[cron] pulse:${jobName} for ${userId}: already completed today, skipping`);
            continue;
          }
        }

        try {
          const result = await runSubJobWithRetry(db, userId, jobName, timeout);
          const tookMs = Date.now() - start;
          const totalSources = result.items + result.failed;
          const status = result.failed === 0 ? "ok" : (totalSources > 0 && result.failed < totalSources) ? "partial" : "error";

          // Log with pulse: prefix for individual sub-job tracking
          await updateCronRun(db, pulseKey, { status, itemsProcessed: result.items, tookMs });

          // Mark daily jobs as completed for idempotency
          if (dailyJobs.has(jobName)) {
            await markCompleted(db, makeIdempotencyKey(jobName, userId));
          }

          console.log(`[cron] pulse:${jobName} for ${userId}: ${status}, ${result.items} items, ${tookMs}ms`);
        } catch (err) {
          const tookMs = Date.now() - start;
          const errMsg = err instanceof Error ? err.message : String(err);
          await updateCronRun(db, pulseKey, { status: "error", itemsProcessed: 0, tookMs, error: errMsg });
          console.error(`[cron] pulse:${jobName} for ${userId} FAILED (${tookMs}ms): ${errMsg}`);
          // Failure isolation: continue to next sub-job
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
