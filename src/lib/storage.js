const DB_NAME = 'osler-v1';
const DB_VERSION = 1;

// Single source of truth for store schemas. Exported so other modules
// (sync.js, quota.js) can look up keyPath / autoIncrement per store.
export const STORES = [
  { name: 'quizTracker', keyPath: ['contentUid', 'itemId'] },
  { name: 'flashcardTracker', keyPath: 'uid' },
  { name: 'writtenTracker', keyPath: 'uid' },
  { name: 'osceTracker', keyPath: 'uid' },
  { name: 'studyEvents', autoIncrement: true },
  { name: 'userContent', keyPath: 'uid' },
  { name: 'streak', keyPath: 'key' },
  { name: 'syncLog', autoIncrement: true },
  { name: 'settings', keyPath: 'key' },
];

// Quick lookup: storeName → { keyPath, autoIncrement }
const STORE_CONFIG = Object.fromEntries(STORES.map(s => [s.name, s]));

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store.name)) {
          db.createObjectStore(store.name, {
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement || false,
          });
        }
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = () => reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
  });
}

/**
 * Run a transaction. Registers oncomplete, onerror, AND onabort handlers
 * (H3 fix: missing onabort caused aborted transactions to hang the Promise).
 * The callback receives the object store and may return a Promise — the
 * transaction stays alive until the Promise resolves.
 */
function idbOperation(storeName, mode, callback) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      let callbackError = null;

      // Kick off the callback. If it returns a Promise, wait for it before
      // we let oncomplete fire (it can't fire before tx is done, but the
      // callback's own req.onsuccess must register first).
      try {
        const r = callback(store);
        if (r && typeof r.then === 'function') {
          r.then(v => { result = v; }).catch(e => { callbackError = e; });
        } else {
          result = r;
        }
      } catch (e) {
        callbackError = e;
      }

      tx.oncomplete = () => { db.close(); callbackError ? reject(callbackError) : resolve(result); };
      tx.onerror = () => { db.close(); reject(new Error(`IndexedDB transaction error: ${tx.error?.message}`)); };
      tx.onabort = () => { db.close(); reject(new Error(`IndexedDB transaction aborted: ${tx.error?.message || 'unknown cause'}`)); };
    });
  });
}

async function idbGet(storeName, key) {
  return idbOperation(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(new Error(`get failed: ${req.error?.message}`));
    });
  });
}

async function idbPut(storeName, value) {
  return idbOperation(storeName, 'readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`put failed: ${req.error?.message}`));
    });
  });
}

async function idbDelete(storeName, key) {
  return idbOperation(storeName, 'readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`delete failed: ${req.error?.message}`));
    });
  });
}

async function idbGetAll(storeName) {
  return idbOperation(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`getAll failed: ${req.error?.message}`));
    });
  });
}

async function idbClear(storeName) {
  return idbOperation(storeName, 'readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`clear failed: ${req.error?.message}`));
    });
  });
}

export async function evictFromStore(storeName, filterFn) {
  if (hasIndexedDB) return idbEvict(storeName, filterFn);
  return lsEvict(storeName, filterFn);
}

async function idbEvict(storeName, filterFn) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const cursorReq = store.openCursor();
      let deleted = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          if (filterFn(cursor.value)) {
            cursor.delete();
            deleted++;
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => { db.close(); resolve(deleted); };
      tx.onerror = () => { db.close(); reject(new Error(`evict error: ${tx.error?.message}`)); };
      tx.onabort = () => { db.close(); reject(new Error(`evict aborted: ${tx.error?.message || 'unknown cause'}`)); };
    });
  });
}

function lsEvict(storeName, filterFn) {
  const prefix = `${storeName}_`;
  let deleted = 0;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) {
        try {
          const val = JSON.parse(localStorage.getItem(k));
          if (filterFn(val)) keysToRemove.push(k);
        } catch (e) {
          console.warn(`[storage] lsEvict: failed to parse ${k}:`, e);
        }
      }
    }
    keysToRemove.forEach(k => { localStorage.removeItem(k); deleted++; });
  } catch (e) {
    console.warn(`[storage] lsEvict failed for ${storeName}:`, e);
  }
  return Promise.resolve(deleted);
}

/**
 * localStorage fallback. Used when IndexedDB is unavailable.
 *
 * H2 fix: derive the localStorage key from the store's configured keyPath
 * (not from a heuristic that drops composite-key dimensions). For
 * quizTracker with keyPath ['contentUid','itemId'], the key is
 * `quizTracker_<contentUid>_<itemId>`. For stores with autoIncrement
 * (studyEvents, syncLog), we generate a per-entry key from a counter.
 */
