-- ─────────────────────────────────────────────────────
-- Migration 0007: Skills — Roadmap, Lessons, Progress, Notes, Radar
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0007_skills.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skill_items (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT,
  level       TEXT NOT NULL DEFAULT 'beginner'
    CHECK(level IN ('beginner','intermediate','advanced')),
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_items_name ON skill_items(user_id, name);
CREATE INDEX IF NOT EXISTS idx_skill_items_user ON skill_items(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS roadmap_items (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  skill_id              TEXT NOT NULL REFERENCES skill_items(id) ON DELETE CASCADE,
  order_index           INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','in_progress','completed','paused')),
  target_date           TEXT,
  prereq_skill_ids_json TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_skill ON roadmap_items(user_id, skill_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_order ON roadmap_items(user_id, order_index);

CREATE TABLE IF NOT EXISTS skill_lessons (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  skill_id         TEXT NOT NULL REFERENCES skill_items(id) ON DELETE CASCADE,
  module_title     TEXT NOT NULL,
  lesson_title     TEXT NOT NULL,
  order_index      INTEGER NOT NULL,
  duration_minutes INTEGER,
  content_md       TEXT NOT NULL,
  resources_json   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_lessons_skill ON skill_lessons(user_id, skill_id, order_index);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id      TEXT NOT NULL,
  lesson_id    TEXT NOT NULL REFERENCES skill_lessons(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'not_started'
    CHECK(status IN ('not_started','in_progress','completed')),
  last_position TEXT,
  completed_at TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS skill_notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  skill_id   TEXT NOT NULL REFERENCES skill_items(id) ON DELETE CASCADE,
  lesson_id  TEXT,
  title      TEXT NOT NULL,
  content_md TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_notes ON skill_notes(user_id, skill_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS skill_radar_sources (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_radar_items (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  source_id       TEXT,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  published_at    TEXT,
  fetched_at      TEXT NOT NULL,
  summary         TEXT,
  tags_json       TEXT,
  relevance_score INTEGER NOT NULL DEFAULT 0,
  dedupe_key      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_radar_dedupe ON skill_radar_items(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_skill_radar_fetched ON skill_radar_items(user_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS skill_suggestions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  proposed_skill_name TEXT NOT NULL,
  reason_md           TEXT NOT NULL,
  evidence_json       TEXT,
  status              TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','saved','dismissed','added')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_suggestions ON skill_suggestions(user_id, status, updated_at DESC);
