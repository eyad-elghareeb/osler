/* ================================================================
   sync-user-content.js  —  V2 (Phase 9)
   ----------------------------------------------------------------
   Extends V1 src/lib/sync.js to sync the `userContent` IndexedDB
   store to Firestore at userContent/{uid}/items/{itemId}.

   Reuses V1's `fieldMergeByUpdatedAt` strategy — user content items
   have per-field updatedAt companions, same as tracker records.

   This module is loaded BY sync.js (not standalone). V1 sync.js is
   preserved unchanged; we add a `syncUserContent()` function that
   the main sync loop calls alongside the existing tracker syncs.
   ================================================================ */

import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { db, isFirebaseEnabled } from './firebase.js';
import { get, getAll, put } from './storage.js';
import { getDeviceId } from './sync-utils.js';
import { fieldMergeByUpdatedAt } from './sync.js'; // reuse V1 strategy

const USER_CONTENT_COLLECTION = 'userContent';
const SYNC_LOG_STORE = 'syncLog';
const META_STORE = 'settings';
const LAST_SYNC_KEY = 'userContentLastSync';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push local userContent changes to Firestore.
 * Iterates local items, writes each to userContent/{uid}/items/{itemId}
 * if local updatedAt > remote updatedAt.
 *
 * @param {string} uid — Firebase auth UID
 * @returns {Promise<{pushed: number, skipped: number, errors: Error[]}>}
 */
export async function pushUserContent(uid) {
  if (!isFirebaseEnabled() || !uid) {
    return { pushed: 0, skipped: 0, errors: [] };
  }

  const localItems = await getAll('userContent');
  let pushed = 0;
  let skipped = 0;
  const errors = [];

  for (const localItem of localItems) {
    if (!localItem.uid) continue;

    try {
      const itemRef = doc(db, USER_CONTENT_COLLECTION, uid, 'items', localItem.uid);
      const remoteSnap = await getDoc(itemRef);
      const remoteItem = remoteSnap.exists() ? remoteSnap.data() : null;

      const localTs = localItem.meta?.updatedAt || '';
      const remoteTs = remoteItem?.meta?.updatedAt || '';

      // Skip if remote is newer or equal (remote wins on tie per V1 strategy)
      if (remoteTs >= localTs && remoteTs !== '') {
        skipped++;
        continue;
      }

      await setDoc(itemRef, localItem, { merge: true });
      pushed++;

      await logSync('userContent', localItem.uid, 'push', {
        localTs,
        remoteTs,
      });
    } catch (e) {
      console.warn(`[sync-user-content] push failed for ${localItem.uid}:`, e);
      errors.push(e);
    }
  }

  return { pushed, skipped, errors };
}

/**
 * Pull remote userContent changes to IndexedDB.
 * Reads all items from userContent/{uid}/items/*, merges with local.
 *
 * @param {string} uid — Firebase auth UID
 * @returns {Promise<{pulled: number, merged: number, errors: Error[]}>}
 */
export async function pullUserContent(uid) {
  if (!isFirebaseEnabled() || !uid) {
    return { pulled: 0, merged: 0, errors: [] };
  }

  const localItems = await getAll('userContent');
  const localMap = new Map(localItems.map(i => [i.uid, i]));

  const itemsCol = collection(db, USER_CONTENT_COLLECTION, uid, 'items');
  const remoteSnap = await getDocs(itemsCol);

  let pulled = 0;
  let merged = 0;
  const errors = [];

  for (const docSnap of remoteSnap.docs) {
    const remoteItem = docSnap.data();
    if (!remoteItem.uid) continue;

    const localItem = localMap.get(remoteItem.uid);
    const mergedItem = fieldMergeByUpdatedAt(localItem, remoteItem);

    try {
      await put('userContent', mergedItem);
      pulled++;
      if (JSON.stringify(mergedItem) !== JSON.stringify(localItem || {})) {
        merged++;
      }

      await logSync('userContent', remoteItem.uid, 'pull', {
        remoteTs: remoteItem.meta?.updatedAt || '',
        localTs: localItem?.meta?.updatedAt || '',
      });
    } catch (e) {
      console.warn(`[sync-user-content] pull failed for ${remoteItem.uid}:`, e);
      errors.push(e);
    }
  }

  // Update last-sync timestamp
  await put(META_STORE, {
    key: LAST_SYNC_KEY,
    value: new Date().toISOString(),
  });

  return { pulled, merged, errors };
}

/**
 * Subscribe to real-time updates for userContent.
 * Called when the user signs in. Returns an unsubscribe function.
 *
 * @param {string} uid
 * @param {function} onChange — callback(items: array)
 * @returns {function|null} unsubscribe
 */
export function subscribeToUserContent(uid, onChange) {
  if (!isFirebaseEnabled() || !uid) return null;

  const itemsCol = collection(db, USER_CONTENT_COLLECTION, uid, 'items');
  return onSnapshot(itemsCol, async (snap) => {
    // Pull each changed doc and merge with local
    for (const docChange of snap.docChanges()) {
      if (docChange.type === 'added' || docChange.type === 'modified') {
        const remoteItem = docChange.doc.data();
        const localItem = await get('userContent', remoteItem.uid).catch(() => null);
        const mergedItem = fieldMergeByUpdatedAt(localItem, remoteItem);
        try {
          await put('userContent', mergedItem);
        } catch (e) {
          console.warn('[sync-user-content] real-time put failed:', e);
        }
      }
      // 'removed' is intentionally not handled — V2 doesn't sync deletions
      // (a user can delete locally, but the remote copy stays until the user
      // explicitly deletes from the cloud UI).
    }

    if (typeof onChange === 'function') {
      const all = await getAll('userContent');
      onChange(all);
    }
  }, (err) => {
    console.warn('[sync-user-content] real-time subscription error:', err);
  });
}

/**
 * Full sync — push then pull. Used by the main sync loop.
 *
 * @param {string} uid
 */
export async function syncUserContent(uid) {
  if (!isFirebaseEnabled() || !uid) return;

  const pushResult = await pushUserContent(uid);
  const pullResult = await pullUserContent(uid);

  if (pushResult.errors.length || pullResult.errors.length) {
    console.warn(
      `[sync-user-content] sync completed with errors:`,
      'push:', pushResult.errors.length,
      'pull:', pullResult.errors.length
    );
  }

  return {
    pushed: pushResult.pushed,
    pulled: pullResult.pulled,
    merged: pullResult.merged,
    errors: [...pushResult.errors, ...pullResult.errors],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: sync log (mirrors V1 sync.js's logSync but for userContent)
// ─────────────────────────────────────────────────────────────────────────────

async function logSync(entryType, entryUid, operation, fieldChanges) {
  try {
    await put(SYNC_LOG_STORE, {
      entryType,
      entryUid,
      operation,
      fieldChanges,
      timestamp: new Date().toISOString(),
      deviceId: getDeviceId(),
    });
  } catch (e) {
    console.warn('[sync-user-content] logSync failed:', e);
  }
}
