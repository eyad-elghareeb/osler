-- 0019_question_choice_stats.sql — Aggregated per-question answer-choice counts.
--
-- Powers UWorld-style "% of users chose this answer" in QBank review mode.
-- Design contract:
--   * PRE-AGGREGATED counters only — one row per (pack uid, question id,
--     choice index). The client reports once per finished session and only
--     for FIRST attempts, so write volume stays tiny (D1 free tier allows
--     100K row writes/day shared across the whole database).
--   * NO identity: no user id, no session id, no timestamps beyond a coarse
--     updated_at used solely for the global daily-write-cap COUNT. Counts can
--     never be joined back to who chose what.
--   * options_count is stored so the client can detect aggregates that went
--     stale after an admin reordered/added/removed choices (and hide them
--     instead of showing misleading percentages).

CREATE TABLE IF NOT EXISTS question_choice_stats (
  uid           TEXT NOT NULL,
  qid           TEXT NOT NULL,
  choice        INTEGER NOT NULL,
  options_count INTEGER NOT NULL DEFAULT 0,
  count         INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (uid, qid, choice)
);

CREATE INDEX IF NOT EXISTS question_choice_stats_updated ON question_choice_stats(updated_at);
