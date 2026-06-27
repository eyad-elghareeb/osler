/* ================================================================
   content-pack.js  —  V2 (Phase 10)
   ----------------------------------------------------------------
   File-based content pack export/import. A pack is a single JSON
   file containing one or more content items.

   Format:
     {
       "packFormat": "osler-content-pack",
       "packVersion": "1.0",
       "exportedAt": "<ISO 8601>",
       "exportedBy": { "uid": "...", "displayName": "..." },
       "sourceInstance": "<URL>",
       "items": [ ...content items... ]
     }

   Sharing is file-based (anti-goal: no public registry). Users
   export to a .json file, share via email/USB/chat, recipients
   import via file picker.
   ================================================================ */

import { getAll, put } from './storage.js';
import { validate } from './validate.js';
import { currentUser } from './auth.js';
import { listUserContent, createUserContent, updateUserContent } from './user-content.js';

const PACK_FORMAT = 'osler-content-pack';
const PACK_VERSION = '1.0';

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a content pack from selected user content items.
 *
 * @param {object[]} items — items to include
 * @param {object} [opts]
 * @param {string} [opts.sourceInstance] — URL of this PWA instance
 * @returns {object} the pack object
 */
export function buildContentPack(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('[content-pack] items must be a non-empty array');
  }

  const user = currentUser();

  return {
    packFormat: PACK_FORMAT,
    packVersion: PACK_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: {
      uid: user?.uid || 'anonymous',
      displayName: user?.displayName || 'Anonymous',
    },
    sourceInstance: opts.sourceInstance || (typeof window !== 'undefined' ? window.location.origin : ''),
    items: items.map(item => ({
      // Strip any internal fields (e.g. _syncMeta) before export
      ...item,
      meta: { ...item.meta },
    })),
  };
}

/**
 * Export user content to a downloadable JSON file.
 * Triggers a browser download.
 *
 * @param {string[]} [uids] — optional UIDs to export; if omitted, exports all
 * @param {string} [filename] — optional filename; defaults to osler-content-pack-{date}.json
 * @returns {Promise<{ filename: string, itemCount: number, sizeBytes: number }>}
 */
