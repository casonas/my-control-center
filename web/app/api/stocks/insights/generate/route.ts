export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const userId = session.user_id;

      // 1. Query recent news (limit 8)
      const newsResult = await db
        .prepare(
          `SELECT title, source, sentiment_score, catalyst_type, ticker, published_at
           FROM stock_news_items WHERE user_id = ?
           ORDER BY fetched_at DESC LIMIT 8`,
        )
        .bind(userId)
        .all<{
          title: string;
          source: string;
          sentiment_score: number | null;
          catalyst_type: string | null;
          ticker: string | null;
          published_at: string | null;
        }>();
      const newsItems = newsResult.results || [];

      // 2. Query recent outliers (limit 5)
      const outlierResult = await db
        .prepare(
          `SELECT ticker, outlier_type, z_score, details_json
           FROM stock_outliers WHERE user_id = ?
           ORDER BY asof DESC LIMIT 5`,
        )
        .bind(userId)
        .all<{
          ticker: string;
          outlier_type: string;
          z_score: number;
          details_json: string;
        }>();
      const outlierItems = outlierResult.results || [];

      // 3. Build bullets array
      const bullets: string[] = [];

      for (const o of outlierItems) {
        let details: Record<string, unknown> = {};
        try {
          details = JSON.parse(o.details_json);
        } catch { /* */ }
        const changePct = details.change_pct != null ? Number(details.change_pct) : null;
        const dir = changePct != null && changePct >= 0 ? "up" : "down";
        bullets.push(
          `${o.ticker} flagged as ${o.outlier_type.replace("_", " ")} outlier (z=${o.z_score.toFixed(1)}, ${dir}${changePct != null ? ` ${Math.abs(changePct).toFixed(1)}%` : ""})`,
        );
      }

      for (const n of newsItems) {
        const sentLabel =
          n.sentiment_score != null && n.sentiment_score > 0.2
            ? "bullish"
            : n.sentiment_score != null && n.sentiment_score < -0.2
              ? "bearish"
              : "neutral";
        const tickerPrefix = n.ticker ? `[${n.ticker}] ` : "";
        const catalystSuffix = n.catalyst_type ? ` (${n.catalyst_type})` : "";
        bullets.push(`${tickerPrefix}${n.title.slice(0, 100)} — ${sentLabel}${catalystSuffix}`);
      }

      // 4. Calculate sentiment from news sentiment_score average
      const sentScores = newsItems
        .filter((n) => n.sentiment_score != null)
        .map((n) => n.sentiment_score!);
      const avgSentiment =
        sentScores.length > 0
          ? sentScores.reduce((a, b) => a + b, 0) / sentScores.length
          : 0;
      const sentimentLabel =
        avgSentiment > 0.15 ? "bullish" : avgSentiment < -0.15 ? "bearish" : "neutral";
      const confidence = Math.min(
        100,
        Math.round(30 + newsItems.length * 5 + outlierItems.length * 8),
      );

      // 5. Insert into stock_insights (with schema fallback)
      const insightId = crypto.randomUUID();
      const now = new Date().toISOString();
      const title = `Market Briefing — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

      try {
        // Try new schema with scope/insight_type columns
        await db
          .prepare(
            `INSERT INTO stock_insights
             (id, user_id, ticker, title, bullets_json, sentiment, confidence, created_at, scope, insight_type)
             VALUES (?, ?, 'ALL', ?, ?, ?, ?, ?, 'market', 'briefing')`,
          )
          .bind(insightId, userId, title, JSON.stringify(bullets), sentimentLabel, confidence, now)
          .run();
      } catch {
        // Fallback: table may lack scope/insight_type columns
        await db
          .prepare(
            `INSERT INTO stock_insights
             (id, user_id, ticker, title, bullets_json, sentiment, confidence, created_at)
             VALUES (?, ?, 'ALL', ?, ?, ?, ?, ?)`,
          )
          .bind(insightId, userId, title, JSON.stringify(bullets), sentimentLabel, confidence, now)
          .run();
      }

      // 6. Return results
      return Response.json({
        ok: true,
        created: true,
        insightId,
        sentiment: sentimentLabel,
        confidence,
        bullets,
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/stocks/insights/generate", err);
    }
  });
}
