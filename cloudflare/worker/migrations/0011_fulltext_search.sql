-- 0011_fulltext_search.sql — Full-text search via D1 FTS5.
-- Enables admin search across content titles and bodies.

PRAGMA foreign_keys = ON;

-- Content FTS index
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  content_id UNINDEXED,
  title,
  body
);

-- Trigger: keep FTS in sync on content_objects insert/update
CREATE TRIGGER IF NOT EXISTS content_fts_insert AFTER INSERT ON content_objects
BEGIN
  INSERT INTO content_fts (content_id, title, body)
  VALUES (NEW.id, NEW.title, '');
END;

CREATE TRIGGER IF NOT EXISTS content_fts_delete AFTER DELETE ON content_objects
BEGIN
  INSERT INTO content_fts (content_fts, content_id, title, body)
  VALUES ('delete', OLD.id, OLD.title, '');
END;

CREATE TRIGGER IF NOT EXISTS content_fts_update AFTER UPDATE OF title ON content_objects
BEGIN
  INSERT INTO content_fts (content_fts, content_id, title, body)
  VALUES ('delete', OLD.id, OLD.title, '');
  INSERT INTO content_fts (content_id, title, body)
  VALUES (NEW.id, NEW.title, '');
END;
