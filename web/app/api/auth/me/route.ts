import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

type EnvLike = Record<string, unknown>;

type D1Like = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      run: () => Promise<unknown>;
    };
  };
};

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("=") || "");
  }
  return null;
}

export async function GET(req: Request) {
  const { env } = getRequestContext();
  const e = env as EnvLike;

  const DB = e["DB"] as unknown as D1Like | undefined;
  if (!DB) {
    return Response.json({ ok: false, error: "DB binding missing" }, { status: 500 });
  }

  const sessionId = getCookie(req, "mcc_session");

  // Return 200 w/ authenticated false (so client wrappers don't treat it as error)
  if (!sessionId) {
    return Response.json({ ok: true, authenticated: false, authed: false }, { status: 200 });
  }

  const row = await DB.prepare(
    `
    SELECT
      s.id as session_id,
      s.user_id as user_id,
      s.csrf_token as csrf_token,
      u.username as username
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
      AND s.expires_at > datetime('now')
    LIMIT 1
    `
  )
    .bind(sessionId)
    .first<{ session_id: string; user_id: string; csrf_token: string; username: string }>();

  if (!row) {
    // Optional cleanup
    await DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();

    return Response.json({ ok: true, authenticated: false, authed: false }, { status: 200 });
  }

  return Response.json({
    ok: true,
    authenticated: true,
    authed: true, // <<< THIS fixes your UI gating
    user: { id: row.user_id, username: row.username },
    csrfToken: row.csrf_token,
  });
}
