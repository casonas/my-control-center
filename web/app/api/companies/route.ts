export const runtime = "edge";
// web/app/api/companies/route.ts — List + Create companies

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ companies: [] });

    try {
      const result = await db
        .prepare(`SELECT * FROM companies WHERE user_id = ? ORDER BY name`)
        .bind(userId)
        .all();
      return Response.json({ companies: result.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/companies", err);
    }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as {
        name: string;
        websiteUrl?: string;
        linkedinUrl?: string;
        notes?: string;
      };

      if (!body.name) return Response.json({ error: "name is required" }, { status: 400 });

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT OR IGNORE INTO companies (id, user_id, name, website_url, linkedin_url, notes, is_watchlisted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .bind(id, session.user_id, body.name, body.websiteUrl || null, body.linkedinUrl || null, body.notes || null, now)
        .run();

      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) {
      return d1ErrorResponse("POST /api/companies", err);
    }
  });
}
