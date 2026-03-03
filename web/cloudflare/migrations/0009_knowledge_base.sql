-- Migration 0009: Knowledge Base notes + tags
-- Unified notes hub with tagging + source linking + export

CREATE TABLE IF NOT EXISTS kb_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'general',  -- 'general'|'school'|'skills'|'research'
  source_id TEXT NULL,
  course_id TEXT NULL,
  skill_id TEXT NULL,
  lesson_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_notes_user_updated ON kb_notes (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_notes_user_source ON kb_notes (user_id, source, updated_at DESC);

CREATE TABLE IF NOT EXISTS kb_tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS kb_note_tags (
  user_id TEXT NOT NULL,
  note_id TEXT NOT NULL REFERENCES kb_notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES kb_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, note_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_kb_note_tags_tag ON kb_note_tags (user_id, tag_id);

CREATE TABLE IF NOT EXISTS kb_exports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  format TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_value TEXT NULL,
  created_at TEXT NOT NULL
);
