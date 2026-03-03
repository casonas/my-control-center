// web/lib/idempotency.ts — Shared idempotency logic for endpoints + worker
//
// Prevents duplicate processing of the same job/request.
// Uses idempotency_keys table in D1 with automatic expiry.
//
// Usage (endpoint):
//   const idem = await acquireIdempotencyKey(db, key, 300);
//   if (!idem.acquired) return Response.json(idem.existing);
//   try { ... await completeIdempotencyKey(db, key, result); }
//   catch { await releaseIdempotencyKey(db, key); throw; }
//
// Usage (worker):
//   if (await isIdempotent(db, key)) { skip; }
//   ... do work ...
//   await completeIdempotencyKey(db, key, result);

import type { D1Database } from "./d1";

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export interface IdempotencyResult {
  acquired: boolean;
  existing?: { status: string; result_json: string | null; completed_at: string | null };
}

/**
 * Try to acquire an idempotency lock for a key.
 * Returns { acquired: true } if the key is new or expired.
 * Returns { acquired: false, existing } if the key was already completed.
 */
export async function acquireIdempotencyKey(
  db: D1Database,
  key: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<IdempotencyResult> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Check for existing completed key
  const existing = await db
    .prepare(
      `SELECT status, result_json, completed_at, expires_at
       FROM idempotency_keys WHERE idempotency_key = ?`
    )
    .bind(key)
    .first<{ status: string; result_json: string | null; completed_at: string | null; expires_at: string }>();

  if (existing) {
    // If completed and not expired, return cached result
    if (existing.status === "completed" && new Date(existing.expires_at) > new Date(now)) {
      return { acquired: false, existing };
    }
    // If expired or failed, allow re-acquisition
    if (new Date(existing.expires_at) <= new Date(now) || existing.status === "failed") {
      await db
        .prepare(
          `UPDATE idempotency_keys SET status = 'processing', result_json = NULL, completed_at = NULL, expires_at = ?, created_at = ?
           WHERE idempotency_key = ?`
        )
        .bind(expiresAt, now, key)
        .run();
      return { acquired: true };
    }
    // Currently processing (not expired) — reject to prevent double-run
    if (existing.status === "processing") {
      return { acquired: false, existing };
    }
  }

  // Insert new key
  try {
    await db
      .prepare(
        `INSERT INTO idempotency_keys (idempotency_key, status, result_json, completed_at, expires_at, created_at)
         VALUES (?, 'processing', NULL, NULL, ?, ?)`
      )
      .bind(key, expiresAt, now)
      .run();
    return { acquired: true };
  } catch {
    // Race condition: another request inserted first
    return { acquired: false };
  }
}

/**
 * Mark an idempotency key as completed with its result.
 */
export async function completeIdempotencyKey(
  db: D1Database,
  key: string,
  result: unknown
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE idempotency_keys SET status = 'completed', result_json = ?, completed_at = ?
       WHERE idempotency_key = ?`
    )
    .bind(JSON.stringify(result), now, key)
    .run();
}

/**
 * Release an idempotency key on failure (allows retry).
 */
export async function releaseIdempotencyKey(
  db: D1Database,
  key: string
): Promise<void> {
  await db
    .prepare(`UPDATE idempotency_keys SET status = 'failed' WHERE idempotency_key = ?`)
    .bind(key)
    .run();
}

/**
 * Quick check: has this key already been completed (and not expired)?
 * Used by worker for skip-if-done logic.
 */
export async function isAlreadyCompleted(
  db: D1Database,
  key: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT 1 FROM idempotency_keys
       WHERE idempotency_key = ? AND status = 'completed' AND expires_at > ?`
    )
    .bind(key, now)
    .first();
  return !!row;
}

/**
 * Build a deterministic idempotency key from components.
 * Example: makeIdempotencyKey("lesson_plan_refresh", userId, "2025-01-15")
 */
export function makeIdempotencyKey(...parts: string[]): string {
  return parts.join(":");
}

/**
 * Clean up expired idempotency keys (call from nightly cron).
 */
export async function cleanExpiredKeys(db: D1Database): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`DELETE FROM idempotency_keys WHERE expires_at < ?`)
    .bind(now)
    .run();
  return (result.meta as Record<string, unknown>)?.changes as number ?? 0;
}
