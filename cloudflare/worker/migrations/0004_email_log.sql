-- 0004_email_log.sql - delivery log for the admin Email page.
--
-- One row per sendEmail attempt (transactional mail: password resets,
-- address verification, admin test sends). Gives administrators
-- accountability for what the instance SENT and how the provider RESPONDED,
-- without storing message bodies: reset links are bearer-equivalent
-- secrets, so bodies/links are deliberately never persisted.
--
-- Pruned after 90 days by the hourly cron. Created by `npm run db:migrate`;
-- also safe on databases that applied earlier migrations (CREATE IF NOT
-- EXISTS, forward-only).

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_log_created ON email_log(created_at DESC);
