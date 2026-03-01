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

-- ─── Extended Schema: Auth, Events, AI Engine ──────
-- These tables support the "Think Like Me" engine,
-- agent orchestration, and enhanced security.
-- ───────────────────────────────────────────────────

-- ─── Users ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  pw_hash    TEXT NOT NULL,           -- bcrypt/argon2 hash
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Sessions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,        -- secure random token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,           -- per-session CSRF token
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ─── User Events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,           -- 'click','complete','dismiss','search','view','chat'
  target_id  TEXT,                    -- doc/task/note id that was acted on
  target_type TEXT,                   -- 'assignment','note','job','skill','research'
  metadata   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON user_events(created_at);

-- ─── Next Actions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS next_actions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  reasoning    TEXT NOT NULL DEFAULT '',  -- why this was suggested
  source_type  TEXT NOT NULL DEFAULT '',  -- 'deadline','pattern','skill_gap','agent','rss'
  source_id    TEXT,                      -- optional link to source item
  confidence   REAL NOT NULL DEFAULT 0.5, -- 0.0-1.0 confidence score
  priority     INTEGER NOT NULL DEFAULT 3, -- 1=urgent 5=low
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending','accepted','dismissed','completed'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  acted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_user ON next_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON next_actions(status);

-- ─── Agent Runs ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,           -- 'home-agent','school-agent', etc.
  prompt       TEXT NOT NULL DEFAULT '',
  response     TEXT NOT NULL DEFAULT '',
  artifacts    TEXT NOT NULL DEFAULT '[]', -- JSON array of {type, url, title}
  tokens_used  INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'completed', -- 'running','completed','failed'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_runs_user ON agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id);

-- ─── Notifications ──────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  channel      TEXT NOT NULL DEFAULT 'in_app', -- 'in_app','push','email'
  priority     TEXT NOT NULL DEFAULT 'normal',  -- 'low','normal','high','urgent'
  read         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  read_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);

-- ─── Connectors ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS connectors (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,           -- 'rss','email_imap','calendar_ics','webhook','api'
  name         TEXT NOT NULL,
  config       TEXT NOT NULL DEFAULT '{}', -- encrypted JSON config
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  sync_errors  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_connectors_user ON connectors(user_id);

-- ─── Feedback ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL,           -- 'next_action','notification','agent_run'
  target_id    TEXT NOT NULL,
  action       TEXT NOT NULL,           -- 'helpful','not_helpful','dismiss','complete'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback(target_type, target_id);
