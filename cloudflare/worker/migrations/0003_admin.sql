-- 0003_admin.sql — Admin panel: content objects, audit log, content_admin role.

PRAGMA foreign_keys = ON;

-- Add content_admin role to users.
-- SQLite has no ALTER COLUMN; we recreate the check constraint via a trigger
-- that validates new inserts/updates instead of a CHECK — simpler approach is
-- to just allow the string value. The Worker enforces role semantics in code.
-- (Existing rows with role='student' or role='admin' are unaffected.)

-- R2-backed content object index.
CREATE TABLE IF NOT EXISTS content_objects (
  id            TEXT PRIMARY KEY,
  r2_key_base   TEXT NOT NULL UNIQUE,  -- e.g. "content/quiz/abc123" (no extension)
  content_type  TEXT NOT NULL,          -- quiz|bank|flashcard|written|osce|library|video
  title         TEXT,
  language      TEXT NOT NULL DEFAULT 'en',
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','pending','published','rejected')),
  created_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  reviewed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   INTEGER,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS content_objects_status ON content_objects(status);
CREATE INDEX IF NOT EXISTS content_objects_user   ON content_objects(created_by);

-- Admin audit trail.
CREATE TABLE IF NOT EXISTS admin_audit (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT,           -- JSON blob
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_actor  ON admin_audit(actor_id);
CREATE INDEX IF NOT EXISTS admin_audit_recent ON admin_audit(created_at DESC);
