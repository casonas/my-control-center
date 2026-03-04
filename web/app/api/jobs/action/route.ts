export const runtime = "edge";

/**
 * POST /api/jobs/action — Proxy job actions to external jobs API.
 * Body: { url, action } where action is "saved" | "applied" | "dismissed"
 */
export async function POST(req: Request) {
  const baseUrl = process.env.JOBS_API_URL || "https://jobs-api.my-control-center.com";

  try {
    const body = await req.json();
    const res = await fetch(`${baseUrl}/jobs/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "MCC-Jobs/1.0", Accept: "application/json" },
      body: JSON.stringify(body),
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
