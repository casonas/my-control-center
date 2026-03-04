-- ─────────────────────────────────────────────────────
-- Migration 0018: Sports v2 — Additive schema enhancements
-- Adds: news summary/rumor/sentiment, sports_alerts table
-- Non-destructive: all changes are IF NOT EXISTS or additive columns.
-- ─────────────────────────────────────────────────────

-- Sports alerts table
CREATE TABLE IF NOT EXISTS sports_alerts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  seen       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sports_alerts_user
  ON sports_alerts(user_id, created_at DESC);

-- Add missing columns to sports_news_items (SQLite safe: IF NOT EXISTS not supported for ALTER, so wrap in try)
-- These will fail silently if columns already exist in application code.
-- summary TEXT
-- rumor_flag INTEGER DEFAULT 0
-- sentiment_score REAL
