-- ─────────────────────────────────────────────────────
-- Migration 0019: Home Orchestrator v2 & Settings Control Tower v2
-- Adds: daily state, actions, agent handoffs, digests,
--        user profiles, model usage tracking, token budgets,
--        settings audit log, connector status
-- Non-destructive: all statements use IF NOT EXISTS.
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0019_home_settings_v2.sql
-- ─────────────────────────────────────────────────────

-- Daily KPI snapshot
CREATE TABLE IF NOT EXISTS home_daily_state (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  date_key           TEXT NOT NULL,
  due_count          INTEGER DEFAULT 0,
  unread_count       INTEGER DEFAULT 0,
  job_new_count      INTEGER DEFAULT 0,
  skill_progress_pct INTEGER DEFAULT 0,
  focus_minutes      INTEGER DEFAULT 0,
  top_alerts_json    TEXT,
  updated_at         TEXT NOT NULL,
  UNIQUE(user_id, date_key)
);

-- Next-best action items
CREATE TABLE IF NOT EXISTS home_actions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('jobs','research','school','stocks','sports','system','manual')),
  source_id   TEXT,
  priority    INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  urgency     TEXT NOT NULL DEFAULT 'low' CHECK(urgency IN ('low','med','high','critical')),
  status      TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','accepted','dismissed','done')),
  reasoning   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_home_actions_user_status
  ON home_actions(user_id, status, priority, created_at);

-- Agent-to-agent routing
CREATE TABLE IF NOT EXISTS home_agent_handoffs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  from_agent     TEXT NOT NULL,
  to_agent       TEXT NOT NULL,
  intent         TEXT,
  payload_json   TEXT,
  status         TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
  result_summary TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_home_agent_handoffs_user_status
  ON home_agent_handoffs(user_id, status, created_at);

-- Morning/evening digest storage
CREATE TABLE IF NOT EXISTS home_digest_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  digest_type TEXT NOT NULL CHECK(digest_type IN ('morning','evening','heartbeat','manual')),
  title       TEXT NOT NULL,
  body_md     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_home_digest_history_user
  ON home_digest_history(user_id, created_at DESC);

-- Mode/profile management
CREATE TABLE IF NOT EXISTS user_profiles (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  mode_key    TEXT NOT NULL CHECK(mode_key IN ('focus','research','market','jobs','study','low_cost','custom')),
  config_json TEXT,
  active      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_active
  ON user_profiles(user_id, active);

-- AI model usage tracking
CREATE TABLE IF NOT EXISTS model_usage_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  feature_scope     TEXT NOT NULL,
  input_tokens      INTEGER DEFAULT 0,
  output_tokens     INTEGER DEFAULT 0,
  estimated_cost_usd REAL,
  latency_ms        INTEGER,
  success           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_usage_events_user
  ON model_usage_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_usage_events_user_model
  ON model_usage_events(user_id, model, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_usage_events_user_scope
  ON model_usage_events(user_id, feature_scope, created_at DESC);

-- Per-scope budget caps
CREATE TABLE IF NOT EXISTS token_budgets (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  period           TEXT NOT NULL CHECK(period IN ('daily','weekly','monthly')),
  feature_scope    TEXT NOT NULL,
  max_input_tokens  INTEGER,
  max_output_tokens INTEGER,
  max_cost_usd     REAL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(user_id, period, feature_scope)
);

-- Audit trail for settings changes
CREATE TABLE IF NOT EXISTS settings_audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('mode_change','model_override','budget_update','cron_toggle','connector_update')),
  before_json TEXT,
  after_json  TEXT,
  actor       TEXT NOT NULL DEFAULT 'user',
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_log_user
  ON settings_audit_log(user_id, created_at DESC);

-- Infra/connector health
CREATE TABLE IF NOT EXISTS connector_status (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  connector_key   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('ok','warn','error','pending')),
  last_checked_at TEXT,
  details_json    TEXT,
  updated_at      TEXT NOT NULL,
  UNIQUE(user_id, connector_key)
);
