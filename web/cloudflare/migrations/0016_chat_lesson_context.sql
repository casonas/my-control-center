-- ─────────────────────────────────────────────────────
-- Migration 0016: Chat Session Lesson Context
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0016_chat_lesson_context.sql
-- ─────────────────────────────────────────────────────
-- ADDITIVE ONLY — no DROP, no ALTER COLUMN, no data deletion

-- Allow chat sessions to be tied to a specific context (e.g. a lesson)
ALTER TABLE chat_sessions ADD COLUMN context_type TEXT;
ALTER TABLE chat_sessions ADD COLUMN context_id TEXT;

-- Fast lookup: find the one session for (user, agent, context)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_context
  ON chat_sessions(user_id, agent_id, context_type, context_id);
