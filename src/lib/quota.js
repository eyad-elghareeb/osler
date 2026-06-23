const DAY_MS = 86400000;

// Quota thresholds (percent). Tunable for Phase 5 admin settings.
export const QUOTA_THRESHOLDS = { STAGE_1: 85, STAGE_2: 90, STAGE_3: 95 };
// Eviction age cutoffs (days).
export const EVICT_OLDER_THAN_DAYS = { STUDY_EVENTS: 90, SYNC_LOG: 30 };
// Mature-card threshold: cards scheduled this many days OR MORE in the future
// are considered safe to drop during Stage 3 eviction.
export const MATURE_CARD_FUTURE_DAYS = 365;
export const MATURE_CARD_MIN_REPETITIONS = 5;

export async function getUsage() {
  if (!navigator?.storage?.estimate) return { usage: 0, quota: Infinity };
  try {
    return await navigator.storage.estimate();
  } catch {
    return { usage: 0, quota: Infinity };
  }
}

export async function getUsagePercent() {
  const { usage, quota } = await getUsage();
  if (!quota || quota === Infinity) return 0;
  return Math.round((usage / quota) * 100);
}

export async function evict() {
  const { evictFromStore } = await import('./storage.js');

  const pct = await getUsagePercent();

  const cutoff90 = new Date(Date.now() - EVICT_OLDER_THAN_DAYS.STUDY_EVENTS * DAY_MS).toISOString();
  const cutoff30 = new Date(Date.now() - EVICT_OLDER_THAN_DAYS.SYNC_LOG * DAY_MS).toISOString();
  // Stage 3: mature cards scheduled FAR IN THE FUTURE (1+ years out) are safe
  // to drop — the user has mastered them and the SM-2 algorithm won't surface
  // them again for a long time. Sign is + (future), not - (past).
  const cutoff1yFuture = new Date(Date.now() + MATURE_CARD_FUTURE_DAYS * DAY_MS).toISOString();

  const results = { stage1: 0, stage2: 0, stage3: 0 };

  if (pct > QUOTA_THRESHOLDS.STAGE_1) {
    const events = await evictFromStore('studyEvents', (entry) => {
      // studyEvents use `ts` per V20 taxonomy; fall back to legacy names.
      const t = entry.ts || entry.timestamp || entry.createdAt || entry.updatedAt;
      return t && t < cutoff90;
    });
    results.stage1 = events;
  }

  if (pct > QUOTA_THRESHOLDS.STAGE_2) {
    const logs = await evictFromStore('syncLog', (entry) => {
      const t = entry.timestamp || entry.updatedAt;
      return t && t < cutoff30;
    });
    results.stage2 = logs;
  }

  if (pct > QUOTA_THRESHOLDS.STAGE_3) {
    const cards = await evictFromStore('flashcardTracker', (entry) => {
      const repetitions = entry.repetitions || 0;
      const nextReview = entry.nextReviewAt;
      // Mature = many reps AND scheduled far in the future.
      return repetitions >= MATURE_CARD_MIN_REPETITIONS
        && nextReview
        && nextReview > cutoff1yFuture;
    });
    results.stage3 = cards;
  }

  return results;
}

export async function onQuotaExceeded(retryFn) {
  await evict();
  return retryFn();
}
