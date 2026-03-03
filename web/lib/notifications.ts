// web/lib/notifications.ts — Helper for creating notifications from scan/refresh endpoints
//
// Usage: call createNotification() from scan/refresh code when events of interest occur.

import type { D1Database } from "./d1";

export type NotificationCategory = "system" | "school" | "jobs" | "research" | "stocks" | "sports" | "agents";
export type NotificationSeverity = "info" | "warning" | "critical";

export interface CreateNotificationInput {
  userId: string;
  category: NotificationCategory;
  type: string;            // e.g. 'new_job', 'breaking_news', 'price_move'
  title: string;
  message: string;
  url?: string | null;
  internalRoute?: string | null;
  severity?: NotificationSeverity;
}

/**
 * Insert a notification into D1. Safe to call — fails silently if table missing.
 */
export async function createNotification(db: D1Database, input: CreateNotificationInput): Promise<void> {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO notifications (id, user_id, category, type, title, message, url, internal_route, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, input.userId, input.category, input.type,
      input.title, input.message,
      input.url ?? null, input.internalRoute ?? null,
      input.severity ?? "info", now
    ).run();
  } catch {
    // Table may not exist during partial rollout — fail silently
  }
}

/**
 * Create multiple notifications at once (batched).
 */
export async function createNotifications(db: D1Database, inputs: CreateNotificationInput[]): Promise<number> {
  let created = 0;
  for (const input of inputs) {
    try {
      await createNotification(db, input);
      created++;
    } catch { /* continue on failure */ }
  }
  return created;
}

// ─── Breaking keywords for research notifications ─────
const BREAKING_KEYWORDS = /0-day|zero.?day|cisa|breach|critical.?vuln|ransomware|supply.?chain.?attack/i;

/**
 * Check if a research item title triggers a breaking news notification.
 */
export function isBreakingResearch(title: string): { isBreaking: boolean; severity: NotificationSeverity } {
  if (BREAKING_KEYWORDS.test(title)) {
    return { isBreaking: true, severity: "warning" };
  }
  return { isBreaking: false, severity: "info" };
}

/**
 * Determine stock price move severity based on percentage.
 */
export function stockMoveSeverity(changePct: number): NotificationSeverity | null {
  const abs = Math.abs(changePct);
  if (abs >= 10) return "critical";
  if (abs >= 6) return "warning";
  if (abs >= 3) return "info";
  return null; // below threshold
}
