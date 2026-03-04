export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getStockIntelProvider } from "@/lib/stockProviders";

/**
 * GET /api/stocks/ticker/[symbol]/why — "why is this ticker moving" analysis
 * Returns provider.getTickerWhy(symbol) analysis.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  return withReadAuth(async () => {
    const { symbol } = await params;
    const ticker = symbol.toUpperCase();

    try {
      const provider = getStockIntelProvider();
      const { analysis, health } = await provider.getTickerWhy(ticker);

      if (health.status === "ok" && analysis) {
        return Response.json({
          ok: true,
          ticker,
          analysis,
          source: "stock-intel",
        });
      }

      return Response.json({
        ok: true,
        ticker,
        analysis: null,
        source: "unavailable",
        note: "Stock Intel API unavailable — analysis not available at this time",
      });
    } catch (err) {
      console.error("[stocks/ticker/why]", err);
      return Response.json({
        ok: false,
        ticker,
        analysis: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
