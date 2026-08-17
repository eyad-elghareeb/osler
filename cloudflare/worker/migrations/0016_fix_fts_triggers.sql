-- 0016_fix_fts_triggers.sql — Fix broken FTS5 delete/update triggers.
-- The 0011 triggers used the FTS5 'delete' special command, which fails on
-- this D1 FTS5 build even with a valid integer rowid (SQLITE_ERROR), so any
-- DELETE or title UPDATE on content_objects 500'd the admin endpoints.
-- Fix: keep the FTS rowid aligned with content_objects.rowid and drive
-- deletes via plain `DELETE FROM content_fts WHERE rowid = OLD.rowid`,
-- then rebuild the index so the rowids align.

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
  DELETE FROM content_fts WHERE rowid = OLD.rowid;
END;

CREATE TRIGGER content_fts_update AFTER UPDATE OF title ON content_objects
BEGIN
  DELETE FROM content_fts WHERE rowid = OLD.rowid;
  INSERT INTO content_fts (rowid, content_id, title, body)
  VALUES (NEW.rowid, NEW.id, NEW.title, '');
END;