function lsKeyForStoreEntry(storeName, value) {
  const config = STORE_CONFIG[storeName];
  if (!config) return `${storeName}_${Math.random().toString(36).slice(2)}`;

  if (config.autoIncrement) {
    // For autoIncrement stores, derive a stable key from the entry's content.
    // studyEvents: ts + deviceId + contentUid + itemId + action
    // syncLog: timestamp + deviceId + entryType + entryUid + operation
    if (storeName === 'studyEvents') {
      return `${storeName}_${[
        value.ts || value.timestamp || '',
        value.deviceId || '',
        value.contentUid || '',
        value.itemId || '',
        value.action || '',
        value.outcome || '',
      ].join('|')}`;
    }
    if (storeName === 'syncLog') {
      return `${storeName}_${[
        value.timestamp || '',
        value.deviceId || '',
        value.entryType || '',
        value.entryUid || '',
        value.operation || '',
      ].join('|')}`;
    }
    return `${storeName}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  if (Array.isArray(config.keyPath)) {
    // Composite key (e.g. quizTracker with ['contentUid','itemId']).
    const parts = config.keyPath.map(p => value?.[p]);
    if (parts.some(p => p === undefined || p === null)) {
      return null; // caller should skip
    }
    return `${storeName}_${parts.join('_')}`;
  }

  // Single-field keyPath.
  const v = value?.[config.keyPath];
  if (v === undefined || v === null) return null;
  return `${storeName}_${v}`;
}

function lsKeyForLookup(storeName, key) {
  if (Array.isArray(key)) return `${storeName}_${key.join('_')}`;
  return `${storeName}_${key}`;
}

const ls = {
  get(storeName, key) {
    try {
      const k = lsKeyForLookup(storeName, key);
      const raw = localStorage.getItem(k);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch (e) {
      console.warn(`[storage] ls.get failed for ${storeName}:`, e);
      return Promise.resolve(null);
    }
  },
  put(storeName, value) {
    try {
      const k = lsKeyForStoreEntry(storeName, value);
      if (k === null) {
        console.warn(`[storage] ls.put: cannot derive key for ${storeName}, skipping entry:`, value);
        return Promise.resolve();
      }
      localStorage.setItem(k, JSON.stringify(value));
      return Promise.resolve();
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        return Promise.reject(e);
      }
      console.warn(`[storage] ls.put failed for ${storeName}:`, e);
      return Promise.resolve();
    }
  },
  delete(storeName, key) {
    try {
      const k = lsKeyForLookup(storeName, key);
      localStorage.removeItem(k);
      return Promise.resolve();
    } catch (e) {
      console.warn(`[storage] ls.delete failed for ${storeName}:`, e);
      return Promise.resolve();
    }
  },
  getAll(storeName) {
    try {
      const prefix = `${storeName}_`;
      const results = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) {
          try { results.push(JSON.parse(localStorage.getItem(k))); }
          catch (e) { console.warn(`[storage] ls.getAll: failed to parse ${k}:`, e); }
        }
      }
      return Promise.resolve(results);
    } catch (e) {
      console.warn(`[storage] ls.getAll failed for ${storeName}:`, e);
      return Promise.resolve([]);
    }
  },
  clear(storeName) {
    try {
      const prefix = `${storeName}_`;
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      return Promise.resolve();
    } catch (e) {
      console.warn(`[storage] ls.clear failed for ${storeName}:`, e);
      return Promise.resolve();
    }
  },
};

const hasIndexedDB = typeof indexedDB !== 'undefined';

export async function get(storeName, key) {
  if (hasIndexedDB) return idbGet(storeName, key);
  return ls.get(storeName, key);
}

export async function put(storeName, value) {
  if (hasIndexedDB) {
    try {
      return await idbPut(storeName, value);
    } catch (error) {
      const isQuota = error instanceof DOMException && (
        error.name === 'QuotaExceededError' || error.name === 'AbortError'
      );
      if (isQuota) {
        try {
          const { onQuotaExceeded } = await import('./quota.js');
          return await onQuotaExceeded(() => idbPut(storeName, value));
        } catch (e) {
          console.warn(`[storage] put retry after eviction failed for ${storeName}:`, e);
          throw error;
        }
      }
      throw error;
    }
  }
  return ls.put(storeName, value);
}

export async function deleteEntry(storeName, key) {
  if (hasIndexedDB) return idbDelete(storeName, key);
  return ls.delete(storeName, key);
}

export async function getAll(storeName) {
  if (hasIndexedDB) return idbGetAll(storeName);
  return ls.getAll(storeName);
}

export async function clear(storeName) {
  if (hasIndexedDB) return idbClear(storeName);
  return ls.clear(storeName);
}
