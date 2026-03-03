-- ─────────────────────────────────────────────────────
-- Migration 0011: Files & File Links (attachments system)
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0011_files.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  storage     TEXT NOT NULL DEFAULT 'r2',
  storage_key TEXT NOT NULL,
  sha256      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_user_created
  ON files(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS file_links (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_links_scope
  ON file_links(user_id, scope, scope_id, created_at DESC);
