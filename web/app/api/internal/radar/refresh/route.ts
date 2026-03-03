export const runtime = "edge";
// web/app/api/internal/radar/refresh/route.ts
//
// POST /api/internal/radar/refresh
// Input:  { userId }
// Output: { newItems, scored, suggestions, budget }
//
// Pipeline: RSS ingest → dedupe (non-LLM) → score/classify (non-LLM keyword matching)
//           → cheap LLM summarize top-N only → write to D1
// Budget-aware: checks daily limits before any LLM calls.

import { withHmacAuth } from "@/lib/hmacAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { parseFeed, inferTags } from "@/lib/rss";
import {
  checkBudget,
  recordUsage,
  enforceJobCaps,
  DEFAULT_JOB_CAPS,
} from "@/lib/budget";

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

const CATEGORY_KEYWORDS: { pattern: RegExp; category: string; score: number }[] = [
  { pattern: /zero.?trust/i,               category: "security",       score: 80 },
  { pattern: /sbom|software.?bill/i,        category: "security",       score: 75 },
  { pattern: /kubernetes|k8s|helm/i,        category: "infrastructure", score: 70 },
  { pattern: /\brust\b/i,                   category: "language",       score: 65 },
  { pattern: /\bwasm\b|webassembly/i,       category: "runtime",        score: 70 },
  { pattern: /devsecops|ci.?cd|pipeline/i,  category: "devops",         score: 65 },
  { pattern: /rag\b|retrieval.?augmented/i, category: "ai",             score: 75 },
  { pattern: /\bllm\b|large.?language/i,    category: "ai",             score: 70 },
  { pattern: /cloud.?native|serverless/i,   category: "cloud",          score: 60 },
  { pattern: /terraform|pulumi|iac/i,       category: "infrastructure", score: 65 },
  { pattern: /observability|opentelemetry/i, category: "monitoring",    score: 60 },
  { pattern: /supply.?chain|sca\b/i,        category: "security",       score: 70 },
];

const SUGGESTION_KEYWORDS = [
  { pattern: /zero.?trust/i,               skill: "Zero Trust Architecture" },
  { pattern: /sbom|software.?bill/i,        skill: "SBOM & Supply Chain Security" },
  { pattern: /kubernetes|k8s/i,             skill: "Kubernetes" },
  { pattern: /\brust\b/i,                   skill: "Rust Programming" },
  { pattern: /\bwasm\b|webassembly/i,       skill: "WebAssembly" },
  { pattern: /devsecops/i,                  skill: "DevSecOps" },
  { pattern: /rag\b|retrieval.?augmented/i, skill: "RAG & LLM Applications" },
];

function scoreAndClassify(title: string): { category: string | null; score: number } {
  let bestScore = 0;
  let bestCategory: string | null = null;
  for (const kw of CATEGORY_KEYWORDS) {
    if (kw.pattern.test(title) && kw.score > bestScore) {
      bestScore = kw.score;
      bestCategory = kw.category;
    }
  }
  return { category: bestCategory, score: bestScore };
}

interface RefreshRequest {
  userId: string;
}

function validateInput(body: unknown): RefreshRequest {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== "object") throw new Error("Invalid request body");
  if (typeof b.userId !== "string" || b.userId.length === 0) throw new Error("userId is required");
  return { userId: b.userId };
}

export async function POST(req: Request) {
  return withHmacAuth(req, async () => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    let input: RefreshRequest;
    try {
      const body = await req.json();
      input = validateInput(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid input";
      return Response.json({ ok: false, error: msg }, { status: 400 });
    }

    const start = Date.now();

    try {
      // Check budget
      const budgetCheck = await checkBudget(db, input.userId, "radar");
      if (!budgetCheck.allowed) {
        return Response.json({
          ok: false,
          error: budgetCheck.reason,
          budget: budgetCheck.remaining,
        }, { status: 429 });
      }

      const caps = enforceJobCaps(DEFAULT_JOB_CAPS.radar, budgetCheck);

      // Ensure sources exist
      const srcResult = await db
        .prepare(`SELECT id, name, url FROM skill_radar_sources WHERE user_id = ? AND enabled = 1`)
        .bind(input.userId)
        .all<{ id: string; name: string; url: string }>();
      let sources = srcResult.results || [];

      if (sources.length === 0) {
        const now = new Date().toISOString();
        for (const src of DEFAULT_RADAR_SOURCES) {
          const id = crypto.randomUUID();
          await db
            .prepare(`INSERT OR IGNORE INTO skill_radar_sources (id, user_id, name, url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`)
            .bind(id, input.userId, src.name, src.url, now)
            .run();
        }
        const refreshed = await db
          .prepare(`SELECT id, name, url FROM skill_radar_sources WHERE user_id = ? AND enabled = 1`)
          .bind(input.userId)
          .all<{ id: string; name: string; url: string }>();
        sources = refreshed.results || [];
      }

      let newItems = 0;
      let scored = 0;
      let sourcesFailed = 0;
      const now = new Date().toISOString();
      const suggestions = new Map<string, string>();

      for (const source of sources) {
        try {
          const res = await fetch(source.url, {
            signal: AbortSignal.timeout(8000),
            headers: { "User-Agent": "MCC-Radar/1.0" },
          });
          if (!res.ok) { sourcesFailed++; continue; }
          const xml = await res.text();
          const items = parseFeed(xml);

          for (const item of items) {
            if (!item.url || !item.title) continue;
            if (newItems >= caps.maxItems * 10) break; // Cap total RSS items ingested

            const id = crypto.randomUUID();
            const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
            const tags = inferTags(item.title);
            const { category, score } = scoreAndClassify(item.title);

            try {
              await db
                .prepare(
                  `INSERT OR IGNORE INTO skill_radar_items
                   (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, relevance_score, dedupe_key, category, processed)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
                )
                .bind(
                  id, input.userId, source.id,
                  item.title.slice(0, 300), item.url,
                  item.publishedAt, now,
                  item.summary?.slice(0, 400) || null,
                  JSON.stringify(tags),
                  score, dedupeKey,
                  category
                )
                .run();
              newItems++;
              if (score > 0) scored++;

              // Check for trending skill suggestions
              for (const kw of SUGGESTION_KEYWORDS) {
                if (kw.pattern.test(item.title)) {
                  suggestions.set(kw.skill, `Trending in "${source.name}": ${item.title.slice(0, 80)}`);
                }
              }
            } catch { /* dedupe — item already exists */ }
          }
        } catch { sourcesFailed++; }
      }

      // Create skill suggestions
      for (const [skillName, reason] of suggestions) {
        const sugId = crypto.randomUUID();
        try {
          await db
            .prepare(
              `INSERT OR IGNORE INTO skill_suggestions (id, user_id, proposed_skill_name, reason_md, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'new', ?, ?)`
            )
            .bind(sugId, input.userId, skillName, reason, now, now)
            .run();
        } catch { /* dedupe */ }
      }

      // Record usage (zero cost for non-LLM pipeline)
      await recordUsage(db, input.userId, "radar", "non-llm", 0, 0);

      const tookMs = Date.now() - start;

      return Response.json({
        ok: true,
        newItems,
        scored,
        sources: sources.length,
        sourcesFailed,
        suggestions: suggestions.size,
        tookMs,
        budget: budgetCheck.remaining,
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/internal/radar/refresh", err);
    }
  });
}
