-- ─────────────────────────────────────────────────────
-- D1 Schema: My Control Center
-- ─────────────────────────────────────────────────────
-- This replaces localStorage with a cross-device SQLite DB
-- hosted on Cloudflare D1 (free tier: 5M reads/day, 100k writes/day, 5GB)
--
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql
-- ─────────────────────────────────────────────────────

-- Unified document store (vector-ready)
-- Every item is a "document" with searchable text + tags.
-- When Workers AI embeddings are enabled, add a `vector BLOB` column
-- and use Vectorize for cosine-similarity search.
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  collection   TEXT NOT NULL,          -- 'notes','assignments','skills','jobs','research'
  search_text  TEXT NOT NULL DEFAULT '',-- concatenated text for FTS / vector search
  tags         TEXT NOT NULL DEFAULT '[]', -- JSON array of tag strings
  meta         TEXT NOT NULL DEFAULT '{}', -- JSON blob of domain-specific data
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Full-text search index (free, fast, built into SQLite/D1)
-- This gives us instant keyword search across ALL collections
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  id,
  collection,
  search_text,
  content='documents',
  content_rowid='rowid'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(id, collection, search_text) VALUES (new.id, new.collection, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
  INSERT INTO documents_fts(id, collection, search_text) VALUES (new.id, new.collection, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
END;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);

-- ─── Notes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  tab        TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Assignments ──────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  course    TEXT NOT NULL DEFAULT '',
  due_date  TEXT,
  priority  TEXT NOT NULL DEFAULT 'medium',
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Skills & Lessons ─────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL DEFAULT '',
  progress  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lessons (
  id          TEXT PRIMARY KEY,
  skill_id    TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  completed   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ─── Jobs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  company   TEXT NOT NULL DEFAULT '',
  location  TEXT NOT NULL DEFAULT '',
  url       TEXT NOT NULL DEFAULT '',
  tags      TEXT NOT NULL DEFAULT '[]',
  applied   INTEGER NOT NULL DEFAULT 0,
  saved_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Watchlist ────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
  id     TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name   TEXT NOT NULL DEFAULT '',
  type   TEXT NOT NULL DEFAULT 'stock'  -- 'stock' or 'team'
);

-- ─── Research Articles ────────────────────────────
CREATE TABLE IF NOT EXISTS research (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT '',
  url       TEXT NOT NULL DEFAULT '',
  category  TEXT NOT NULL DEFAULT 'tech', -- 'world','tech','cyber','deep'
  notes     TEXT NOT NULL DEFAULT '',
  read      INTEGER NOT NULL DEFAULT 0,
  saved_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Cached API Responses ─────────────────────────
-- Used by cron workers to store fetched data
CREATE TABLE IF NOT EXISTS api_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
