-- 0020_question_choice_respondents.sql — Per-contributor dedup for choice stats.
--
-- One row per (contributor, pack, question) — the choice itself is NOT stored
-- here, so this table can never reveal WHAT anyone picked; it only records
-- THAT a contributor answered a question, which is what makes the aggregate
-- counters in question_choice_stats count each contributor exactly once:
--
--   * signed-in users  → contributor id = HMAC-SHA256(user.id, JWT_SECRET),
--     computed server-side — the same account counts once across devices.
--   * guests           → contributor id = client-generated random UUID kept
--     in localStorage (no PII, not derivable to an account).
--
-- Rows are pruned after QBANK_STATS_RESPONDENT_RETENTION_MS (90 days) by the
-- hourly cron to bound table growth.

CREATE TABLE IF NOT EXISTS question_choice_respondents (
  aid        TEXT NOT NULL,
  uid        TEXT NOT NULL,
  qid        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (aid, uid, qid)
);

CREATE INDEX IF NOT EXISTS question_choice_respondents_created ON question_choice_respondents(created_at);
