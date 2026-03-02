// web/app/api/auth/me/route.ts
//
// Works on Cloudflare Pages edge workers AND a plain Node.js VPS.
// No D1 or getRequestContext() required — validates the stateless signed cookie.
//
export const runtime = "edge";

import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return Response.json({ ok: true, authenticated: false, authed: false });
  }

  return Response.json({
    ok: true,
    authenticated: true,
    authed: true,
    user: { id: session.userId, username: "admin" },
    csrfToken: session.csrfToken,
  });
}
