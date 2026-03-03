// web/lib/memory.ts — Compact memory read/write/summarize helpers
//
// Implements the memory architecture:
//   - Short-term: active context window (recent N messages from current session)
//   - Structured long-term: memory_notes (skill mastery, weak areas, preferences)
//   - Archived: session_summary notes from nightly summarization
//
// Generation retrieves compact summaries, never full transcripts.

import type { D1Database } from "./d1";

// ─── Types ───────────────────────────────────────────

export type MemoryCategory =
  | "skill_mastery"
  | "weak_area"
  | "preference"
  | "session_summary"
  | "general";

export interface MemoryNote {
  id: string;
  category: MemoryCategory;
  subject: string | null;
  content: string;
  sourceType: "auto" | "manual";
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Write ───────────────────────────────────────────

/**
 * Upsert a memory note. If a note with the same user+category+subject exists,
 * update its content. Otherwise insert a new note.
 */
export async function upsertMemoryNote(
  db: D1Database,
  userId: string,
  category: MemoryCategory,
  subject: string,
  content: string,
  sourceType: "auto" | "manual" = "auto",
  sourceId?: string
): Promise<string> {
  const now = new Date().toISOString();

  // Try to find existing note with same subject
  const existing = await db
    .prepare(
      `SELECT id FROM memory_notes
       WHERE user_id = ? AND category = ? AND subject = ?
       LIMIT 1`
    )
    .bind(userId, category, subject)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE memory_notes SET content = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(content, now, existing.id)
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO memory_notes (id, user_id, category, subject, content, source_type, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, userId, category, subject, content, sourceType, sourceId ?? null, now, now)
    .run();
  return id;
}

// ─── Read ────────────────────────────────────────────

/**
 * Get memory notes for a user, optionally filtered by category.
 * Returns compact results — content is truncated to maxContentLen.
 */
export async function getMemoryNotes(
  db: D1Database,
  userId: string,
  options: {
    category?: MemoryCategory;
    subject?: string;
    limit?: number;
    maxContentLen?: number;
  } = {}
): Promise<MemoryNote[]> {
  const { category, subject, limit = 20, maxContentLen = 500 } = options;

  let sql = `SELECT id, category, subject, content, source_type, source_id, created_at, updated_at
             FROM memory_notes WHERE user_id = ?`;
  const binds: unknown[] = [userId];

  if (category) {
    sql += ` AND category = ?`;
    binds.push(category);
  }
  if (subject) {
    sql += ` AND subject = ?`;
    binds.push(subject);
  }

  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  binds.push(limit);

  const result = await db.prepare(sql).bind(...binds)
    .all<{
      id: string; category: string; subject: string | null;
      content: string; source_type: string; source_id: string | null;
      created_at: string; updated_at: string;
    }>();

  return (result.results || []).map((r) => ({
    id: r.id,
    category: r.category as MemoryCategory,
    subject: r.subject,
    content: r.content.slice(0, maxContentLen),
    sourceType: r.source_type as "auto" | "manual",
    sourceId: r.source_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Build a compact context string for AI generation.
 * Retrieves structured memory (skill mastery, preferences) — never full transcripts.
 * Token-efficient: keeps output under maxTokens approximate characters.
 */
export async function buildCompactContext(
  db: D1Database,
  userId: string,
  options: {
    skillId?: string;
    maxChars?: number;
  } = {}
): Promise<string> {
  const { skillId, maxChars = 2000 } = options;
  const parts: string[] = [];
  let remaining = maxChars;

  // 1. Skill mastery notes (most relevant for lesson generation)
  if (skillId) {
    const skill = await db
      .prepare(`SELECT name, level FROM skill_items WHERE id = ? AND user_id = ?`)
      .bind(skillId, userId)
      .first<{ name: string; level: string }>();

    if (skill) {
      const header = `Skill: ${skill.name} (${skill.level})`;
      parts.push(header);
      remaining -= header.length;

      // Get mastery notes for this skill
      const masteryNotes = await getMemoryNotes(db, userId, {
        category: "skill_mastery",
        subject: skill.name,
        limit: 3,
        maxContentLen: Math.min(300, remaining),
      });
      for (const note of masteryNotes) {
        if (remaining <= 0) break;
        const line = `Mastery: ${note.content}`;
        parts.push(line);
        remaining -= line.length;
      }

      // Get weak area notes
      const weakNotes = await getMemoryNotes(db, userId, {
        category: "weak_area",
        subject: skill.name,
        limit: 2,
        maxContentLen: Math.min(200, remaining),
      });
      for (const note of weakNotes) {
        if (remaining <= 0) break;
        const line = `Weak area: ${note.content}`;
        parts.push(line);
        remaining -= line.length;
      }
    }
  }

  // 2. User preferences (always include if space permits)
  if (remaining > 100) {
    const prefs = await getMemoryNotes(db, userId, {
      category: "preference",
      limit: 3,
      maxContentLen: Math.min(150, remaining),
    });
    for (const note of prefs) {
      if (remaining <= 0) break;
      const line = `Preference: ${note.content}`;
      parts.push(line);
      remaining -= line.length;
    }
  }

  return parts.join("\n");
}

// ─── Summarize ───────────────────────────────────────

/**
 * Create a compact summary of a chat session (no LLM — extractive).
 * Extracts key user queries and first sentences of agent responses.
 */
export async function summarizeSession(
  db: D1Database,
  userId: string,
  sessionId: string
): Promise<string | null> {
  const session = await db
    .prepare(`SELECT title, agent_id FROM chat_sessions WHERE id = ? AND user_id = ?`)
    .bind(sessionId, userId)
    .first<{ title: string; agent_id: string }>();

  if (!session) return null;

  const msgs = await db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE session_id = ? ORDER BY created_at ASC LIMIT 30`
    )
    .bind(sessionId)
    .all<{ role: string; content: string }>();

  if (!msgs.results || msgs.results.length === 0) return null;

  const userTopics = msgs.results
    .filter((m) => m.role === "user")
    .map((m) => m.content.slice(0, 80))
    .slice(0, 5);

  const agentHighlights = msgs.results
    .filter((m) => m.role === "agent")
    .map((m) => {
      // First sentence or first 80 chars
      const dot = m.content.indexOf(".");
      return dot > 0 && dot < 100 ? m.content.slice(0, dot + 1) : m.content.slice(0, 80);
    })
    .slice(0, 3);

  const summary = [
    `Topic: ${session.title}`,
    `Agent: ${session.agent_id}`,
    `Messages: ${msgs.results.length}`,
    `User asked: ${userTopics.join(" | ")}`,
    `Key points: ${agentHighlights.join(" | ")}`,
  ].join("\n");

  // Upsert as session_summary memory note
  await upsertMemoryNote(db, userId, "session_summary", session.title, summary, "auto", sessionId);

  return summary;
}

/**
 * Get short-term context: recent messages from the current session.
 * Used as the active context window for ongoing conversations.
 */
export async function getShortTermContext(
  db: D1Database,
  sessionId: string,
  maxMessages: number = 10
): Promise<{ role: string; content: string }[]> {
  const result = await db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE session_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(sessionId, maxMessages)
    .all<{ role: string; content: string }>();

  // Return in chronological order
  return (result.results || []).reverse();
}
