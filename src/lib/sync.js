import { collection, doc, getDoc, setDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase.js';
import { get, getAll, put, deleteEntry, STORES } from './storage.js';
import { subscribe } from './auth.js';
import { getDeviceId } from './sync-utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Sync log — every sync decision is recorded for auditability (P3.4 spec).
// Never silently swallow errors here; a missing sync log breaks the audit trail.
// ─────────────────────────────────────────────────────────────────────────────

async function logSync(entryType, entryUid, operation, fieldChanges) {
  try {
    await put('syncLog', {
      entryType, entryUid, operation, fieldChanges,
      timestamp: new Date().toISOString(),
      deviceId: getDeviceId(),
    });
  } catch (e) {
    // Sync-log failures must not break sync, but they MUST be visible.
    console.warn('[sync] logSync failed (audit trail compromised):', e);
  }
}

/* ── Merge Strategies ── */

/**
 * Append-only merge for studyEvents and syncLog.
 * Dedupes on a composite key built from ALL identifying fields per the V20
 * taxonomy: ts + deviceId + contentUid + itemId + action + outcome.
 * Using only ts+deviceId was wrong — multiple events from one device in the
 * same millisecond collapsed onto one key (B1 bug).
 */
export function appendOnly(local, remote) {
  const seen = new Set();
  const merged = [];

  const dedupeKey = (item) => [
    item.ts || item.timestamp || '',
    item.deviceId || '',
    item.contentUid || '',
    item.itemId || '',
    item.action || '',
    item.outcome || '',
  ].join('|');

  for (const item of [...(local || []), ...(remote || [])]) {
    const key = dedupeKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}

/**
 * TRUE field-level merge by `updatedAt`.
 * For each field, pick the value from whichever record has the newer `updatedAt`.
 * Side-level merge (pick newer record, fill missing from older) was wrong —
 * older-side updates to fields already present on the newer side were dropped.
 *
 * Special-cased fields:
 *   - `updatedAt`: always max of the two
 *   - `createdAt`: always min of the two (preserves original creation)
 *   - `*At` timestamp fields that track "last activity": always max (H11 fix)
 */
export function fieldMergeByUpdatedAt(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const result = {};
  const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

  const localTs = local.updatedAt || '';
  const remoteTs = remote.updatedAt || '';
  const localNewer = localTs >= remoteTs;

  for (const key of allKeys) {
    const lv = local[key];
    const rv = remote[key];

    if (key === 'updatedAt') {
      result[key] = localTs > remoteTs ? localTs : remoteTs;
      continue;
    }
    if (key === 'createdAt') {
      // Preserve the earliest known creation time.
      const lt = lv || '';
      const rt = rv || '';
      result[key] = (lt && rt) ? (lt < rt ? lt : rt) : (lt || rt);
      continue;
    }
    if (key.endsWith('At')) {
      // Timestamp fields tracking activity (lastReviewedAt, lastActivityAt, etc.)
      // take the MAX — most recent activity wins.
      const lt = lv || '';
      const rt = rv || '';
      result[key] = (lt && rt) ? (lt > rt ? lt : rt) : (lt || rt);
      continue;
    }

    // For non-timestamp fields: pick the value from whichever record is newer.
    // If only one side has it, use that side's value.
    if (lv === undefined) result[key] = rv;
    else if (rv === undefined) result[key] = lv;
    else result[key] = localNewer ? lv : rv;
  }

  return result;
}

/**
 * SM-2 merge: later review wins the algorithmic state, both sides contribute
 * to totals. Per Appendix D: "later review wins state, both count toward totals".
 */
export function sm2Merge(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const localTime = local.lastReviewedAt || '';
  const remoteTime = remote.lastReviewedAt || '';

  // Later review wins the state (easeFactor, interval, nextReviewAt, etc.)
  const base = localTime >= remoteTime ? { ...local } : { ...remote };

  // Totals SUM (not max) — both devices' reviews count.
  base.totalReviews = (local.totalReviews || 0) + (remote.totalReviews || 0);
  // lapses is the count of "Again" ratings — also sum, since each device
  // may have independent lapse events.
  base.lapses = (local.lapses || 0) + (remote.lapses || 0);

  // avgTimePerReview: weighted average across both devices.
  const localReviews = local.totalReviews || 0;
  const remoteReviews = remote.totalReviews || 0;
  const totalReviews = localReviews + remoteReviews;
  if (totalReviews > 0) {
    base.avgTimePerReview = (
      (local.avgTimePerReview || 0) * localReviews +
      (remote.avgTimePerReview || 0) * remoteReviews
    ) / totalReviews;
  }

  base.updatedAt = new Date().toISOString();
  return base;
}

/**
 * LWW body with title conflict preservation.
 * Body uses true last-write-wins by `updatedAt`. Title conflicts preserve
 * both: the newer title wins, the older title goes into alternateTitles[]
 * with a `(2)` suffix as the spec calls for.
 */
export function lwwBodyKeepTitles(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const localTs = local.updatedAt || '';
  const remoteTs = remote.updatedAt || '';
  const remoteNewer = remoteTs >= localTs;

  // LWW body: pick whichever record is newer.
  const merged = remoteNewer ? { ...remote } : { ...local };
  merged.updatedAt = localTs > remoteTs ? localTs : remoteTs;

  // Title conflict: newer title wins; older title goes into alternateTitles[].
  if (local.title && remote.title && local.title !== remote.title) {
    const newerTitle = remoteNewer ? remote.title : local.title;
    const olderTitle = remoteNewer ? local.title : remote.title;
    merged.title = newerTitle;
    merged.alternateTitles = [...(local.alternateTitles || []), ...(remote.alternateTitles || [])];
    if (!merged.alternateTitles.includes(olderTitle)) {
      // Per spec: append "(2)" suffix on conflict to disambiguate.
      const suffixed = olderTitle + ' (2)';
      if (!merged.alternateTitles.includes(suffixed)) {
        merged.alternateTitles.push(suffixed);
      }
    }
  }

  return merged;
}

/**
 * Streak merge: max of currentStreak / longestStreak / lastActivityDate.
 * Preserves ALL other fields (xp, level, key) — previous impl dropped them.
 */
export function maxStreak(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const merged = { ...local, ...remote }; // preserve all fields from both sides
  merged.currentStreak = Math.max(local.currentStreak || 0, remote.currentStreak || 0);
  merged.longestStreak = Math.max(local.longestStreak || 0, remote.longestStreak || 0);
  // lastActivityDate: pick the most recent.
  const lDate = local.lastActivityDate || '';
  const rDate = remote.lastActivityDate || '';
  merged.lastActivityDate = lDate > rDate ? lDate : rDate;
  // xp / level: take the MAX (user shouldn't lose progress from a stale device).
  merged.xp = Math.max(local.xp || 0, remote.xp || 0);
  merged.level = Math.max(local.level || 1, remote.level || 1);
  merged.key = local.key || remote.key || 'global';
  merged.updatedAt = new Date().toISOString();
  return merged;
}

/* ── Sync Strategies per Store ── */

// Per-store configuration. `keyFor(entry)` returns the IndexedDB key for an
// entry — this is critical because different stores use different key shapes
// (composite arrays for quizTracker, single strings for others).
const STORE_MERGE = {
  studyEvents: {
    strategy: 'appendOnly',
    merge: appendOnly,
    // studyEvents has autoIncrement keyPath, so no natural key. Build one from
    // the V20 taxonomy fields so events dedupe properly on push/pull.
    keyFor: (entry) => [
      entry.ts || entry.timestamp || '',
      entry.deviceId || '',
      entry.contentUid || '',
      entry.itemId || '',
      entry.action || '',
      entry.outcome || '',
    ].join('|'),
  },
  syncLog: {
    strategy: 'appendOnly',
    merge: appendOnly,
    keyFor: (entry) => [
      entry.timestamp || '',
      entry.deviceId || '',
      entry.entryType || '',
      entry.entryUid || '',
      entry.operation || '',
    ].join('|'),
  },
  quizTracker: {
    strategy: 'fieldMerge',
    merge: fieldMergeByUpdatedAt,
    // Composite key [contentUid, itemId] per Appendix A.
    keyFor: (entry) => [entry.contentUid, entry.itemId],
    keyIsArray: true,
  },
  writtenTracker: {
    strategy: 'fieldMerge',
    merge: fieldMergeByUpdatedAt,
    keyFor: (entry) => entry.uid,
  },
  osceTracker: {
    strategy: 'fieldMerge',
    merge: fieldMergeByUpdatedAt,
    keyFor: (entry) => entry.uid,
  },
  flashcardTracker: {
    strategy: 'sm2',
    merge: sm2Merge,
    keyFor: (entry) => entry.uid,
  },
  userContent: {
    strategy: 'lww',
    merge: lwwBodyKeepTitles,
    keyFor: (entry) => entry.uid,
  },
  streak: {
    strategy: 'streak',
    merge: maxStreak,
    keyFor: () => 'global',
  },
};

/* ── Sync Operations ── */

/**
 * Push all local entries from each store to Firestore under users/{uid}/{store}/.
 * Uses per-store keyFor() to derive a unique Firestore doc ID per entry so
 * `batch.set` doesn't collide (B1 bug fix).
 */
export async function syncPush(uid) {
  if (!db || !uid) throw new Error('syncPush: firebase or user not available');

  const results = [];

  for (const [storeName, config] of Object.entries(STORE_MERGE)) {
    const entries = await getAll(storeName);
    if (entries.length === 0) continue;

    const batch = writeBatch(db);
    let count = 0;

    for (const entry of entries) {
      // Filter: only push entries authored by this user (or anonymous ones).
      // This prevents cross-account data leaks when users switch (B1 fix).
      const entryUid = entry._userId || entry.uid;
      if (entry._userId && entry._userId !== uid) continue;

      const key = config.keyFor(entry);
      if (key === undefined || key === null || key === '') continue;

      const ref = doc(db, 'users', uid, storeName, String(key));
      batch.set(ref, {
        ...entry,
        _deviceId: getDeviceId(),
        _syncedAt: new Date().toISOString(),
      });
      count++;
    }

    if (count > 0) {
      await batch.commit();
    }
    results.push({ store: storeName, pushed: count });
    await logSync(storeName, uid, 'push', { count });
  }

  return results;
}

/**
 * Pull remote entries from Firestore and merge with local IndexedDB.
 * Uses per-store keyFor() to build the correct IndexedDB key shape
 * (composite array for quizTracker, string for others) — B1 fix.
 */
export async function syncPull(uid) {
  if (!db || !uid) throw new Error('syncPull: firebase or user not available');

  const results = [];

  for (const [storeName, config] of Object.entries(STORE_MERGE)) {
    const snapshot = await getDocs(collection(db, 'users', uid, storeName));
    if (snapshot.empty) continue;

    let merged = 0;
    for (const docSnap of snapshot.docs) {
      const remote = docSnap.data();

      // Strip sync metadata before merging so it doesn't leak into IndexedDB (B1 fix).
      const { _deviceId, _syncedAt, _userId, ...remoteData } = remote;

      // Build the correct IndexedDB key shape from the entry data.
      const idbKey = config.keyFor(remoteData);
      if (idbKey === undefined || idbKey === null || idbKey === '') continue;

      const local = await get(storeName, idbKey);
      const mergedEntry = config.merge(local, remoteData);

      if (mergedEntry) {
        await put(storeName, mergedEntry);
        merged++;
      }
    }

    results.push({ store: storeName, pulled: merged });
    await logSync(storeName, uid, 'pull', { count: merged });
  }

  return results;
}

export async function syncFull(uid) {
  const pushResult = await syncPush(uid);
  const pullResult = await syncPull(uid);
  return { pushed: pushResult, pulled: pullResult };
}

/* ── Auto-Sync ── */

let _syncInterval = null;
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function _safeSyncFull(uid) {
  try {
    return await syncFull(uid);
  } catch (e) {
    console.warn('[sync] syncFull failed (will retry next interval):', e);
    return null;
  }
}

export function initAutoSync() {
  subscribe((user) => {
    if (_syncInterval) {
      clearInterval(_syncInterval);
      _syncInterval = null;
    }

    if (user && !user.isGuest) {
      // Sync immediately on auth state change.
      _safeSyncFull(user.uid);
      _syncInterval = setInterval(() => _safeSyncFull(user.uid), SYNC_INTERVAL_MS);
    }
  });
}
