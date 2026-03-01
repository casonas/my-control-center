// web/app/api/auth/logout/route.ts
import { withMutatingAuth } from "@/lib/mutatingAuth";

export const runtime = "edge";

function clearCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookieNonHttpOnly(name: string) {
  return `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ env, session }) => {
    // Session is guaranteed valid here (cookie + origin + X-CSRF matched)
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?1")
      .bind(session.id)
      .run();

    const headers = new Headers();
    headers.append("Set-Cookie", clearCookie("mcc_session"));

    // If you also set a non-HttpOnly CSRF cookie in your app, clear it too:
    headers.append("Set-Cookie", clearCookieNonHttpOnly("mcc_csrf"));

    return new Response(JSON.stringify({ ok: true, loggedOut: true }), {
      status: 200,
      headers,
    });
  });
}
