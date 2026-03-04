-- ─────────────────────────────────────────────────────
-- Migration 0022: Stocks Intelligence v2
-- Additive-only: new tables + new columns on existing tables
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0022_stocks_intelligence_v2.sql
-- ─────────────────────────────────────────────────────

-- ─── Extend stock_watchlist ─────────────────────────
ALTER TABLE stock_watchlist ADD COLUMN sector TEXT;
ALTER TABLE stock_watchlist ADD COLUMN market_cap_bucket TEXT DEFAULT 'large';
ALTER TABLE stock_watchlist ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE stock_watchlist ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_stock_wl_cap ON stock_watchlist(user_id, market_cap_bucket);

-- ─── Extend stock_quotes ────────────────────────────
ALTER TABLE stock_quotes ADD COLUMN volume REAL;
ALTER TABLE stock_quotes ADD COLUMN premarket_price REAL;
ALTER TABLE stock_quotes ADD COLUMN premarket_change_pct REAL;

-- ─── Extend stock_news_items ────────────────────────
ALTER TABLE stock_news_items ADD COLUMN sentiment_score REAL;
ALTER TABLE stock_news_items ADD COLUMN catalyst_type TEXT;

CREATE INDEX IF NOT EXISTS idx_stock_news_published ON stock_news_items(user_id, ticker, published_at DESC);

-- ─── Extend stock_insights ──────────────────────────
ALTER TABLE stock_insights ADD COLUMN scope TEXT DEFAULT 'market';
ALTER TABLE stock_insights ADD COLUMN insight_type TEXT DEFAULT 'briefing';
ALTER TABLE stock_insights ADD COLUMN body_md TEXT;

-- ─── NEW: market_regime_snapshots ───────────────────
CREATE TABLE IF NOT EXISTS market_regime_snapshots (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  asof           TEXT NOT NULL,
  spx_change     REAL,
  ndx_change     REAL,
  vix_level      REAL,
  breadth_score  REAL,
  risk_mode      TEXT NOT NULL DEFAULT 'neutral',
  notes_json     TEXT NOT NULL DEFAULT '{}',
  UNIQUE(user_id, asof)
);
CREATE INDEX IF NOT EXISTS idx_regime_asof ON market_regime_snapshots(user_id, asof DESC);

-- ─── NEW: stock_predictions ─────────────────────────
CREATE TABLE IF NOT EXISTS stock_predictions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  ticker              TEXT NOT NULL,
  horizon             TEXT NOT NULL DEFAULT '1d',
  prediction_type     TEXT NOT NULL DEFAULT 'direction',
  prediction_text     TEXT NOT NULL,
  target_price        REAL,
  target_change_pct   REAL,
  confidence          INTEGER NOT NULL DEFAULT 50,
  rationale_md        TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  due_at              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open',
  resolved_at         TEXT,
  actual_outcome_json TEXT,
  score_brier         REAL,
  score_hit           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON stock_predictions(user_id, ticker, status, due_at);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON stock_predictions(user_id, created_at DESC);

-- ─── NEW: stock_outliers ────────────────────────────
CREATE TABLE IF NOT EXISTS stock_outliers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  asof         TEXT NOT NULL,
  outlier_type TEXT NOT NULL,
  z_score      REAL NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_outliers_asof ON stock_outliers(user_id, asof DESC);
CREATE INDEX IF NOT EXISTS idx_outliers_ticker ON stock_outliers(user_id, ticker, asof DESC);

-- ─── NEW: stock_agent_metrics ───────────────────────
CREATE TABLE IF NOT EXISTS stock_agent_metrics (
  user_id             TEXT NOT NULL,
  window              TEXT NOT NULL DEFAULT '30d',
  total_predictions   INTEGER NOT NULL DEFAULT 0,
  resolved_predictions INTEGER NOT NULL DEFAULT 0,
  hit_rate            REAL,
  avg_brier           REAL,
  calibration_score   REAL,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (user_id, window)
);
