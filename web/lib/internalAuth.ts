// web/lib/internalAuth.ts - shared internal auth for cron/VPS endpoints

export const INTERNAL_DEFAULT_USER_ID = "owner";

export function getInternalSecret(): string | null {
  return process.env.INTERNAL_SHARED_SECRET ?? process.env.CRON_SECRET ?? null;
}

export function getInternalUserId(req: Request): string {
  const headerUserId = req.headers.get("X-Internal-User-Id");
  if (headerUserId && headerUserId.trim()) return headerUserId.trim();
  return process.env.INTERNAL_DEFAULT_USER_ID || INTERNAL_DEFAULT_USER_ID;
}

export function hasInternalAuthHeaders(req: Request): boolean {
  return !!(req.headers.get("X-Internal-Token") || req.headers.get("X-Internal-User-Id"));
}

export function isInternalRequest(req: Request): boolean {
  const secret = getInternalSecret();
  if (!secret) return false;
  const token = req.headers.get("X-Internal-Token");
  return !!token && token === secret;
}

export function requireInternalAuth(req: Request): void {
  const secret = getInternalSecret();
  if (!secret) {
    throw new InternalAuthError("INTERNAL_SHARED_SECRET/CRON_SECRET not configured", 500);
  }
  const token = req.headers.get("X-Internal-Token");
  if (!token || token !== secret) {
    throw new InternalAuthError("Invalid or missing X-Internal-Token", 401);
  }
}

export class InternalAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
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
        Response.json({ ok: false, error: e.message, where: "internalAuth" }, { status: e.status })
      );
    }
    return Promise.resolve(
      Response.json({ ok: false, error: "Internal error" }, { status: 500 })
    );
  }
}
