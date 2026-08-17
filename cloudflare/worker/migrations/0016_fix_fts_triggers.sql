-- 0016_fix_fts_triggers.sql — Fix broken FTS5 delete/update commands.
-- The 0011 triggers passed OLD.id (a TEXT uuid) to the FTS5 'delete'
-- command, which requires the integer rowid. As a result any DELETE or
-- title UPDATE on content_objects failed with SQLITE_ERROR, 500ing the
-- admin content-management endpoints.
-- Fix: map the FTS rowid to the parent row's implicit rowid, then rebuild
-- the index from content_objects so the rowids align.

DROP TRIGGER IF EXISTS content_fts_insert;
DROP TRIGGER IF EXISTS content_fts_delete;
DROP TRIGGER IF EXISTS content_fts_update;

DELETE FROM content_fts;
INSERT INTO content_fts (rowid, content_id, title, body)
  SELECT rowid, id, title, '' FROM content_objects;

CREATE TRIGGER content_fts_insert AFTER INSERT ON content_objects
BEGIN
  INSERT INTO content_fts (rowid, content_id, title, body)
  VALUES (NEW.rowid, NEW.id, NEW.title, '');
END;

CREATE TRIGGER content_fts_delete AFTER DELETE ON content_objects
BEGIN
  INSERT INTO content_fts (content_fts, rowid, content_id, title, body)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.title, '');
END;

CREATE TRIGGER content_fts_update AFTER UPDATE OF title ON content_objects
BEGIN
  INSERT INTO content_fts (content_fts, rowid, content_id, title, body)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.title, '');
  INSERT INTO content_fts (rowid, content_id, title, body)
  VALUES (NEW.rowid, NEW.id, NEW.title, '');
END;
