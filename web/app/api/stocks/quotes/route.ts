export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";
import { loadCachedQuotes, loadCachedIndices } from "@/lib/stockProviders";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ quotes: [], indices: [], freshness: null, sourceHealth: [] });

    const url = new URL(req.url);
    const includeTickers = url.searchParams.get("tickers"); // optional CSV filter

    const [qResult, iResult] = await Promise.all([
      loadCachedQuotes(db, userId),
      loadCachedIndices(db, userId),
    ]);

    let quotes = qResult.quotes;
    if (includeTickers) {
      const set = new Set(includeTickers.split(",").map((t) => t.trim().toUpperCase()));
      quotes = quotes.filter((q) => set.has(q.ticker));
    }

    return Response.json({
      quotes,
      indices: iResult.indices,
      freshness: qResult.freshness || iResult.freshness || null,
      sourceHealth: [],
    });
  });
}
