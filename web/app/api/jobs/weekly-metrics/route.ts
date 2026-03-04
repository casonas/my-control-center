export const runtime = "edge";

/**
 * GET /api/jobs/weekly-metrics — Proxy weekly metrics from external jobs API.
 */
export async function GET() {
  const baseUrl = process.env.JOBS_API_URL || "https://jobs-api.my-control-center.com";

  try {
    const res = await fetch(`${baseUrl}/jobs/weekly-metrics`, {
      headers: { "User-Agent": "MCC-Jobs/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return Response.json({ error: `Upstream API returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
