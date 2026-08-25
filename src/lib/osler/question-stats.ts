/**
 * QBank per-question choice stats — client side.
 *
 * Pairs with the worker's /v1/qbank/stats endpoints (pre-aggregated anonymous
 * counters). Contract:
 *
 *   1. Report FIRST attempts only. The caller checks the question's local
 *      QuestionRecord before queueing, so re-attempts never inflate the
 *      peer percentages.
 *   2. Send once per finished session. Choices accumulate in an in-memory
 *      buffer and flush as one small POST per pack on session end (plus a
 *      pagehide/visibility safety net so a hard close mid-review doesn't
 *      lose the buffer).
 *   3. Best-effort. Cloud disabled, offline, or rate-limited ⇒ silently
 *      dropped. This must never throw into the quiz flow.
 *   4. Reads are cached for 5 minutes — stats are eventually-consistent
 *      aggregates, so flipping between review screens costs zero requests.
 */

import {
  fetchQuestionStats,
  reportQuestionStats,
  type QuestionChoiceStats,
} from "@/lib/osler/cloud";

export type { QuestionChoiceStats };
/** Pack uid → question id → aggregate. */
export type PackStats = Record<string, QuestionChoiceStats>;

const STATS_CACHE_TTL_MS = 5 * 60 * 1000;
/** Hard cap so a runaway loop can't grow the buffer unbounded. */
const BUFFER_LIMIT_PER_PACK = 500;

/** uid → qid → [chosenIndex, optionsCount] */
const pending = new Map<string, Map<string, [number, number]>>();
const cache = new Map<string, { at: number; stats: PackStats }>();
let flushing = false;
let listenersBound = false;

function bindLifecycleFlush(): void {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;
  const flush = () => void flushQuestionStats();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Queue one first-attempt choice for the end-of-session report. */
export function queueChoiceStat(uid: string, qid: string, choice: number, optionsCount: number): void {
  if (!uid || !qid || !Number.isInteger(choice) || choice < 0 || optionsCount <= 0) return;
  bindLifecycleFlush();
  let answers = pending.get(uid);
  if (!answers) pending.set(uid, (answers = new Map()));
  if (answers.size >= BUFFER_LIMIT_PER_PACK && !answers.has(qid)) return;
  answers.set(qid, [choice, Math.min(optionsCount, 12)]);
}

/** POST every buffered choice as one report per pack. Concurrent calls collapse. */
export async function flushQuestionStats(): Promise<void> {
  if (flushing || pending.size === 0) return;
  flushing = true;
  const snapshot = [...pending];
  pending.clear();
  try {
    await Promise.all(
      snapshot.map(async ([uid, answers]) => {
        if (answers.size === 0) return;
        try {
          await reportQuestionStats(uid, [...answers.entries()].map(([qid, v]) => [qid, v[0], v[1]]));
        } catch {
          // Dropped — best-effort by contract.
        }
      }),
    );
  } finally {
    flushing = false;
  }
}

/** Cached aggregate fetch. Returns null when cloud is unavailable or the
 *  request fails — callers treat that as "no peer data". */
export async function getPackStats(uid: string): Promise<PackStats | null> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < STATS_CACHE_TTL_MS) return hit.stats;
  try {
    const stats = await fetchQuestionStats(uid);
    cache.set(uid, { at: Date.now(), stats });
    return stats;
  } catch {
    return null;
  }
}
