-- Sports Odds History for Line Movement Tracking
CREATE TABLE IF NOT EXISTS sports_odds_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  book TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'spread',
  line REAL,
  price REAL,
  recorded_at TEXT NOT NULL,
  UNIQUE(user_id, game_id, book, market, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_odds_history_lookup
ON sports_odds_history(user_id, game_id, book, market, recorded_at);
