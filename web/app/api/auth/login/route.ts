export const runtime = "edge";
// web/app/api/auth/login/route.ts
//
// Works on Cloudflare Pages edge workers AND a plain Node.js VPS.
// No D1 or getRequestContext() required — uses stateless signed cookies.
//

import {
  createSession,
  MFA_TRUST_MAX_AGE,
  rememberMfaDevice,
  verifyPassword,
} from "@/lib/auth";

// This is a single-owner personal dashboard — the user identity is fixed.
const OWNER_ID = "owner";
const OWNER_USERNAME = "admin";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    password?: string;
    remember_mfa_device?: boolean;
  } | null;
  const password = body?.password ?? "";
  const rememberMfaDeviceFor24h = body?.remember_mfa_device ?? true;

  if (!password || !(await verifyPassword(password))) {
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  const { csrfToken } = await createSession();
  if (rememberMfaDeviceFor24h) {
    await rememberMfaDevice(OWNER_ID);
  }

  return Response.json({
    ok: true,
    authenticated: true,
    user: { id: OWNER_ID, username: OWNER_USERNAME },
    csrfToken,
    mfaDeviceRemembered: rememberMfaDeviceFor24h,
    mfaDeviceRememberSeconds: rememberMfaDeviceFor24h ? MFA_TRUST_MAX_AGE : 0,
  });
}
