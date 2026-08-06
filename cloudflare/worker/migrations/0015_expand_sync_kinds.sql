-- Expand the sync document set beyond qbank/flashcards and track uncompressed
-- size for the per-user 15MB storage budget.
--
-- SQLite can't drop a CHECK constraint in place, so rebuild the table:
--  * remove CHECK (kind IN ('qbank','flashcards')) so sessions/notes/
--    highlights/articleHighlights/bookmarks docs can be stored
--  * add raw_bytes (uncompressed JSON length) for budget enforcement
--    (approx for legacy rows — exact value is written on next sync)
PRAGMA foreign_keys = OFF;

ALTER TABLE progress_documents RENAME TO progress_documents_legacy;

CREATE TABLE progress_documents (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 0,
  raw_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

INSERT INTO progress_documents (user_id, kind, payload, compressed, raw_bytes, updated_at)
  SELECT user_id, kind, payload, compressed,
    CASE WHEN compressed = 1 THEN length(payload) * 5 ELSE length(payload) END,
    updated_at
  FROM progress_documents_legacy;

DROP TABLE progress_documents_legacy;

PRAGMA foreign_keys = ON;
