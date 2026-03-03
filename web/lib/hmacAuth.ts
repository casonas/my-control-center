// web/lib/hmacAuth.ts — HMAC-SHA256 auth for cron/internal endpoints
//
// Validates requests signed with CRON_SECRET using:
//   - HMAC-SHA256 signature in X-Cron-Signature header
//   - Timestamp in X-Cron-Timestamp header (replay protection: ±5 min)
//
// Usage:
//   import { withHmacAuth } from "@/lib/hmacAuth";
//   export async function POST(req: Request) {
//     return withHmacAuth(req, async () => { ... });
//   }

const MAX_AGE_MS = 5 * 60 * 1000; // 5-minute replay window

async function computeHmac(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class HmacAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function verifyHmac(req: Request): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new HmacAuthError("CRON_SECRET not configured", 500);
  }

  const signature = req.headers.get("X-Cron-Signature");
  const timestamp = req.headers.get("X-Cron-Timestamp");

  if (!signature || !timestamp) {
    throw new HmacAuthError("Missing X-Cron-Signature or X-Cron-Timestamp");
  }

  // Replay protection
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    throw new HmacAuthError("Invalid timestamp");
  }
  const age = Math.abs(Date.now() - ts);
  if (age > MAX_AGE_MS) {
    throw new HmacAuthError("Request expired (timestamp too old or too far in the future)");
  }

  // Verify HMAC
  const body = await req.clone().text();
  const payload = `${timestamp}.${body}`;
  const expected = await computeHmac(secret, payload);

  // Constant-time comparison
  if (expected.length !== signature.length) {
    throw new HmacAuthError("Invalid signature");
  }
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(signature);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  if (diff !== 0) {
    throw new HmacAuthError("Invalid signature");
  }
}

/**
 * Wrapper: verify HMAC auth, then run handler.
 * Also accepts X-Internal-Token as fallback for backward compatibility.
 */
export async function withHmacAuth(
  req: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    // Try HMAC first
    if (req.headers.get("X-Cron-Signature")) {
      await verifyHmac(req);
      return handler();
    }

    // Fallback: check X-Internal-Token (backward compat)
    const secret = process.env.INTERNAL_SHARED_SECRET || process.env.CRON_SECRET;
    const token = req.headers.get("X-Internal-Token");
    if (token && secret && token === secret) {
      return handler();
    }

    return Response.json(
      { ok: false, error: "Authentication required (HMAC or Internal-Token)" },
      { status: 401 }
    );
  } catch (e) {
    if (e instanceof HmacAuthError) {
      return Response.json({ ok: false, error: e.message }, { status: e.status });
    }
    return Response.json({ ok: false, error: "Internal auth error" }, { status: 500 });
  }
}

/**
 * Generate HMAC headers for signing a request (used by cron worker).
 */
export async function signRequest(
  secret: string,
  body: string
): Promise<{ "X-Cron-Signature": string; "X-Cron-Timestamp": string }> {
  const timestamp = String(Date.now());
  const payload = `${timestamp}.${body}`;
  const signature = await computeHmac(secret, payload);
  return {
    "X-Cron-Signature": signature,
    "X-Cron-Timestamp": timestamp,
  };
}
