import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

type EnvLike = Record<string, unknown>;

type D1Like = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      run: () => Promise<{ success?: boolean }>;
    };
  };
};

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function cookie(name: string, value: string, maxAgeSeconds: number) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join("; ");
}

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const e = env as EnvLike;

  const DB = e["DB"] as unknown as D1Like | undefined;
  if (!DB) {
    return Response.json({ ok: false, error: "DB binding missing" }, { status: 500 });
  }

  const passwordEnv = e["MCC_PASSWORD"];
  if (typeof passwordEnv !== "string" || !passwordEnv) {
    return Response.json({ ok: false, error: "MCC_PASSWORD missing" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  const password = body?.password ?? "";

  if (!password || password !== passwordEnv) {
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  // Fetch admin user
  const user = await DB.prepare(
    `SELECT id, username FROM users WHERE username = ? LIMIT 1`
  )
    .bind("admin")
    .first<{ id: string; username: string }>();

  if (!user) {
    return Response.json(
      { ok: false, error: "Admin user not found in D1 users table" },
      { status: 500 }
    );
  }

  const sessionId = randomToken(32);
  const csrfToken = randomToken(32);

  const sessionDays = 180;
  const maxAge = sessionDays * 24 * 60 * 60;

  await DB.prepare(
    `
    INSERT INTO sessions (id, user_id, csrf_token, expires_at)
    VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))
    `
  )
    .bind(sessionId, user.id, csrfToken, sessionDays)
    .run();

  const headers = new Headers();
  headers.append("Set-Cookie", cookie("mcc_session", sessionId, maxAge));

  return Response.json(
    {
      ok: true,
      authenticated: true,
      user: { id: user.id, username: user.username },
      csrfToken,
    },
    { status: 200, headers }
  );
}
