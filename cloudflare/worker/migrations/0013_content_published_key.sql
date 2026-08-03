-- 0013_content_published_key.sql — track the student-facing R2 key each
-- content_object last published to.
--
-- The admin UI and adopt() previously matched a managed object to its
-- published file only by basename ("<objectId>.json"). When an object was
-- published to a custom targetPath (e.g. "qbank/cardiology/questions.json")
-- that match failed: the file showed as "loose" while the object appeared as
-- an orphan under "drafts (managed only)", and adopt() could create a second
-- content_object for the same student-facing file.
--
-- Persisting the published key makes the object↔file mapping exact and
-- idempotent regardless of targetPath.

ALTER TABLE content_objects ADD COLUMN published_r2_key TEXT;
CREATE INDEX IF NOT EXISTS content_objects_published_key
  ON content_objects(published_r2_key);
