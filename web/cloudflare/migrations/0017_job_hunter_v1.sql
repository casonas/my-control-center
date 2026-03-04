-- ─────────────────────────────────────────────────────
-- Migration 0017: Job Hunter v1 — additive schema changes
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0017_job_hunter_v1.sql
-- ─────────────────────────────────────────────────────

-- Add missing columns to job_items (additive only, no destructive changes)
ALTER TABLE job_items ADD COLUMN match_score INTEGER DEFAULT 0;
ALTER TABLE job_items ADD COLUMN why_match TEXT;
ALTER TABLE job_items ADD COLUMN salary_text TEXT;
ALTER TABLE job_items ADD COLUMN remote_flag TEXT DEFAULT 'unknown' CHECK(remote_flag IN ('0','1','unknown'));

-- Add missing column to job_sources
ALTER TABLE job_sources ADD COLUMN updated_at TEXT;

-- Index for match_score sorting
CREATE INDEX IF NOT EXISTS idx_job_items_user_score
  ON job_items(user_id, match_score DESC);

-- Companies-to-watch table (extends existing companies table concept)
CREATE TABLE IF NOT EXISTS companies_watch (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  company_name TEXT NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'big' CHECK(tier IN ('big','emerging')),
  source       TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_watch_user_name
  ON companies_watch(user_id, company_name);

-- Index for enabled sources lookup
CREATE INDEX IF NOT EXISTS idx_job_sources_user_enabled
  ON job_sources(user_id, enabled);
