// web/app/api/auth/login/route.ts
//
// Works on Cloudflare Pages edge workers AND a plain Node.js VPS.
// No D1 or getRequestContext() required — uses stateless signed cookies.
//

import { createSession, verifyPassword } from "@/lib/auth";

// This is a single-owner personal dashboard — the user identity is fixed.
const OWNER_ID = "owner";
const OWNER_USERNAME = "admin";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  const password = body?.password ?? "";

  if (!password || !(await verifyPassword(password))) {
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  const { csrfToken } = await createSession();

  return Response.json({
    ok: true,
    authenticated: true,
    user: { id: OWNER_ID, username: OWNER_USERNAME },
    csrfToken,
  });
}
