-- ─────────────────────────────────────────────────────
-- Migration 0013: Daily Briefings + Reminders
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0013_daily_briefings.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_briefings (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT 'Daily Briefing',
  content_md  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_briefings_user_date
  ON daily_briefings(user_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_briefings_date
  ON daily_briefings(user_id, date DESC);

CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'general',
  title       TEXT NOT NULL,
  due_at      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','dismissed')),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_user_due
  ON reminders(user_id, due_at ASC);
CREATE INDEX IF NOT EXISTS idx_reminders_user_status
  ON reminders(user_id, status, due_at ASC);
