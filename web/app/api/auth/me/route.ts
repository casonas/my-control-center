export const runtime = "edge";
// web/app/api/auth/me/route.ts
//
// Works on Cloudflare Pages edge workers AND a plain Node.js VPS.
// No D1 or getRequestContext() required — validates the stateless signed cookie.
//

import { getSession } from "@/lib/auth";

// Single-owner personal dashboard — identity is fixed in the signed token.
const OWNER_USERNAME = "admin";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return Response.json({ ok: true, authenticated: false, authed: false });
  }

  return Response.json({
    ok: true,
    authenticated: true,
    authed: true,
    user: { id: session.userId, username: OWNER_USERNAME },
    csrfToken: session.csrfToken,
  });
}
