-- ─────────────────────────────────────────────────────
-- Migration 0015: Lesson Autonomy — additive columns for
-- autonomous generation, quality metadata, and idempotency
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0015_lesson_autonomy.sql
-- ─────────────────────────────────────────────────────
-- ADDITIVE ONLY — no DROP, no ALTER COLUMN, no data deletion

-- Track how lessons were created (manual vs auto-generated)
ALTER TABLE skill_lessons ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
-- Dedupe key for idempotent upserts (e.g. "skill_id:module:lesson" hash)
ALTER TABLE skill_lessons ADD COLUMN dedupe_key TEXT;
-- Quality score 0–100 for generated lessons
ALTER TABLE skill_lessons ADD COLUMN quality_score INTEGER;
-- Generation metadata (model used, token count, generation params)
ALTER TABLE skill_lessons ADD COLUMN generation_meta_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_lessons_dedupe
  ON skill_lessons(user_id, skill_id, dedupe_key);

-- Track radar item scoring and categorization
ALTER TABLE skill_radar_items ADD COLUMN category TEXT;
ALTER TABLE skill_radar_items ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_skill_radar_unprocessed
  ON skill_radar_items(user_id, processed, fetched_at DESC);
