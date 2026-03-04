-- ─────────────────────────────────────────────────────
-- Migration 0025: Sports Props Board + Pick Cards
-- NBA props ingestion, board-hash caching, LLM pick generation
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sports_props_board (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  league TEXT NOT NULL,
  event_id TEXT,
  home_team TEXT,
  away_team TEXT,
  player TEXT NOT NULL,
  market TEXT NOT NULL,
  line REAL,
  odds INTEGER,
  book TEXT,
  edge_score REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT,
  fetched_at TEXT NOT NULL,
  board_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_props_user_league_time
ON sports_props_board(user_id, league, fetched_at DESC);

CREATE TABLE IF NOT EXISTS sports_pick_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  league TEXT NOT NULL,
  board_hash TEXT NOT NULL,
  model TEXT,
  card_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  rationale_md TEXT,
  cached INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pick_cards_lookup
ON sports_pick_cards(user_id, league, board_hash, card_type, created_at DESC);

CREATE TABLE IF NOT EXISTS sports_generation_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  league TEXT NOT NULL,
  board_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  token_estimate INTEGER,
  created_at TEXT NOT NULL
);
