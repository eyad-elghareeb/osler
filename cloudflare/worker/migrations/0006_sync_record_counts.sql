-- 0006_sync_record_counts.sql - per-kind record counts for the sync head.
--
-- The account-conflict prompt compares the device's local record counts
-- against the cloud's; getSyncHead needs a cheap per-kind COUNT without
-- parsing (potentially megabyte) payloads on every head request. This column
-- is maintained by the sync PUT handler on every write; rows written before
-- this migration carry 0 and are lazily backfilled by getSyncHead (parse
-- once, cache the count in the row).

ALTER TABLE progress_documents ADD COLUMN record_count INTEGER NOT NULL DEFAULT 0;
