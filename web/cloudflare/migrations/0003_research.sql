-- ─────────────────────────────────────────────────────
-- Migration 0003: Research Sources, Items, State + Cron Runs
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0003_research.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS research_sources (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_sources_user
  ON research_sources(user_id);

CREATE TABLE IF NOT EXISTS research_items (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  source_id    TEXT,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at TEXT,
  fetched_at   TEXT NOT NULL,
  summary      TEXT,
  tags_json    TEXT,
  score        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_research_items_user_fetched
  ON research_items(user_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_items_user_published
  ON research_items(user_id, published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_items_user_url
  ON research_items(user_id, url);

CREATE TABLE IF NOT EXISTS research_item_state (
  user_id  TEXT NOT NULL,
  item_id  TEXT NOT NULL,
  is_read  INTEGER NOT NULL DEFAULT 0,
  is_saved INTEGER NOT NULL DEFAULT 0,
  read_at  TEXT,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS cron_runs (
  job_name        TEXT PRIMARY KEY,
  last_run_at     TEXT,
  status          TEXT,
  items_processed INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);
