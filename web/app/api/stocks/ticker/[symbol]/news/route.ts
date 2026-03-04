export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";
import { getStockIntelProvider } from "@/lib/stockProviders";

/**
 * GET /api/stocks/ticker/[symbol]/news — ticker-specific news
 * Tries Stock Intel API first, then falls back to D1 cache.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  return withReadAuth(async ({ userId }) => {
    const { symbol } = await params;
    const ticker = symbol.toUpperCase();

    // 1. Try Stock Intel API
    try {
      const provider = getStockIntelProvider();
      const { items, health } = await provider.getTickerNews(ticker);
      if (health.status === "ok" && items.length > 0) {
        return Response.json({
          items: items.slice(0, 20).map((item) => ({
            title: String(item.title || item.headline || ""),
            url: String(item.url || item.link || ""),
            source: String(item.source || "stock-intel"),
            published_at: String(item.published_at || item.date || ""),
            summary: String(item.summary || item.description || "").slice(0, 400),
            sentiment_score: item.sentiment_score != null ? Number(item.sentiment_score) : null,
          })),
          source: "stock-intel",
        });
      }
    } catch { /* fall through to D1 */ }

    // 2. Fallback to D1
    const db = getD1();
    if (!db) return Response.json({ items: [], source: "none" });

    try {
      const r = await db
        .prepare(
          `SELECT title, url, source, published_at, summary, sentiment_score
           FROM stock_news_items WHERE user_id = ? AND ticker = ?
           ORDER BY fetched_at DESC LIMIT 20`,
        )
        .bind(userId, ticker)
        .all();

      return Response.json({ items: r.results || [], source: "d1-cache" });
    } catch (err) {
      console.error("[stocks/ticker/news]", err);
      return Response.json({ items: [], error: err instanceof Error ? err.message : String(err) });
    }
  });
}
