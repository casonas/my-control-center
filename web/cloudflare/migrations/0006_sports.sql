-- ─────────────────────────────────────────────────────
-- Migration 0006: Sports — Watchlist Teams, Games, Odds, Predictions
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0006_sports.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sports_watchlist_teams (
  user_id    TEXT NOT NULL,
  league     TEXT NOT NULL,
  team_id    TEXT NOT NULL,
  team_name  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, league, team_id)
);

CREATE TABLE IF NOT EXISTS sports_games (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  league          TEXT NOT NULL,
  start_time      TEXT NOT NULL,
  status          TEXT NOT NULL,
  home_team_id    TEXT NOT NULL,
  home_team_name  TEXT NOT NULL,
  away_team_id    TEXT NOT NULL,
  away_team_name  TEXT NOT NULL,
  home_score      INTEGER,
  away_score      INTEGER,
  period          TEXT,
  clock           TEXT,
  updated_at      TEXT NOT NULL,
  source          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sports_games_unique
  ON sports_games(user_id, league, home_team_id, away_team_id, start_time);
CREATE INDEX IF NOT EXISTS idx_sports_games_league
  ON sports_games(user_id, league, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sports_games_status
  ON sports_games(user_id, league, status, start_time DESC);

CREATE TABLE IF NOT EXISTS sports_odds_market (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  game_id         TEXT NOT NULL REFERENCES sports_games(id) ON DELETE CASCADE,
  book            TEXT NOT NULL,
  spread_home     REAL,
  spread_away     REAL,
  total           REAL,
  moneyline_home  INTEGER,
  moneyline_away  INTEGER,
  asof            TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sports_odds_unique
  ON sports_odds_market(user_id, game_id, book, asof);
CREATE INDEX IF NOT EXISTS idx_sports_odds_game
  ON sports_odds_market(user_id, game_id, asof DESC);

CREATE TABLE IF NOT EXISTS sports_model_predictions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  game_id               TEXT NOT NULL REFERENCES sports_games(id) ON DELETE CASCADE,
  model_name            TEXT NOT NULL,
  proj_spread_home      REAL,
  proj_total            REAL,
  win_prob_home         REAL,
  edge_spread           REAL,
  edge_total            REAL,
  recommended_bet_json  TEXT,
  explanation_md        TEXT,
  generated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sports_preds_unique
  ON sports_model_predictions(user_id, game_id, model_name, generated_at);
CREATE INDEX IF NOT EXISTS idx_sports_preds_game
  ON sports_model_predictions(user_id, game_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS sports_news_items (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  league       TEXT NOT NULL,
  team_id      TEXT,
  title        TEXT NOT NULL,
  source       TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at TEXT,
  fetched_at   TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sports_news_dedupe
  ON sports_news_items(user_id, dedupe_key);
