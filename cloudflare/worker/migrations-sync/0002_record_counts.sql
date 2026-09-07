-- 0002_record_counts.sql - per-kind record counts for the sync head.
--
-- Mirrors migrations/0006_sync_record_counts.sql (this file applies to every
-- sync shard database; that one applies to the core database). The sync PUT
-- handler maintains the count on every write; rows written before this
-- migration carry 0 and are lazily backfilled by getSyncHead (parse once,
-- cache the count in the row).

ALTER TABLE progress_documents ADD COLUMN record_count INTEGER NOT NULL DEFAULT 0;
