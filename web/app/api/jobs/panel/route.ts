export const runtime = "edge";

/**
 * GET /api/jobs/panel — Proxy to external jobs API.
 * Forwards limit/offset params and returns the JSON response.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = url.searchParams.get("limit") || "10";
  const offset = url.searchParams.get("offset") || "0";
  const status = url.searchParams.get("status") || "";

  const baseUrl = process.env.JOBS_API_URL || "https://jobs-api.my-control-center.com";
  const apiUrl = new URL(`${baseUrl}/jobs/panel`);
  apiUrl.searchParams.set("limit", limit);
  apiUrl.searchParams.set("offset", offset);
  if (status) apiUrl.searchParams.set("status", status);

  try {
    const res = await fetch(apiUrl.toString(), {
      headers: { "User-Agent": "MCC-Jobs/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return Response.json(
        { error: `Upstream API returned ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