export async function exportContentPack(uids, filename) {
  let items;
  if (uids && uids.length > 0) {
    items = await Promise.all(uids.map(uid => getAll('userContent').then(all =>
      all.find(i => i.uid === uid || i.meta?.uid === uid)
    )));
    items = items.filter(Boolean);
  } else {
    items = await listUserContent();
  }

  if (items.length === 0) {
    throw new Error('[content-pack] no items to export');
  }

  const pack = buildContentPack(items);
  const json = JSON.stringify(pack, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const finalFilename = filename ||
    `osler-content-pack-${new Date().toISOString().slice(0, 10)}.json`;

  // Browser download
  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Revoke after a short delay (some browsers need the URL alive briefly)
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return {
    filename: finalFilename,
    itemCount: items.length,
    sizeBytes: blob.size,
  };
}

/**
 * Upload a content pack to Firebase Storage and return a shareable URL.
 * Requires Storage to be configured (see firebase.js isStorageEnabled).
 *
 * @param {string[]} [uids] — UIDs to export
 * @param {boolean} [sharePublic=true] — set custom metadata to allow public read
 * @returns {Promise<{ url: string, filename: string }>}
 */
export async function shareContentPackViaUrl(uids, sharePublic = true) {
  const items = uids
    ? (await Promise.all(uids.map(async uid => {
        const all = await listUserContent();
        return all.find(i => i.uid === uid || i.meta?.uid === uid);
      }))).filter(Boolean)
    : await listUserContent();

  if (items.length === 0) {
    throw new Error('[content-pack] no items to share');
  }

  // Dynamic import — Storage is optional, don't load the SDK if unused
  const { storage, isStorageEnabled } = await import('./firebase.js');
  if (!isStorageEnabled() || !storage) {
    throw new Error('[content-pack] Firebase Storage is not configured');
  }

  const { ref, uploadBytes, getDownloadURL, updateMetadata } = await import('firebase/storage');
  const { currentUser } = await import('./auth.js');
  const user = currentUser();
  if (!user?.uid) {
    throw new Error('[content-pack] must be signed in to share via URL');
  }

  const pack = buildContentPack(items);
  const json = JSON.stringify(pack, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const filename = `osler-pack-${Date.now()}.json`;
  const path = `userContent/${user.uid}/${filename}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, blob);

  if (sharePublic) {
    await updateMetadata(storageRef, {
      customMetadata: { sharePublic: 'true' },
    });
  }

  const url = await getDownloadURL(storageRef);
  return { url, filename };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate a content pack JSON string.
 * Does NOT write to IndexedDB. Used by importContentPack + for preview UI.
 *
 * @param {string} jsonStr
 * @returns {{ valid: boolean, items: object[], errors: object[], packMeta: object|null }}
 */
export function parseContentPack(jsonStr) {
  let pack;
  try {
    pack = JSON.parse(jsonStr);
  } catch (e) {
    return {
      valid: false,
      items: [],
      errors: [{ message: `Invalid JSON: ${e.message}` }],
      packMeta: null,
    };
  }

  if (!pack || pack.packFormat !== PACK_FORMAT) {
    return {
      valid: false,
      items: [],
      errors: [{ message: `Unknown packFormat (expected "${PACK_FORMAT}")` }],
      packMeta: pack ? { packFormat: pack.packFormat, packVersion: pack.packVersion } : null,
    };
  }

  if (pack.packVersion !== PACK_VERSION) {
    return {
      valid: false,
      items: [],
      errors: [{ message: `Unsupported packVersion "${pack.packVersion}" (expected "${PACK_VERSION}")` }],
      packMeta: { packFormat: pack.packFormat, packVersion: pack.packVersion },
    };
  }

  if (!Array.isArray(pack.items) || pack.items.length === 0) {
    return {
      valid: false,
      items: [],
      errors: [{ message: 'Pack contains no items' }],
      packMeta: { packFormat: pack.packFormat, packVersion: pack.packVersion },
    };
  }

  // Check UID uniqueness within the pack
  const seenUids = new Set();
  const dupUids = new Set();
  for (const item of pack.items) {
    const uid = item.meta?.uid;
    if (!uid) {
      // Missing UID — will be caught by validate() below
      continue;
    }
    if (seenUids.has(uid)) dupUids.add(uid);
    seenUids.add(uid);
  }

  const errors = [];
  if (dupUids.size > 0) {
    errors.push({
      message: `Duplicate UIDs within pack: ${[...dupUids].join(', ')}`,
    });
  }

  // Validate each item
  const validItems = [];
  for (const item of pack.items) {
    const result = validate(item);
    if (result.valid) {
      validItems.push(item);
    } else {
      for (const err of result.errors || []) {
        errors.push({
          message: `Item ${item.meta?.uid || '(unknown)'}: ${err.message}`,
          path: err.path,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    items: validItems,
    errors,
    packMeta: {
      packFormat: pack.packFormat,
      packVersion: pack.packVersion,
      exportedAt: pack.exportedAt,
      exportedBy: pack.exportedBy,
      sourceInstance: pack.sourceInstance,
      itemCount: pack.items.length,
    },
  };
}

/**
 * Import a content pack into IndexedDB.
 *
 * @param {File|string} input — File object (from file picker) or JSON string
 * @param {object} [opts]
 * @param {'overwrite'|'skip'|'rename'} [opts.onConflict='skip'] — UID collision behavior
 * @returns {Promise<{ imported: number, skipped: number, renamed: number, errors: object[] }>}
 */
export async function importContentPack(input, opts = {}) {
  const onConflict = opts.onConflict || 'skip';

  let jsonStr;
  if (typeof input === 'string') {
    jsonStr = input;
  } else if (input instanceof File) {
    jsonStr = await input.text();
  } else if (input instanceof Blob) {
    jsonStr = await input.text();
  } else {
    throw new Error('[content-pack] input must be File, Blob, or string');
  }

  const parsed = parseContentPack(jsonStr);

  if (parsed.items.length === 0) {
    return { imported: 0, skipped: 0, renamed: 0, errors: parsed.errors };
  }

  let imported = 0;
  let skipped = 0;
  let renamed = 0;
  const errors = [...parsed.errors];

  // Get local UIDs to detect collisions
  const localItems = await getAll('userContent');
  const localUids = new Set(localItems.map(i => i.uid || i.meta?.uid));

  for (const item of parsed.items) {
    const uid = item.meta.uid;
    // Ensure top-level uid for IndexedDB store (keyPath: 'uid')
    const storeItem = { ...item, uid: item.uid || uid };

    if (localUids.has(uid)) {
      if (onConflict === 'skip') {
        skipped++;
        continue;
      }
      if (onConflict === 'overwrite') {
        // Direct put (don't bump updatedAt — preserve the imported item's timestamps)
        try {
          await put('userContent', storeItem);
          imported++;
        } catch (e) {
          errors.push({ message: `Failed to overwrite ${uid}: ${e.message}` });
        }
        continue;
      }
      if (onConflict === 'rename') {
        // Generate a new UID with an import suffix
        const newUid = `${uid}-imp-${Date.now().toString(36)}`;
        const renamedItem = {
          ...storeItem,
          uid: newUid,
          meta: {
            ...storeItem.meta,
            uid: newUid,
            // Mark as imported (don't bump updatedAt — preserve original)
            importedFrom: uid,
          },
        };
        try {
          await put('userContent', renamedItem);
          imported++;
          renamed++;
        } catch (e) {
          errors.push({ message: `Failed to import renamed ${uid}: ${e.message}` });
        }
        continue;
      }
    }

    // No conflict — direct put
    try {
      await put('userContent', storeItem);
      imported++;
    } catch (e) {
      errors.push({ message: `Failed to import ${uid}: ${e.message}` });
    }
  }

  // Trigger background sync if Firebase is configured
  if (imported > 0) {
    try {
      const { forceSyncUserContent } = await import('./user-content.js');
      forceSyncUserContent().catch(e => {
        console.warn('[content-pack] post-import sync failed:', e);
      });
    } catch (e) {
      // sync-user-content not available (e.g. Firebase disabled) — silent
    }
  }

  return { imported, skipped, renamed, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// File picker helpers (used by the hub UI)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a file picker and import the selected pack.
 * Returns a promise that resolves with the import result.
 */
export function pickAndImportContentPack(opts) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ imported: 0, skipped: 0, renamed: 0, errors: [] });
        return;
      }
      try {
        const result = await importContentPack(file, opts);
        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(input);
      }
    };

    input.oncancel = () => {
      resolve({ imported: 0, skipped: 0, renamed: 0, errors: [] });
      try { document.body.removeChild(input); } catch {}
    };

    document.body.appendChild(input);
    input.click();
  });
}

export { PACK_FORMAT, PACK_VERSION };
