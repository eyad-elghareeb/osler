-- 0003_user_sync_shard.sql - which sync shard owns a user's progress_documents.
--
-- progress_documents is partitioned USER-BY-USER across up to six sync shard
-- databases (each with its own free-tier 500 MB ceiling — ~2.5 GB usable for
-- sync in total). users.sync_shard (1-based) names the owner; it is read
-- straight off the user row, which every authenticated request already
-- loads, so the partition costs zero extra queries per request.
--
-- Nullable on purpose: rows written before this column existed read as NULL
-- and are treated as shard 1 until `npm run db:shard` backfills the mapping
-- and moves each user's rows into their shard. New users are assigned at
-- INSERT time by a deterministic hash of the id — syncShardForUserId in the
-- worker, mirrored in scripts/shard-d1.mjs; keep the two identical.

ALTER TABLE users ADD COLUMN sync_shard INTEGER;
