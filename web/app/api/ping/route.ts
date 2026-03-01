export const runtime = "edge";

export async function GET() {
  return Response.json({ ok: true, ping: true, ts: Date.now() });
}
