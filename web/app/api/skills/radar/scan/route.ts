export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { parseFeed, inferTags } from "@/lib/rss";

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

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

      let newItems = 0;
      const now = new Date().toISOString();
      const suggestions = new Map<string, string>(); // skill -> reason

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
              for (const kw of TRENDING_KEYWORDS) {
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
