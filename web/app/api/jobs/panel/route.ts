export const runtime = "edge";

/**
 * GET /api/jobs/panel — Proxy to external jobs API.
 * Forwards limit/offset params and returns the JSON response.
 */
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || "10")));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
    const status = (url.searchParams.get("status") || "").trim();
    const locationMode = (url.searchParams.get("location_mode") || "").trim();

    const baseUrl = process.env.JOBS_API_URL || "https://jobs-api.my-control-center.com";
    const apiUrl = new URL(`${baseUrl}/jobs/panel`);
    apiUrl.searchParams.set("limit", String(limit));
    apiUrl.searchParams.set("offset", String(offset));
    if (status) apiUrl.searchParams.set("status", status);
    if (locationMode) apiUrl.searchParams.set("location_mode", locationMode);

    try {
      const res = await fetch(apiUrl.toString(), {
        headers: { "User-Agent": "MCC-Jobs/1.0", Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json();
        return Response.json(data);
      }
    } catch {
      // fall back to local D1 below
    }

    const db = getD1();
    if (!db) {
      return Response.json({ error: "Jobs API unavailable and D1 not configured" }, { status: 502 });
    }

    const nowIso = new Date().toISOString();
    const where = status && status !== "all" ? "AND status = ?" : "";
    const binds: Array<string | number> = [userId];
    if (where) binds.push(status);
    binds.push(limit, offset);

    const shortlist = await db.prepare(
      `SELECT id, title, company, location, url, status, posted_at, fetched_at, remote_flag, match_score, why_match
       FROM job_items
       WHERE user_id = ? ${where}
       ORDER BY match_score DESC, fetched_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...binds).all();

    const pipelineRows = await db.prepare(
      `SELECT status, COUNT(*) AS cnt
       FROM job_items
       WHERE user_id = ?
       GROUP BY status`,
    ).bind(userId).all<{ status: string; cnt: number }>();

    const pipeline: Record<string, number> = {};
    let total = 0;
    for (const row of pipelineRows.results || []) {
      const count = Number(row.cnt || 0);
      pipeline[row.status] = count;
      total += count;
    }

    const companies = await db.prepare(
      `SELECT company_name, tier, source, notes,
        (SELECT COUNT(*) FROM job_items ji WHERE ji.user_id = cw.user_id AND ji.company LIKE '%' || cw.company_name || '%' AND ji.status != 'dismissed') AS matching_jobs
       FROM companies_watch cw
       WHERE user_id = ?
       ORDER BY matching_jobs DESC, company_name ASC
       LIMIT 20`,
    ).bind(userId).all();

    return Response.json({
      cards: {
        total,
        saved: pipeline.saved || 0,
        applied: pipeline.applied || 0,
        interview: pipeline.interview || 0,
      },
      pipeline,
      shortlist: shortlist.results || [],
      companies_to_watch: companies.results || [],
      outreach_templates: ["cold_email", "linkedin_connect", "follow_up", "thank_you"],
      health: {
        status: "degraded",
        message: `External jobs API unavailable. Serving local cache as of ${nowIso}.`,
      },
      source: "local-fallback",
    });
  });
}
