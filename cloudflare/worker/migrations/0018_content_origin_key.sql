-- 0018_content_origin_key.sql — remember where a managed object was adopted
-- from.
--
-- adopt() was only idempotent for keys that matched published_r2_key or the
-- "<objectId>.<ext>" basename shape. An adopted draft (status=draft,
-- published_r2_key=NULL) matched neither, so re-opening or re-adopting the
-- same loose file created another content_object every time — the admin UI's
-- auto-adopt path turned each "open" into a fresh duplicate draft.
--
-- Persisting the source key makes adopt() exactly idempotent: one loose file
-- can only ever map to one managed object.

ALTER TABLE content_objects ADD COLUMN origin_r2_key TEXT;
CREATE INDEX IF NOT EXISTS content_objects_origin_key
  ON content_objects(origin_r2_key);
