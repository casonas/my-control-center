import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

export async function GET() {
  const { env } = getRequestContext();
  const DB = (env as any).DB as D1Database;

  const row = await DB
    .prepare("SELECT COUNT(*) as n FROM sessions")
    .first<{ n: number }>();

  return Response.json({
    ok: true,
    sessions_count: row?.n ?? null,
  });
}
