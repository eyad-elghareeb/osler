const DB_NAME = 'osler-v1';
const DB_VERSION = 1;

const STORES = [
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

function idbOperation(storeName, mode, callback) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = callback(store);
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(new Error(`IndexedDB error: ${tx.error?.message}`)); };
    });
  });
}

async function idbGet(storeName, key) {
  return idbOperation(storeName, 'readonly', (store) => {
    const req = store.get(key);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(new Error(`get failed: ${req.error?.message}`));
    });
  });
}

async function idbPut(storeName, value) {
  return idbOperation(storeName, 'readwrite', (store) => {
    const req = store.put(value);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`put failed: ${req.error?.message}`));
    });
  });
}

async function idbDelete(storeName, key) {
  return idbOperation(storeName, 'readwrite', (store) => {
    const req = store.delete(key);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`delete failed: ${req.error?.message}`));
    });
  });
}

async function idbGetAll(storeName) {
  return idbOperation(storeName, 'readonly', (store) => {
    const req = store.getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`getAll failed: ${req.error?.message}`));
    });
  });
}

async function idbClear(storeName) {
  return idbOperation(storeName, 'readwrite', (store) => {
    const req = store.clear();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`clear failed: ${req.error?.message}`));
    });
  });
}

export async function evictFromStore(storeName, filterFn) {
  if (hasIndexedDB) {
    return idbEvict(storeName, filterFn);
  }
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
        } catch {}
      }
    }
    keysToRemove.forEach(k => { localStorage.removeItem(k); deleted++; });
  } catch {}
  return Promise.resolve(deleted);
}

const ls = {
  get(storeName, key) {
    try {
      const k = `${storeName}_${Array.isArray(key) ? key.join('_') : key}`;
      const raw = localStorage.getItem(k);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch { return Promise.resolve(null); }
  },
  put(storeName, value) {
    try {
      const k = `${storeName}_${Array.isArray(value?.contentUid) ? value.contentUid.join('_') : (value?.uid || value?.key || value?.contentUid || Math.random().toString(36))}`;
      localStorage.setItem(k, JSON.stringify(value));
      return Promise.resolve();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        return Promise.reject(e);
      }
      return Promise.resolve();
    }
  },
  delete(storeName, key) {
    try {
      const k = `${storeName}_${Array.isArray(key) ? key.join('_') : key}`;
      localStorage.removeItem(k);
      return Promise.resolve();
    } catch { return Promise.resolve(); }
  },
  getAll(storeName) {
    try {
      const prefix = `${storeName}_`;
      const results = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) {
          try { results.push(JSON.parse(localStorage.getItem(k))); } catch {}
        }
      }
      return Promise.resolve(results);
    } catch { return Promise.resolve([]); }
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
    } catch { return Promise.resolve(); }
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
        } catch { throw error; }
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
