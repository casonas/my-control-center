// web/app/api/auth/logout/route.ts
//
// Works on Cloudflare Pages edge workers AND a plain Node.js VPS.
// No D1 required — just clears the signed cookie.
//

import { destroySession } from "@/lib/auth";

export async function POST() {
  await destroySession();
  return Response.json({ ok: true, loggedOut: true });
}
