-- 0007_audit_hmac.sql — Tamper-evident audit log with HMAC chain.
-- Adds prev_hash and row_hash columns to admin_audit so every row is
-- cryptographically linked to its predecessor, making undetected tampering
-- computationally infeasible.
--
-- AUDIT_HMAC_KEY must be set as a Worker secret (separate from JWT_SECRET).

PRAGMA foreign_keys = ON;

ALTER TABLE admin_audit ADD COLUMN prev_hash TEXT;
ALTER TABLE admin_audit ADD COLUMN row_hash TEXT NOT NULL DEFAULT '';

-- Index for chain-walk queries (GET /v1/admin/audit/verify walks newest→oldest).
CREATE INDEX IF NOT EXISTS admin_audit_chain ON admin_audit(created_at DESC) WHERE row_hash != '';
