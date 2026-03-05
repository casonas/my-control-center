export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import type { D1Database } from "@/lib/d1";
import { parseFeed, inferTags } from "@/lib/rss";

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

const DEFAULT_RADAR_SOURCES = [
  { name: "Hacker News", url: "https://hnrss.org/newest?points=100" },
  { name: "Dev.to", url: "https://dev.to/feed" },
  { name: "InfoSec Write-ups", url: "https://infosecwriteups.com/feed" },
  { name: "SANS ISC", url: "https://isc.sans.edu/rssfeed.xml" },
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
  { name: "BleepingComputer Security", url: "https://www.bleepingcomputer.com/feed/" },
  { name: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews" },
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
  { pattern: /threat.?hunt(ing)?/i, skill: "Threat Hunting" },
  { pattern: /detection.?engineering|sigma/i, skill: "Detection Engineering" },
  { pattern: /siem|xdr|soar/i, skill: "SIEM / XDR / SOAR" },
  { pattern: /incident.?response|dfir/i, skill: "Incident Response (DFIR)" },
  { pattern: /cloud.?security|cspm|cwpp|cnapp/i, skill: "Cloud Security" },
  { pattern: /identity|iam|okta|entra/i, skill: "Identity & Access Management" },
  { pattern: /pentest|red.?team|offensive.?security/i, skill: "Offensive Security" },
  { pattern: /malware|reverse.?engineer/i, skill: "Malware Analysis & Reverse Engineering" },
  { pattern: /rag\b|retrieval.?augmented/i, skill: "RAG & LLM Applications" },
];

type RadarSource = { name: string; url: string };
type DynamicKeyword = { pattern: RegExp; skill: string };

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toDynamicKeyword(skillName: string): DynamicKeyword | null {
  const s = skillName.trim();
  if (!s) return null;
  if (s.length > 80) return null;
  const pattern = new RegExp(`\\b${escapeRegex(s).replace(/\\ /g, "\\s+")}\\b`, "i");
  return { pattern, skill: s };
}

async function loadUserRadarConfig(
  db: D1Database,
  userId: string,
): Promise<{ sources: RadarSource[]; keywords: DynamicKeyword[] }> {
  try {
    const row = await db.prepare(`SELECT settings_json FROM user_settings WHERE user_id = ?`).bind(userId).first<{ settings_json: string }>();
    if (!row?.settings_json) return { sources: [], keywords: [] };
    const parsed = JSON.parse(row.settings_json) as Record<string, unknown>;
    const radar = (parsed.skills_radar && typeof parsed.skills_radar === "object")
      ? (parsed.skills_radar as Record<string, unknown>)
      : {};

    const rawSources = Array.isArray(radar.sources) ? radar.sources : [];
    const sources: RadarSource[] = [];
    for (const src of rawSources.slice(0, 20)) {
      if (!src || typeof src !== "object") continue;
      const s = src as Record<string, unknown>;
      const name = String(s.name || "").trim();
      const url = String(s.url || "").trim();
      if (!name || !url || !/^https?:\/\//i.test(url)) continue;
      sources.push({ name: name.slice(0, 80), url: url.slice(0, 300) });
    }

    const rawSkills = Array.isArray(radar.skills) ? radar.skills : [];
    const keywords: DynamicKeyword[] = [];
    for (const sk of rawSkills.slice(0, 40)) {
      const kw = toDynamicKeyword(String(sk || ""));
      if (kw) keywords.push(kw);
    }

    return { sources, keywords };
  } catch {
    return { sources: [], keywords: [] };
  }
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const userId = session.user_id;
    const start = Date.now();

    try {
      // Throttle
      const jobKey = `skills_radar_scan_${userId}`;
      const lastRun = await db.prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`).bind(jobKey).first<{ last_run_at: string }>();
      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < COOLDOWN_MS) return Response.json({ ok: false, error: `Wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s` }, { status: 429 });
      }

      // Load user-configurable radar settings from user_settings.settings_json.skills_radar
      const dynamicConfig = await loadUserRadarConfig(db, userId);

      // Ensure sources
      const srcResult = await db.prepare(`SELECT id, name, url FROM skill_radar_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all<{ id: string; name: string; url: string }>();
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
      // Upsert dynamic sources without replacing user toggles.
      if (dynamicConfig.sources.length > 0) {
        const now = new Date().toISOString();
        for (const src of dynamicConfig.sources) {
          const existing = await db.prepare(
            `SELECT id FROM skill_radar_sources WHERE user_id = ? AND url = ? LIMIT 1`,
          ).bind(userId, src.url).first<{ id: string }>();
          if (!existing?.id) {
            await db.prepare(
              `INSERT INTO skill_radar_sources (id, user_id, name, url, enabled, created_at)
               VALUES (?, ?, ?, ?, 1, ?)`,
            ).bind(crypto.randomUUID(), userId, src.name, src.url, now).run();
          }
        }
        const refreshed = await db.prepare(`SELECT id, name, url FROM skill_radar_sources WHERE user_id = ? AND enabled = 1`).bind(userId).all<{ id: string; name: string; url: string }>();
        sources = refreshed.results || [];
      }

      let newItems = 0;
      const now = new Date().toISOString();
      const suggestions = new Map<string, string>(); // skill -> reason
      const allKeywords = [...TRENDING_KEYWORDS, ...dynamicConfig.keywords];

      for (const source of sources) {
        try {
          const res = await fetch(source.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Radar/1.0" } });
          if (!res.ok) continue;
          const xml = await res.text();
          const items = parseFeed(xml);
          for (const item of items) {
            if (!item.url || !item.title) continue;
            const id = crypto.randomUUID();
            const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
            const tags = inferTags(item.title);
            try {
              await db.prepare(
                `INSERT OR IGNORE INTO skill_radar_items (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, relevance_score, dedupe_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
              ).bind(id, userId, source.id, item.title.slice(0, 300), item.url, item.publishedAt, now, item.summary?.slice(0, 400) || null, JSON.stringify(tags), dedupeKey).run();
              newItems++;
              // Check for trending skills
              for (const kw of allKeywords) {
                if (kw.pattern.test(item.title)) {
                  suggestions.set(kw.skill, `Trending in "${source.name}": ${item.title.slice(0, 80)}`);
                }
              }
            } catch { /* dedupe */ }
          }
        } catch { /* feed error */ }
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

      await db.prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
        .bind(jobKey, now, newItems).run();

      return Response.json({ ok: true, newItems, sources: sources.length, suggestions: suggestions.size, tookMs: Date.now() - start });
    } catch (err) { return d1ErrorResponse("POST /api/skills/radar/scan", err); }
  });
}
