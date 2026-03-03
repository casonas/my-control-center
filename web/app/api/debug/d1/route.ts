export const runtime = "edge";

import { getD1 } from "@/lib/d1";

export async function GET() {
  const db = getD1();
  if (!db) {
    return Response.json(
      { ok: false, error: "DB binding not found — check Pages → Settings → Functions → D1 database bindings" },
      { status: 500 }
    );
  }

  const row = await db.prepare("SELECT COUNT(*) as n FROM sessions").first<{ n: number }>();
  return Response.json({ ok: true, sessions_count: row?.n ?? null });
}
