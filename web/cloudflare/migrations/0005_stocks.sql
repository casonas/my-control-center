-- ─────────────────────────────────────────────────────
-- Migration 0005: Stocks — Watchlist, Quotes, News, Insights, Alerts
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0005_stocks.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_watchlist (
  user_id      TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  display_name TEXT,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, ticker)
);

CREATE TABLE IF NOT EXISTS stock_quotes (
  user_id    TEXT NOT NULL,
  ticker     TEXT NOT NULL,
  price      REAL NOT NULL,
  change     REAL,
  change_pct REAL,
  currency   TEXT,
  asof       TEXT NOT NULL,
  source     TEXT NOT NULL,
  PRIMARY KEY (user_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_stock_quotes_asof ON stock_quotes(user_id, asof DESC);

CREATE TABLE IF NOT EXISTS market_indices (
  user_id    TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  value      REAL NOT NULL,
  change_pct REAL,
  asof       TEXT NOT NULL,
  source     TEXT NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS stock_news_items (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  ticker       TEXT,
  title        TEXT NOT NULL,
  source       TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at TEXT,
  fetched_at   TEXT NOT NULL,
  summary      TEXT,
  sentiment    TEXT,
  impact_score INTEGER NOT NULL DEFAULT 0,
  dedupe_key   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_news_dedupe ON stock_news_items(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_stock_news_fetched ON stock_news_items(user_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_news_ticker ON stock_news_items(user_id, ticker, fetched_at DESC);

CREATE TABLE IF NOT EXISTS stock_insights (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  ticker       TEXT,
  title        TEXT NOT NULL,
  bullets_json TEXT NOT NULL,
  sentiment    TEXT,
  confidence   INTEGER,
  url          TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_insights_user ON stock_insights(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_insights_ticker ON stock_insights(user_id, ticker, created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ticker     TEXT,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  url        TEXT,
  created_at TEXT NOT NULL,
  seen_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_seen ON alerts(user_id, seen_at);
