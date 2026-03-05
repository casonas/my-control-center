export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";
import { parseFeed } from "@/lib/rss";
import { scanNewsFeeds, getStockIntelProvider } from "@/lib/stockProviders";

const COOLDOWN_MS = 30 * 60 * 1000;

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const start = Date.now();
    const userId = session.user_id;
    const jobName = `stocks_news_scan_${userId}`;

    try {
      const lastRun = await db.prepare(`SELECT last_run_at FROM cron_runs WHERE job_name = ?`).bind(jobName).first<{ last_run_at: string }>();
      if (lastRun?.last_run_at) {
        const elapsed = Date.now() - new Date(lastRun.last_run_at).getTime();
        if (elapsed < COOLDOWN_MS) {
          return Response.json({
            ok: true,
            newItems: 0,
            skipped: true,
            reason: `cooldown_${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s`,
            tookMs: Date.now() - start,
          });
        }
      }
    } catch {
      // non-fatal
    }

    const intel = getStockIntelProvider();
    const result = await scanNewsFeeds(db, userId, parseFeed, intel);
    try {
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error)
         VALUES (?, ?, 'success', ?, NULL)`,
      ).bind(jobName, now, result.newItems).run();
    } catch { /* non-fatal */ }
    return Response.json({
      ok: true,
      newItems: result.newItems,
      sources: result.sources,
      staleFallbackUsed: result.staleFallbackUsed,
      tookMs: Date.now() - start,
    });
  });
}
