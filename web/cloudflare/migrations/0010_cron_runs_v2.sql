-- ─────────────────────────────────────────────────────
-- Migration 0010: Standardize cron_runs with additional columns
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0010_cron_runs_v2.sql
-- ─────────────────────────────────────────────────────
-- cron_runs already exists from 0003. Add missing columns safely.

-- SQLite ALTER TABLE only supports ADD COLUMN; use IF NOT EXISTS via try/ignore pattern.
-- These will silently fail if columns already exist (expected on re-run).

ALTER TABLE cron_runs ADD COLUMN next_run_at TEXT;
ALTER TABLE cron_runs ADD COLUMN took_ms INTEGER;
ALTER TABLE cron_runs ADD COLUMN updated_at TEXT;
