import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

type D1Like = {
  prepare: (sql: string) => {
    first: <T = Record<string, unknown>>() => Promise<T | null>;
  };
};

export async function GET() {
  const { env } = getRequestContext();
  const DB = (env as unknown as { DB: D1Like }).DB;

  const row = await DB
    .prepare("SELECT COUNT(*) as n FROM sessions")
    .first<{ n: number }>();

  return Response.json({
    ok: true,
    sessions_count: row?.n ?? null,
  });
}
