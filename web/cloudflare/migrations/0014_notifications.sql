-- ─────────────────────────────────────────────────────
-- Migration 0014: Notifications
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0014_notifications.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  category       TEXT NOT NULL
    CHECK (category IN ('system','school','jobs','research','stocks','sports','agents')),
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  message        TEXT NOT NULL,
  url            TEXT,
  internal_route TEXT,
  severity       TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','warning','critical')),
  created_at     TEXT NOT NULL,
  seen_at        TEXT,
  read_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_seen
  ON notifications(user_id, seen_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_cat
  ON notifications(user_id, category, created_at DESC);
