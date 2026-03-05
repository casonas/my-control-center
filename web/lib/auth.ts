// web/lib/auth.ts — Edge-safe session management (stateless signed cookie)

import { cookies } from "next/headers";

const SESSION_COOKIE = "mcc_session";
const CSRF_COOKIE = "mcc_csrf";
const MFA_TRUST_COOKIE = "mcc_mfa_trust";
const SESSION_MAX_AGE = 180 * 24 * 60 * 60; // 180 days in seconds
const MFA_TRUST_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

interface SessionPayload {
  userId: string;
  csrfToken: string;
  expiresAt: number; // epoch ms
}

export interface Session {
  userId: string;
  csrfToken: string;
  expiresAt: number;
}

function getPassword(): string {
  // Cloudflare Pages env var
  return process.env.MCC_PASSWORD || "changeme";
}

function getSigningSecret(): string {
  // Add this to Cloudflare env vars (recommended). If missing, fallback to MCC_PASSWORD.
  // NOTE: Using MCC_PASSWORD as signing secret works, but a dedicated secret is better.
  return process.env.MCC_COOKIE_SIGNING_SECRET || getPassword();
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecodeToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonToB64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return base64urlEncode(new TextEncoder().encode(json));
}

function b64urlToJson<T>(b64url: string): T | null {
  try {
    const bytes = base64urlDecodeToBytes(b64url);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256B64url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64urlEncode(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  // Compare strings in constant-ish time (length check + XOR loop)
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function signSession(payload: SessionPayload): Promise<string> {
  // token = <payloadB64url>.<sigB64url>
  const payloadB64 = jsonToB64url(payload);
  const sig = await hmacSha256B64url(getSigningSecret(), payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expected = await hmacSha256B64url(getSigningSecret(), payloadB64);
  if (!constantTimeEqual(sig, expected)) return null;

  const payload = b64urlToJson<SessionPayload>(payloadB64);
  if (!payload) return null;

  if (typeof payload.expiresAt !== "number" || payload.expiresAt < Date.now()) return null;
  if (typeof payload.userId !== "string" || typeof payload.csrfToken !== "string") return null;

  return payload;
}

export async function createSession(): Promise<{ sessionId: string; csrfToken: string }> {
  // sessionId is now the signed token (kept for API compatibility with your routes)
  const csrfToken = randomHex(32);
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;

  const payload: SessionPayload = {
    userId: "owner",
    csrfToken,
    expiresAt,
  };

  const token = await signSession(payload);

  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  cookieStore.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false, // JS can read this and send header if you want
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return { sessionId: token, csrfToken };
}

interface MfaTrustPayload {
  userId: string;
  expiresAt: number;
  nonce: string;
}

async function signMfaTrust(payload: MfaTrustPayload): Promise<string> {
  const payloadB64 = jsonToB64url(payload);
  const sig = await hmacSha256B64url(getSigningSecret(), payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifyMfaTrustToken(token: string): Promise<MfaTrustPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expected = await hmacSha256B64url(getSigningSecret(), payloadB64);
  if (!constantTimeEqual(sig, expected)) return null;

  const payload = b64urlToJson<MfaTrustPayload>(payloadB64);
  if (!payload) return null;
  if (typeof payload.expiresAt !== "number" || payload.expiresAt < Date.now()) return null;
  if (typeof payload.userId !== "string" || typeof payload.nonce !== "string") return null;
  return payload;
}

export async function rememberMfaDevice(userId = "owner"): Promise<void> {
  const payload: MfaTrustPayload = {
    userId,
    expiresAt: Date.now() + MFA_TRUST_MAX_AGE * 1000,
    nonce: randomHex(16),
  };
  const token = await signMfaTrust(payload);
  const cookieStore = await cookies();
  cookieStore.set(MFA_TRUST_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MFA_TRUST_MAX_AGE,
    path: "/",
  });
}

export async function hasTrustedMfaDevice(userId = "owner"): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MFA_TRUST_COOKIE)?.value;
  if (!token) return false;
  const payload = await verifyMfaTrustToken(token);
  if (!payload) return false;
  return payload.userId === userId;
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  return {
    userId: payload.userId,
    csrfToken: payload.csrfToken,
    expiresAt: payload.expiresAt,
  };
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(CSRF_COOKIE);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const expected = getPassword();

  // Hash both, compare equal-length hex strings (constant-time loop)
  const [a, b] = await Promise.all([sha256Hex(password), sha256Hex(expected)]);
  return constantTimeEqual(a, b);
}
