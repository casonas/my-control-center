export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const DEFAULT_CONNECTORS = [
  { connector_key: "d1", status: "ok", details: "Database binding active" },
  { connector_key: "rss", status: "pending", details: "Not checked" },
  { connector_key: "worker", status: "pending", details: "Not checked" },
  { connector_key: "r2", status: "pending", details: "Not checked" },
  { connector_key: "pages", status: "ok", details: "Serving requests" },
];

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ connectors: DEFAULT_CONNECTORS });

    try {
      const r = await db
        .prepare(`SELECT * FROM connector_status WHERE user_id = ?`)
        .bind(userId)
        .all();
      const connectors = r.results && r.results.length > 0 ? r.results : DEFAULT_CONNECTORS;
      return Response.json({ connectors });
    } catch (err) {
      return d1ErrorResponse("GET /api/settings/connectors/status", err);
    }
  });
}
