import { collection, doc, getDoc, setDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase.js';
import { get, getAll, put, deleteEntry } from './storage.js';
import { subscribe } from './auth.js';

const DEVICE_ID_KEY = 'osler_device_id';

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function logSync(entryType, entryUid, operation, fieldChanges) {
  await put('syncLog', {
    entryType, entryUid, operation, fieldChanges,
    timestamp: new Date().toISOString(),
    deviceId: getDeviceId(),
  }).catch(() => {});
}

/* ── Merge Strategies ── */

export function appendOnly(local, remote) {
  const seen = new Set();
  const merged = [];

  for (const item of [...(local || []), ...(remote || [])]) {
    const key = `${item.timestamp}_${item.deviceId}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}

export function fieldMergeByUpdatedAt(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const localNewer = local.updatedAt > remote.updatedAt;
  const base = localNewer ? { ...local } : { ...remote };
  const other = localNewer ? remote : local;

  for (const key of Object.keys(other)) {
    if (key === 'updatedAt' || key.endsWith('At')) continue;
    if (base[key] === undefined) {
      base[key] = other[key];
    }
  }

  base.updatedAt = local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt;
  return base;
}

export function sm2Merge(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const localTime = local.lastReviewedAt || '';
  const remoteTime = remote.lastReviewedAt || '';

  let base;
  if (localTime >= remoteTime) {
    base = { ...local };
  } else {
    base = { ...remote };
  }

  base.totalReviews = Math.max(local.totalReviews || 0, remote.totalReviews || 0);
  if (local.lapses !== undefined && remote.lapses !== undefined) {
    base.lapses = Math.max(local.lapses, remote.lapses);
  }

  base.updatedAt = new Date().toISOString();
  return base;
}

export function lwwBodyKeepTitles(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const merged = { ...remote };

  if (local.title !== remote.title) {
    merged.title = remote.title;
    merged.alternateTitles = [...(local.alternateTitles || [])];
    if (local.title && !merged.alternateTitles.includes(local.title)) {
      merged.alternateTitles.push(local.title);
    }
  }

  return merged;
}

export function maxStreak(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  return {
    key: local.key || remote.key,
    currentStreak: Math.max(local.currentStreak || 0, remote.currentStreak || 0),
    longestStreak: Math.max(local.longestStreak || 0, remote.longestStreak || 0),
    lastActivityDate: local.lastActivityDate > remote.lastActivityDate ? local.lastActivityDate : remote.lastActivityDate,
    updatedAt: new Date().toISOString(),
  };
}

/* ── Sync Strategies per Store ── */

const STORE_MERGE = {
  studyEvents: { strategy: 'appendOnly', merge: appendOnly },
  syncLog: { strategy: 'appendOnly', merge: appendOnly },
  quizTracker: { strategy: 'fieldMerge', merge: fieldMergeByUpdatedAt },
  writtenTracker: { strategy: 'fieldMerge', merge: fieldMergeByUpdatedAt },
  osceTracker: { strategy: 'fieldMerge', merge: fieldMergeByUpdatedAt },
  flashcardTracker: { strategy: 'sm2', merge: sm2Merge },
  userContent: { strategy: 'lww', merge: lwwBodyKeepTitles },
  streak: { strategy: 'streak', merge: maxStreak },
};

/* ── Sync Operations ── */

export async function syncPush(uid) {
  if (!db || !uid) throw new Error('Sync: firebase or user not available');

  const results = [];

  for (const [storeName, config] of Object.entries(STORE_MERGE)) {
    const entries = await getAll(storeName);
    if (entries.length === 0) continue;

    const batch = writeBatch(db);
    let count = 0;

    for (const entry of entries) {
      const key = entry.uid || entry.key || entry.contentUid || JSON.stringify(entry);
      const ref = doc(db, 'users', uid, storeName, String(key));
      batch.set(ref, { ...entry, _deviceId: getDeviceId(), _syncedAt: new Date().toISOString() });
      count++;
    }

    await batch.commit();
    results.push({ store: storeName, pushed: count });
    await logSync(storeName, uid, 'push', { count });
  }

  return results;
}

export async function syncPull(uid) {
  if (!db || !uid) throw new Error('Sync: firebase or user not available');

  const results = [];

  for (const [storeName, config] of Object.entries(STORE_MERGE)) {
    const snapshot = await getDocs(collection(db, 'users', uid, storeName));
    if (snapshot.empty) continue;

    let merged = 0;
    for (const docSnap of snapshot.docs) {
      const remote = docSnap.data();
      const key = docSnap.id;

      const local = await get(storeName, key);
      const mergedEntry = config.merge(local, remote);

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

export function initAutoSync() {
  subscribe((user) => {
    if (_syncInterval) {
      clearInterval(_syncInterval);
      _syncInterval = null;
    }

    if (user && !user.isGuest) {
      syncFull(user.uid).catch(() => {});
      _syncInterval = setInterval(() => {
        syncFull(user.uid).catch(() => {});
      }, 5 * 60 * 1000);
    }
  });
}
