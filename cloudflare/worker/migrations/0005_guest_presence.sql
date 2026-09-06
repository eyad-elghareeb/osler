-- 0005_guest_presence.sql - display names of local-only guest sessions.
--
-- Guests never create an account (local-first by design), so the users table
-- can't count them. Clients report {aid, displayName} once per day through
-- POST /v1/guest/presence (pre-auth, rate-limited); the admin stats endpoint
-- counts rows here and the admin users endpoint lists them with their names
-- plus each guest's answered-question count (joined from
-- question_choice_respondents on aid).
--
-- One row per device (aid = the guest's stable qstats contributor UUID).
-- Never pruned automatically (like users) — last_seen_at shows staleness.
-- Created by `npm run db:migrate`; safe on databases that applied earlier
-- migrations (CREATE IF NOT EXISTS, forward-only).

CREATE TABLE IF NOT EXISTS guest_presence (
  aid TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS guest_presence_last_seen ON guest_presence(last_seen_at DESC);
