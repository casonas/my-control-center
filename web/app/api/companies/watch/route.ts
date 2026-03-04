export const runtime = "edge";
// web/app/api/companies/watch/route.ts — Companies to watch (big + emerging)

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { SEED_COMPANIES } from "@/lib/companiesSeed";

export async function GET() {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ companies: [] });

    try {
      // Check if seeded
      const count = await db
        .prepare(`SELECT COUNT(*) as cnt FROM companies_watch WHERE user_id = ?`)
        .bind(userId)
        .first<{ cnt: number }>();

      if (!count || count.cnt === 0) {
        // Seed default companies
        const now = new Date().toISOString();
        for (const c of SEED_COMPANIES) {
          const id = crypto.randomUUID();
          await db
            .prepare(
              `INSERT OR IGNORE INTO companies_watch (id, user_id, company_name, tier, source, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(id, userId, c.company_name, c.tier, c.source, c.notes, now, now)
            .run();
        }
      }

      // Fetch all watched companies with job counts
      const result = await db
        .prepare(
          `SELECT cw.*,
            (SELECT COUNT(*) FROM job_items ji WHERE ji.user_id = cw.user_id AND ji.company LIKE '%' || cw.company_name || '%' AND ji.status != 'dismissed') as matching_jobs
           FROM companies_watch cw WHERE cw.user_id = ?
           ORDER BY cw.tier, cw.company_name`
        )
        .bind(userId)
        .all();

      return Response.json({ companies: result.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/companies/watch", err);
    }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = await req.json() as {
        company_name: string;
        tier?: "big" | "emerging";
        source?: string;
        notes?: string;
      };

      if (!body.company_name) {
        return Response.json({ error: "company_name is required" }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT OR REPLACE INTO companies_watch (id, user_id, company_name, tier, source, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, session.user_id, body.company_name, body.tier || "emerging", body.source || "manual", body.notes || null, now, now)
        .run();

      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) {
      return d1ErrorResponse("POST /api/companies/watch", err);
    }
  });
}
