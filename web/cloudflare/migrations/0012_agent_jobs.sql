-- ─────────────────────────────────────────────────────
-- Migration 0012: Agent Jobs Queue + Logs
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0012_agent_jobs.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_jobs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','running','succeeded','failed','canceled')),
  priority      INTEGER NOT NULL DEFAULT 50,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  claimed_at    TEXT,
  claimed_by    TEXT,
  heartbeat_at  TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_status_prio
  ON agent_jobs(status, priority, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_user
  ON agent_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_agent_status
  ON agent_jobs(agent_id, status, created_at ASC);

CREATE TABLE IF NOT EXISTS agent_job_logs (
  id      TEXT PRIMARY KEY,
  job_id  TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  ts      TEXT NOT NULL,
  level   TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_job_logs_job
  ON agent_job_logs(job_id, ts ASC);
