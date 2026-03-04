-- ─────────────────────────────────────────────────────
-- Migration 0021: School v2 — Academic Workspace
-- Additive columns + new tables for courses, calendar, resources, attachments
-- ─────────────────────────────────────────────────────
-- Run: wrangler d1 execute mcc-store --file=./cloudflare/migrations/0021_school_v2.sql
-- ─────────────────────────────────────────────────────

-- ── 1. Extend courses ──────────────────────────────
ALTER TABLE courses ADD COLUMN instructor TEXT;
ALTER TABLE courses ADD COLUMN lms_url TEXT;

-- Additional index
CREATE INDEX IF NOT EXISTS idx_courses_user_term ON courses(user_id, term);
CREATE INDEX IF NOT EXISTS idx_courses_user_name ON courses(user_id, name);

-- ── 2. Extend school_assignments ───────────────────
ALTER TABLE school_assignments ADD COLUMN notes_md TEXT;
ALTER TABLE school_assignments ADD COLUMN estimated_minutes INTEGER;

-- Additional index
CREATE INDEX IF NOT EXISTS idx_school_assignments_course_due
  ON school_assignments(user_id, course_id, due_at ASC);

-- ── 3. Extend school_notes ────────────────────────
ALTER TABLE school_notes ADD COLUMN tags_json TEXT;

-- ── 4. school_calendar_events ─────────────────────
CREATE TABLE IF NOT EXISTS school_calendar_events (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  course_id             TEXT REFERENCES courses(id) ON DELETE SET NULL,
  type                  TEXT NOT NULL DEFAULT 'class'
    CHECK(type IN ('class','exam','assignment','milestone','office_hours')),
  title                 TEXT NOT NULL,
  starts_at             TEXT NOT NULL,
  ends_at               TEXT,
  location              TEXT,
  source                TEXT NOT NULL DEFAULT 'manual'
    CHECK(source IN ('manual','imported')),
  linked_assignment_id  TEXT REFERENCES school_assignments(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_events_user_start
  ON school_calendar_events(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_cal_events_user_course_start
  ON school_calendar_events(user_id, course_id, starts_at);

-- ── 5. school_resources ───────────────────────────
CREATE TABLE IF NOT EXISTS school_resources (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  course_id   TEXT REFERENCES courses(id) ON DELETE SET NULL,
  category    TEXT NOT NULL DEFAULT 'other'
    CHECK(category IN ('lms','library','tutoring','writing','career','other')),
  name        TEXT NOT NULL,
  url         TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resources_user_cat
  ON school_resources(user_id, category);
CREATE INDEX IF NOT EXISTS idx_resources_user_course
  ON school_resources(user_id, course_id);

-- ── 6. school_attachments ─────────────────────────
CREATE TABLE IF NOT EXISTS school_attachments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  owner_type  TEXT NOT NULL
    CHECK(owner_type IN ('course','assignment','note','event')),
  owner_id    TEXT NOT NULL,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_owner
  ON school_attachments(user_id, owner_type, owner_id);
