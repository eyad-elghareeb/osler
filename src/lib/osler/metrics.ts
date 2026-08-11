/**
 * Osler analytics — derived question metrics powering Profile's Performance
 * Insights and the QBank Tracker stat tiles. Pure functions over
 * `QuestionRecord[]` (from `storage.allRecords()`), so every number here is
 * computed, never persisted — sync payloads stay bounded to the scalars that
 * already ride on each record.
 */

import type { QuestionRecord } from "@/lib/osler/storage";

export interface TopicStat {
  label: string;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

export interface DayStat {
  /** Local date string (YYYY-MM-DD). */
  date: string;
  /** Estimated active study seconds that day (pause-adjusted). */
  minutes: number;
}

export interface MetricsSummary {
  /** Distinct questions with a progress record. */
  totalAttempted: number;
  /** Records whose latest attempt is correct. */
  answeredCorrectly: number;
  /** Overall accuracy 0-100, includes repeats (latest attempt per question). */
  overallAccuracy: number | null;
  /** Records with a frozen first-attempt flag. */
  firstTryCount: number;
  /** First-try accuracy 0-100 — the truest measure of knowledge. */
  firstTryAccuracy: number | null;
  /** Mean latest-attempt duration in ms across timed records. */
  avgTimeMs: number | null;
  /** Estimated total active study time in ms (avgTime × attempts summed). */
  totalStudyMs: number;
  /** Records answered more than once. */
  repeatCount: number;
  /** First-try accuracy among repeated records (0-100). */
  repeatFirstAcc: number | null;
  /** Latest-try accuracy among repeated records (0-100). */
  repeatLastAcc: number | null;
  /** repeatLastAcc − repeatFirstAcc — how much review improves accuracy. */
  repeatGain: number | null;
  /** Per-topic aggregation, sorted worst-first (ascending accuracy). */
  topicStats: TopicStat[];
  /** Per-difficulty aggregation. */
  difficultyStats: TopicStat[];
  /** Last 14 days of estimated active study time. */
  byDay: DayStat[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TOPIC_ATTEMPTS = 3;

function localDateKey(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function toStat(
  buckets: Map<string, { attempts: number; correct: number }>
): TopicStat[] {
  return Array.from(buckets.entries())
    .map(([label, b]) => ({
      label,
      attempts: b.attempts,
      correct: b.correct,
      accuracy: b.attempts > 0 ? Math.round((b.correct / b.attempts) * 100) : null,
    }))
    .sort((a, b) => {
      // Worst accuracy first; ties go to higher volume (more evidence).
      const acc = (a.accuracy ?? 101) - (b.accuracy ?? 101);
      return acc !== 0 ? acc : b.attempts - a.attempts;
    });
}

/** Estimated active time a record contributed, pause-adjusted. */
function recordStudyMs(r: QuestionRecord): number {
  const per = r.avgTimeMs ?? r.timeMs ?? 0;
  return per * (r.attempts ?? 1);
}

export function summarizeMetrics(records: QuestionRecord[]): MetricsSummary {
  const totalAttempted = records.length;
  const answeredCorrectly = records.filter((r) => r.correct).length;
  const overallAccuracy =
    totalAttempted > 0 ? Math.round((answeredCorrectly / totalAttempted) * 100) : null;

  const firstTryRecords = records.filter((r) => r.firstAttemptCorrect != null);
  const firstTryCount = firstTryRecords.length;
  const firstTryAccuracy =
    firstTryCount > 0
      ? Math.round((firstTryRecords.filter((r) => r.firstAttemptCorrect).length / firstTryCount) * 100)
      : null;

  const timed = records.filter((r) => (r.timeMs ?? 0) > 0);
  const avgTimeMs =
    timed.length > 0
      ? Math.round(timed.reduce((sum, r) => sum + (r.timeMs ?? 0), 0) / timed.length)
      : null;
  const totalStudyMs = records.reduce((sum, r) => sum + recordStudyMs(r), 0);

  const repeated = records.filter((r) => (r.attempts ?? 0) > 1);
  const repeatCount = repeated.length;
  const repeatedFirst = repeated.filter((r) => r.firstAttemptCorrect != null);
  const repeatFirstAcc =
    repeatedFirst.length > 0
      ? Math.round((repeatedFirst.filter((r) => r.firstAttemptCorrect).length / repeatedFirst.length) * 100)
      : null;
  const repeatLastAcc =
    repeatCount > 0
      ? Math.round((repeated.filter((r) => r.correct).length / repeatCount) * 100)
      : null;
  const repeatGain =
    repeatFirstAcc != null && repeatLastAcc != null ? repeatLastAcc - repeatFirstAcc : null;

  const topicBuckets = new Map<string, { attempts: number; correct: number }>();
  const difficultyBuckets = new Map<string, { attempts: number; correct: number }>();
  const dayBuckets = new Map<string, number>();
  for (const r of records) {
    for (const tag of r.tags ?? []) {
      const b = topicBuckets.get(tag) ?? { attempts: 0, correct: 0 };
      b.attempts += r.attempts ?? 1;
      b.correct += r.correctCount ?? (r.correct ? 1 : 0);
      topicBuckets.set(tag, b);
    }
    if (r.difficulty) {
      const b = difficultyBuckets.get(r.difficulty) ?? { attempts: 0, correct: 0 };
      b.attempts += r.attempts ?? 1;
      b.correct += r.correctCount ?? (r.correct ? 1 : 0);
      difficultyBuckets.set(r.difficulty, b);
    }
    const key = localDateKey(r.timestamp);
    dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + recordStudyMs(r));
  }

  // Last 14 days, oldest → newest, zero-filled so the chart never jumps.
  const byDay: DayStat[] = [];
  const todayKey = localDateKey(Date.now());
  const today = new Date(`${todayKey}T00:00:00`);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = localDateKey(d.getTime());
    const ms = dayBuckets.get(key) ?? 0;
    byDay.push({ date: key, minutes: Math.round(ms / 60000) });
  }

  const topicStats = toStat(topicBuckets).filter((s) => s.accuracy != null);
  const difficultyStats = toStat(difficultyBuckets).filter((s) => s.accuracy != null);

  return {
    totalAttempted,
    answeredCorrectly,
    overallAccuracy,
    firstTryCount,
    firstTryAccuracy,
    avgTimeMs,
    totalStudyMs,
    repeatCount,
    repeatFirstAcc,
    repeatLastAcc,
    repeatGain,
    topicStats,
    difficultyStats,
    byDay,
  };
}

/**
 * Topics with enough attempts to be meaningful, worst-first. Used by Profile's
 * "weakest topics" list. `minAttempts` guards against a single fluke answer
 * ranking a topic as a weakness.
 */
export function weakestTopics(
  topicStats: TopicStat[],
  minAttempts = MIN_TOPIC_ATTEMPTS,
  limit = 5
): TopicStat[] {
  return topicStats.filter((s) => s.attempts >= minAttempts).slice(0, limit);
}
