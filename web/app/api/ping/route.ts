
export async function GET() {
  return Response.json({ ok: true, ping: true, ts: Date.now() });
}
