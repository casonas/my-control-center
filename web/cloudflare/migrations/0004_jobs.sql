-- ─────────────────────────────────────────────────────
-- Migration 0004: Jobs Pipeline, Companies, Outreach
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0004_jobs.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_sources (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK(type IN ('rss','custom')),
  url        TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_sources_user ON job_sources(user_id);

-- Drop old jobs table if it conflicts (old schema had different columns)
-- The original d1-schema.sql 'jobs' table is simpler; we recreate with pipeline fields.
-- Safe: CREATE IF NOT EXISTS won't conflict if columns match. We use a new table name
-- to avoid breaking the existing 'jobs' table used by localStorage.
CREATE TABLE IF NOT EXISTS job_items (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  source_id   TEXT,
  title       TEXT NOT NULL,
  company     TEXT NOT NULL,
  location    TEXT,
  remote      INTEGER NOT NULL DEFAULT 0,
  url         TEXT NOT NULL,
  posted_at   TEXT,
  fetched_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','saved','applied','interview','offer','rejected','dismissed')),
  notes       TEXT,
  tags_json   TEXT,
  dedupe_key  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_items_dedupe
  ON job_items(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_job_items_user_fetched
  ON job_items(user_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_items_user_status
  ON job_items(user_id, status, fetched_at DESC);

CREATE TABLE IF NOT EXISTS companies (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  website_url    TEXT,
  linkedin_url   TEXT,
  notes          TEXT,
  tags_json      TEXT,
  is_watchlisted INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_user_name
  ON companies(user_id, name);

CREATE TABLE IF NOT EXISTS outreach_templates (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body_md    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outreach_templates_user
  ON outreach_templates(user_id);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  job_id      TEXT,
  company_id  TEXT,
  template_id TEXT,
  subject     TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','sent','archived')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outreach_drafts_user
  ON outreach_drafts(user_id);
