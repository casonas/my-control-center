export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";
import { parseFeed } from "@/lib/rss";

const STOCK_NEWS_FEEDS = [
  { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
];

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ items: [] });
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    try {
      const r = await db.prepare(`SELECT * FROM stock_news_items WHERE user_id = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`)
        .bind(userId, limit, offset).all();
      return Response.json({ items: r.results || [] });
    } catch { return Response.json({ items: [] }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    // This is the scan endpoint — invoked via POST to /api/stocks/news
    return await scanStockNews(db, session.user_id);
  });
}

async function scanStockNews(db: ReturnType<typeof getD1> & object, userId: string) {
  const start = Date.now();
  let newItems = 0;
  const now = new Date().toISOString();

  for (const feed of STOCK_NEWS_FEEDS) {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MCC-Stocks/1.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseFeed(xml);
      for (const item of items) {
        if (!item.url || !item.title) continue;
        const id = crypto.randomUUID();
        const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
        try {
          await db.prepare(
            `INSERT OR IGNORE INTO stock_news_items (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?)`
          ).bind(id, userId, item.title.slice(0, 300), feed.name, item.url, item.publishedAt, now, item.summary?.slice(0, 400) || null, dedupeKey).run();
          newItems++;
        } catch { /* dedupe */ }
      }
    } catch { /* feed error */ }
  }

  try {
    await db.prepare(`INSERT OR REPLACE INTO cron_runs (job_name, last_run_at, status, items_processed, error) VALUES (?, ?, 'success', ?, NULL)`)
      .bind(`stocks_news_scan_${userId}`, now, newItems).run();
  } catch { /* non-fatal */ }

  return Response.json({ ok: true, newItems, sources: STOCK_NEWS_FEEDS.length, tookMs: Date.now() - start });
}
