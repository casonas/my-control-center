// web/lib/auth.ts — Server-side session management
// MVP: in-memory store. Production: swap for D1 queries.

import { cookies } from "next/headers";
import crypto from "crypto";

const SESSION_COOKIE = "mcc_session";
const CSRF_COOKIE = "mcc_csrf";
const SESSION_MAX_AGE = 180 * 24 * 60 * 60; // 180 days in seconds

interface Session {
  userId: string;
  csrfToken: string;
  expiresAt: number;
}

// In-memory session store (replace with D1 in production)
const sessions = new Map<string, Session>();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getPassword(): string {
  return process.env.MCC_PASSWORD || "changeme";
}

export async function createSession(): Promise<{
  sessionId: string;
  csrfToken: string;
}> {
  const sessionId = generateToken();
  const csrfToken = generateToken();
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;

  sessions.set(sessionId, {
    userId: "owner",
    csrfToken,
    expiresAt,
  });

  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  cookieStore.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false, // JS needs to read this for headers
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return { sessionId, csrfToken };
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    sessions.delete(sessionId);
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(CSRF_COOKIE);
}

export function verifyPassword(password: string): boolean {
  const expected = getPassword();
  // Constant-time comparison to prevent timing attacks
  if (password.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(password),
    Buffer.from(expected)
  );
}
