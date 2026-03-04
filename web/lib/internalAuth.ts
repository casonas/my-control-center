// web/lib/internalAuth.ts — Validates X-Internal-Token header for VPS/runner endpoints

export const INTERNAL_DEFAULT_USER_ID = "owner";

export function getInternalSecret(): string | null {
  return process.env.INTERNAL_SHARED_SECRET ?? process.env.CRON_SECRET ?? null;
}

export function getInternalUserId(req: Request): string {
  const headerUserId = req.headers.get("X-Internal-User-Id");
  if (headerUserId && headerUserId.trim()) return headerUserId.trim();
  return process.env.INTERNAL_DEFAULT_USER_ID || INTERNAL_DEFAULT_USER_ID;
}

export function isInternalRequest(req: Request): boolean {
  const secret = getInternalSecret();
  if (!secret) return false;
  const token = req.headers.get("X-Internal-Token");
  return !!token && token === secret;
}

export function requireInternalAuth(req: Request): void {
  const secret = 
    getInternalSecret();
  if (!secret) {
    throw new InternalAuthError("INTERNAL_SHARED_SECRET/CRON_SECRET not configured");
  }
  const token = req.headers.get("X-Internal-Token");
  if (!token || token !== secret) {
    throw new InternalAuthError("Invalid or missing X-Internal-Token");
  }
}

export class InternalAuthError extends Error {
  status = 401;
}

export function withInternalAuth(
  req: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    requireInternalAuth(req);
    return handler();
  } catch (e) {
    if (e instanceof InternalAuthError) {
      return Promise.resolve(
        Response.json({ ok: false, error: e.message, where: "internalAuth" }, { status: 401 })
      );
    }
    return Promise.resolve(
      Response.json({ ok: false, error: "Internal error" }, { status: 500 })
    );
  }
}
