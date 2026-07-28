-- 0008_content_scheduling.sql — Scheduled publish/unpublish for content objects.
-- Allows admins to set a future date for automatic publish or unpublish.
-- The hourly cron handler checks these columns and transitions status accordingly.

PRAGMA foreign_keys = ON;

ALTER TABLE content_objects ADD COLUMN scheduled_publish_at INTEGER;
ALTER TABLE content_objects ADD COLUMN scheduled_unpublish_at INTEGER;

CREATE INDEX IF NOT EXISTS content_objects_scheduled_publish
  ON content_objects(scheduled_publish_at) WHERE scheduled_publish_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_objects_scheduled_unpublish
  ON content_objects(scheduled_unpublish_at) WHERE scheduled_unpublish_at IS NOT NULL;
