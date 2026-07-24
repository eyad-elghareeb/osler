-- 0004_security_indexes.sql — Performance & security indexes.
--
-- Adds indexes that the hardened admin/sync endpoints depend on for fast
-- lookups. None of these are strictly required for correctness, but they keep
-- the Worker within Cloudflare's free-tier query budgets on popular
-- instances. Safe to apply repeatedly (IF NOT EXISTS).

PRAGMA foreign_keys = ON;

-- Speed up per-user session enumeration used by the admin "active sessions"
-- view and the per-user session cap enforcement.
CREATE INDEX IF NOT EXISTS sessions_user_active_v2
  ON sessions(user_id, revoked_at, expires_at, created_at);

-- Speed up audit-log reads filtered by actor (used by GET /v1/admin/users/:id
-- when we want to know "what did this admin do").
CREATE INDEX IF NOT EXISTS admin_audit_actor_target
  ON admin_audit(actor_id, created_at DESC);

-- Speed up content_objects lookups by creator + status (used by the admin
-- user-detail endpoint to list a user's recent content).
CREATE INDEX IF NOT EXISTS content_objects_creator_status
  ON content_objects(created_by, status, updated_at DESC);
