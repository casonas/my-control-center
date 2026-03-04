export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ regime: null });
    try {
      const r = await db.prepare(`SELECT * FROM market_regime_snapshots WHERE user_id = ? ORDER BY asof DESC LIMIT 1`).bind(userId).first();
      return Response.json({ regime: r || null });
    } catch { return Response.json({ regime: null }); }
  });
}
