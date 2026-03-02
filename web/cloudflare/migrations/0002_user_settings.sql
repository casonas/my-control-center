-- ─────────────────────────────────────────────────────
-- Migration 0002: User Settings + Reminders
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0002_user_settings.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_settings (
  user_id      TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  due_at     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, due_at);
