import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

type EnvLike = Record<string, unknown>;

type D1Like = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => {
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

function clearCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookieNonHttpOnly(name: string) {
  return `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const e = env as EnvLike;

  const DB = e["DB"] as unknown as D1Like | undefined;
  if (!DB) return Response.json({ ok: false, error: "DB binding missing" }, { status: 500 });

  const sessionId = getCookie(req, "mcc_session");

  if (sessionId) {
    await DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie("mcc_session"));
  // If you use a separate CSRF cookie like your screenshot shows:
  headers.append("Set-Cookie", clearCookieNonHttpOnly("mcc_csrf"));

  return new Response(JSON.stringify({ ok: true, loggedOut: true }), { status: 200, headers });
}
