/* ================================================================
   user-content.js  —  V2 (Phase 10)
   ----------------------------------------------------------------
   User-authored custom content. Lives in the V1 `userContent`
   IndexedDB store (already provisioned in V1's storage.js). V2
   adds CRUD operations + syncs to Firestore via sync-user-content.js
   (Phase 9) when Firebase is configured.

   This module is the PWA-side API. The Tauri admin uses a separate
   Rust path (CMS workflow on GitHub) for admin-managed content.
   ================================================================ */

import { getAll, get, put, delete_ } from './storage.js';
import { validate } from './validate.js';
import { currentUser } from './auth.js';
import { isFirebaseEnabled } from './firebase.js';
import { syncUserContent } from './sync-user-content.js';

// ─────────────────────────────────────────────────────────────────────────────
// UID generation
//
// Format: user-{type}-{timestamp}-{random}
// The `user-` prefix makes user content UIDs visually distinguishable
// from admin-managed content UIDs in the hub.
// ─────────────────────────────────────────────────────────────────────────────

function generateUid(type) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `user-${type}-${ts}-${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new user content item.
 *
 * @param {string} type — 'quiz' | 'bank' | 'flashcard' | 'written' | 'osce'
 * @param {object} data — full content item (without meta; we generate it)
 * @param {object} metaOverrides — optional meta fields to override
 * @returns {Promise<object>} the saved item (with full meta)
 * @throws if validation fails
 */
export async function createUserContent(type, data, metaOverrides = {}) {
  if (!type) throw new Error('[user-content] type is required');
  if (!data) throw new Error('[user-content] data is required');

  const user = currentUser();
  const uid = metaOverrides.uid || generateUid(type);
  const now = nowIso();

  const item = {
    type,
    meta: {
      uid,
      title: metaOverrides.title || 'Untitled',
      schemaVersion: '1.0',
      createdAt: now,
      updatedAt: now,
      lang: metaOverrides.lang || 'en',
      tags: metaOverrides.tags || [],
      estimatedTime: metaOverrides.estimatedTime || 0,
      difficulty: metaOverrides.difficulty || null,
      author: user?.displayName || 'Anonymous',
      ...metaOverrides,
      // Force these (overrides can't change them):
      uid, // immutable
      createdAt: metaOverrides.createdAt || now,
      schemaVersion: '1.0',
    },
    ...data,
  };

  // Validate before write — never write invalid content to IndexedDB
  const result = validate(item);
  if (!result.valid) {
    const msg = result.errors?.[0]?.message || 'validation failed';
    throw new Error(`[user-content] ${msg}`);
  }

  await put('userContent', item);

  // Sync to Firestore if signed in
  if (isFirebaseEnabled() && user?.uid) {
    syncUserContent(user.uid).catch(e => {
      console.warn('[user-content] background sync failed:', e);
    });
  }

  return item;
}

/**
 * Update an existing user content item.
 * Bumps meta.updatedAt. Validates before write.
 *
 * @param {string} uid
 * @param {object} updates — partial item to merge
 * @returns {Promise<object>} the updated item
 * @throws if item not found or validation fails
 */
export async function updateUserContent(uid, updates) {
  const existing = await get('userContent', uid);
  if (!existing) {
    throw new Error(`[user-content] item not found: ${uid}`);
  }

  const updated = {
    ...existing,
    ...updates,
    meta: {
      ...existing.meta,
      ...(updates.meta || {}),
      // updatedAt always bumps; createdAt + uid + schemaVersion are immutable
      updatedAt: nowIso(),
      uid: existing.meta.uid,
      createdAt: existing.meta.createdAt,
      schemaVersion: existing.meta.schemaVersion,
    },
  };

  const result = validate(updated);
  if (!result.valid) {
    const msg = result.errors?.[0]?.message || 'validation failed';
    throw new Error(`[user-content] ${msg}`);
  }

  await put('userContent', updated);

  if (isFirebaseEnabled()) {
    const user = currentUser();
    if (user?.uid) {
      syncUserContent(user.uid).catch(e => {
        console.warn('[user-content] background sync failed:', e);
      });
    }
  }

  return updated;
}

/**
 * Delete a user content item.
 * Local-only delete — remote copy stays until user deletes via cloud UI.
 * (V2 design decision: deletions don't sync.)
 *
 * @param {string} uid
 */
export async function deleteUserContent(uid) {
  await delete_('userContent', uid);
}

/**
 * List all user content items, optionally filtered by type.
 *
 * @param {string} [type] — optional type filter
 * @returns {Promise<object[]>}
 */
export async function listUserContent(type) {
  const all = await getAll('userContent');
  if (!type) return all;
  return all.filter(item => item.type === type);
}

/**
 * Get a single user content item by UID.
 *
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
export async function getUserContent(uid) {
  return await get('userContent', uid);
}

/**
 * Force a sync (push + pull) of user content.
 * Called by the UI when the user clicks "Sync now".
 */
export async function forceSyncUserContent() {
  if (!isFirebaseEnabled()) {
    return { skipped: true, reason: 'Firebase not configured' };
  }
  const user = currentUser();
  if (!user?.uid) {
    return { skipped: true, reason: 'Not signed in' };
  }
  return await syncUserContent(user.uid);
}
