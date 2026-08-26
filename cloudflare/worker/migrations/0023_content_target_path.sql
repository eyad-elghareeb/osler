-- 0023_content_target_path.sql — remember author's desired publish location
-- so MCP packs and admin packs both land in a subfolder (not the category root).
-- Without this, hybridPublish defaulted to "<uuid>.json" at the root; the admin
-- UI worked around it with a client-side suggestedPath dialog, but MCP had no
-- way to request a folder and always landed at the root.

ALTER TABLE content_objects ADD COLUMN target_path TEXT;
CREATE INDEX IF NOT EXISTS content_objects_target_path ON content_objects(target_path);
