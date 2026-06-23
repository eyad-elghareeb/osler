const DAY_MS = 86400000;

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

  const cutoff90 = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const cutoff1y = new Date(Date.now() - 365 * DAY_MS).toISOString();

  const results = { stage1: 0, stage2: 0, stage3: 0 };

  if (pct > 85) {
    const events = await evictFromStore('studyEvents', (entry) => {
      const t = entry.timestamp || entry.createdAt || entry.updatedAt;
      return t && t < cutoff90;
    });
    results.stage1 = events;
  }

  if (pct > 90) {
    const logs = await evictFromStore('syncLog', (entry) => {
      const t = entry.timestamp || entry.updatedAt;
      return t && t < cutoff30;
    });
    results.stage2 = logs;
  }

  if (pct > 95) {
    const cards = await evictFromStore('flashcardTracker', (entry) => {
      const repetitions = entry.repetitions || 0;
      const nextReview = entry.nextReviewAt;
      return repetitions >= 5 && nextReview && nextReview < cutoff1y;
    });
    results.stage3 = cards;
  }

  return results;
}

export async function onQuotaExceeded(retryFn) {
  await evict();
  return retryFn();
}
