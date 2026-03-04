export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";
import { parseFeed } from "@/lib/rss";
import { scanNewsFeeds } from "@/lib/stockProviders";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const start = Date.now();
    const result = await scanNewsFeeds(db, session.user_id, parseFeed);
    try {
      const now = new Date().toISOString();
      await db.prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
        .bind(`stocks_news_scan_${session.user_id}`, now, result.newItems).run();
    } catch { /* non-fatal */ }
    return Response.json({ ok: true, newItems: result.newItems, sources: result.sources, tookMs: Date.now() - start });
  });
}
