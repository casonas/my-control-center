// web/lib/internalAuth.ts — Validates X-Internal-Token header for VPS/runner endpoints

export function requireInternalAuth(req: Request): void {
  const secret = 
    process.env.INTERNAL_SHARED_SECRET ??
    process.env.CRON_SECRET;
  if (!secret) {
    throw new InternalAuthError("INTERNAL_SHARED_SECRET not configured");
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
