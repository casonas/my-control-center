export const runtime = "edge";
// web/app/api/research/scan/route.ts — Trigger real RSS scan

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { parseFeed, inferTags, DEFAULT_SOURCES } from "@/lib/rss";

const SCAN_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) {
      return Response.json({ ok: false, error: "D1 not available", hint: "Research scan requires D1 binding" }, { status: 500 });
    }

    const userId = session.user_id;
    const start = Date.now();

    try {
      // Rate limit: check last run
      const lastRun = await db
        .prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`)
        .bind(`research_scan_${userId}`)
        .first<{ last_run_at: string }>();

      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < SCAN_COOLDOWN_MS) {
          const waitSec = Math.ceil((SCAN_COOLDOWN_MS - elapsed) / 1000);
          return Response.json(
            { ok: false, error: `Please wait ${waitSec}s before scanning again` },
            { status: 429 }
          );
        }
      }

      // Ensure default sources exist
      const sourcesResult = await db
        .prepare(`SELECT id, name, url FROM research_sources WHERE user_id = ? AND enabled = 1`)
        .bind(userId)
        .all<{ id: string; name: string; url: string }>();

      let sources = sourcesResult.results || [];

      if (sources.length === 0) {
        // Seed defaults
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

      // Fetch each feed
      let newItems = 0;
      const now = new Date().toISOString();

      for (const source of sources) {
        try {
          const res = await fetch(source.url, {
            signal: AbortSignal.timeout(8000),
            headers: { "User-Agent": "MCC-Research/1.0" },
          });
          if (!res.ok) continue;

          const xml = await res.text();
          const items = parseFeed(xml);

          for (const item of items) {
            if (!item.url || !item.title) continue;

            const id = crypto.randomUUID();
            const tags = inferTags(item.title);

            try {
              await db
                .prepare(
                  `INSERT OR IGNORE INTO research_items
                   (id, user_id, source_id, title, url, published_at, fetched_at, summary, tags_json, score)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
                )
                .bind(
                  id,
                  userId,
                  source.id,
                  item.title,
                  item.url,
                  item.publishedAt,
                  now,
                  item.summary,
                  JSON.stringify(tags)
                )
                .run();
              newItems++;
            } catch {
              // Duplicate URL — expected via UNIQUE constraint
            }
          }
        } catch {
          // Feed fetch failed — continue with others
        }
      }

      // Update cron_runs
      await db
        .prepare(
          `INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error)
           VALUES (?, ?, 'success', ?, NULL)`
        )
        .bind(`research_scan_${userId}`, now, newItems)
        .run();

      return Response.json({
        ok: true,
        newItems,
        sources: sources.length,
        tookMs: Date.now() - start,
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/research/scan", err);
    }
  });
}

