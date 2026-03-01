import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

type EnvLike = Record<string, unknown>;

type D1Like = {
  prepare: (sql: string) => {
    first: <T = Record<string, unknown>>() => Promise<T | null>;
  };
};

export async function GET() {
  const { env } = getRequestContext();
  const e = env as EnvLike;

  // Show what bindings exist (safe for debug route; remove later)
  const keys = Object.keys(e);

  const DB = e["DB"] as unknown as D1Like | undefined;
  if (!DB) {
    return Response.json(
      {
        ok: false,
        error: "DB binding not found on env",
        env_keys: keys
      },
      { status: 500 }
    );
  }

  const row = await DB.prepare("SELECT COUNT(*) as n FROM sessions").first<{ n: number }>();

  return Response.json({
    ok: true,
    sessions_count: row?.n ?? null,
    env_keys: keys
  });
}
