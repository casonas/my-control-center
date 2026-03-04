-- ─────────────────────────────────────────────────────
-- Migration 0020: Research Intelligence v2
-- Extends research_items + adds entities, briefings, trends
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0020_research_v2.sql
-- ─────────────────────────────────────────────────────

-- Extend research_sources with category, reliability_score, updated_at
ALTER TABLE research_sources ADD COLUMN category TEXT DEFAULT 'cyber';
ALTER TABLE research_sources ADD COLUMN reliability_score INTEGER DEFAULT 70;
ALTER TABLE research_sources ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_research_sources_user_enabled
  ON research_sources(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_research_sources_category
  ON research_sources(category);

-- Extend research_items with v2 columns
ALTER TABLE research_items ADD COLUMN urgency TEXT DEFAULT 'low';
ALTER TABLE research_items ADD COLUMN item_type TEXT DEFAULT 'news';
ALTER TABLE research_items ADD COLUMN sentiment_score REAL;
ALTER TABLE research_items ADD COLUMN dedupe_key TEXT;
ALTER TABLE research_items ADD COLUMN notes_md TEXT;

CREATE INDEX IF NOT EXISTS idx_research_items_user_score
  ON research_items(user_id, score DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_items_dedupe
  ON research_items(user_id, dedupe_key);

-- Extend research_item_state with archived column
ALTER TABLE research_item_state ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_research_item_state_read_saved
  ON research_item_state(user_id, is_read, is_saved);

-- research_entities (new)
CREATE TABLE IF NOT EXISTS research_entities (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'company',
  name        TEXT NOT NULL,
  aliases_json TEXT,
  watch       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_entities_user_type_name
  ON research_entities(user_id, type, name);
CREATE INDEX IF NOT EXISTS idx_research_entities_user_watch
  ON research_entities(user_id, watch);

-- research_item_entities (new)
CREATE TABLE IF NOT EXISTS research_item_entities (
  item_id     TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 1.0,
  UNIQUE(item_id, entity_id)
);

-- research_briefings (new)
CREATE TABLE IF NOT EXISTS research_briefings (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'daily',
  body_md     TEXT NOT NULL,
  model_used  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_briefings_user_created
  ON research_briefings(user_id, created_at DESC);

-- research_trends (new)
CREATE TABLE IF NOT EXISTS research_trends (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  topic           TEXT NOT NULL,
  window          TEXT NOT NULL DEFAULT '24h',
  mention_count   INTEGER NOT NULL DEFAULT 0,
  momentum_score  REAL NOT NULL DEFAULT 0,
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_trends_user_window_momentum
  ON research_trends(user_id, window, momentum_score DESC);
