-- ─────────────────────────────────────────────────────
-- Migration 0008: School — Courses, Assignments, Notes, Files, Calendar
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0008_school.sql
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courses (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT,
  term       TEXT,
  color      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_code ON courses(user_id, code, term);
CREATE INDEX IF NOT EXISTS idx_courses_user ON courses(user_id, updated_at DESC);

-- Enhanced assignments table (extends original schema)
CREATE TABLE IF NOT EXISTS school_assignments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  course_id   TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  due_at      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','in_progress','submitted','done','late','dropped')),
  priority    TEXT CHECK(priority IN ('low','medium','high') OR priority IS NULL),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_assignments_due ON school_assignments(user_id, due_at ASC);
CREATE INDEX IF NOT EXISTS idx_school_assignments_status ON school_assignments(user_id, status, due_at ASC);

CREATE TABLE IF NOT EXISTS assignment_notes (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES school_assignments(id) ON DELETE CASCADE,
  content_md    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignment_notes ON assignment_notes(user_id, assignment_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS school_notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  course_id  TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  content_md TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_notes ON school_notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_notes_course ON school_notes(user_id, course_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  scope       TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  storage     TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_scope ON files(user_id, scope, scope_id, created_at DESC);
