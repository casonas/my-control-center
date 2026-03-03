export const runtime = "edge";

import { getRequestContext } from "@cloudflare/next-on-pages";

type D1Like = {
  prepare: (sql: string) => {
    first: <T = Record<string, unknown>>() => Promise<T | null>;
  };
};

export async function GET() {
  const { env } = getRequestContext();
  const keys = Object.keys(env ?? {});

  const DB = (env as any).DB as D1Like | undefined;
  if (!DB) {
    return Response.json(
      { ok: false, error: "DB binding not found on env", env_keys: keys },
      { status: 500 }
    );
  }

  const row = await DB.prepare("SELECT COUNT(*) as n FROM sessions").first<{ n: number }>();
  return Response.json({ ok: true, sessions_count: row?.n ?? null, env_keys: keys });
}
