import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

export async function GET() {
  const { env } = getRequestContext();
  const DB = (env as any).DB;

  const row = await DB
    .prepare("SELECT COUNT(*) as n FROM sessions")
    .first();

  return Response.json({
    ok: true,
    sessions_count: row?.n ?? null,
  });
}
