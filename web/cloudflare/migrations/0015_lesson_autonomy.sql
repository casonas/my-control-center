-- ─────────────────────────────────────────────────────
-- Migration 0015: Lesson Autonomy + Memory + Budget
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0015_lesson_autonomy.sql
-- ─────────────────────────────────────────────────────
-- ADDITIVE ONLY — no DROP, no ALTER COLUMN, no data deletion

-- ──── 1. Lesson autonomy columns ─────────────────────

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

-- ──── 2. Radar item scoring columns ─────────────────

ALTER TABLE skill_radar_items ADD COLUMN category TEXT;
ALTER TABLE skill_radar_items ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_skill_radar_unprocessed
  ON skill_radar_items(user_id, processed, fetched_at DESC);

-- ──── 3. Budget tracking ─────────────────────────────

CREATE TABLE IF NOT EXISTS budget_usage (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  feature     TEXT NOT NULL CHECK(feature IN ('lessons','radar','chat','summarize')),
  model       TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  job_id      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_usage_daily
  ON budget_usage(user_id, feature, created_at);

-- ──── 4. Memory notes (structured long-term memory) ──

CREATE TABLE IF NOT EXISTS memory_notes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  category    TEXT NOT NULL CHECK(category IN ('skill_mastery','weak_area','preference','session_summary','general')),
  subject     TEXT,
  content     TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'auto'
    CHECK(source_type IN ('auto','manual')),
  source_id   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_notes_user
  ON memory_notes(user_id, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_notes_subject
  ON memory_notes(user_id, subject);

-- ──── 5. Idempotency keys (dedup for endpoints + worker) ─

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','completed','failed')),
  result_json     TEXT,
  completed_at    TEXT,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_keys(expires_at);
