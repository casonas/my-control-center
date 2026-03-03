// web/lib/logger.ts — Tiny structured logger wrapper
//
// Rules:
// - Include requestId (generated if missing)
// - Never log cookies, auth secrets, or tokens
// - Log at key points: scan/refresh start/end, cron job status, streaming

let _reqIdCounter = 0;

function genReqId(): string {
  return `r${Date.now().toString(36)}-${(++_reqIdCounter).toString(36)}`;
}

function safe(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    // Strip sensitive keys
    const lk = k.toLowerCase();
    if (lk.includes("secret") || lk.includes("token") || lk.includes("cookie") || lk.includes("password") || lk.includes("csrf")) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function logInfo(where: string, details: Record<string, unknown> = {}) {
  const reqId = details.requestId ?? genReqId();
  console.log(`[INFO][${where}]`, JSON.stringify({ ...safe(details), requestId: reqId }));
}

export function logWarn(where: string, details: Record<string, unknown> = {}) {
  const reqId = details.requestId ?? genReqId();
  console.warn(`[WARN][${where}]`, JSON.stringify({ ...safe(details), requestId: reqId }));
}

export function logError(where: string, error: unknown, details: Record<string, unknown> = {}) {
  const reqId = details.requestId ?? genReqId();
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR][${where}]`, JSON.stringify({ ...safe(details), error: errMsg, requestId: reqId }));
}
