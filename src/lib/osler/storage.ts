/**
 * Osler storage — progress tracking + sessions + highlights + sticky notes.
 * Powered by IndexedDB for robust, large-capacity local persistence.
 */

import type { EngineType } from "./types";

const DB_NAME = "osler-db-v1";
const DB_VERSION = 1;

/* ── IndexedDB helpers ──────────────────────────────────────────────── */

let dbInstance: IDBDatabase | null = null;
let dbReady: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbReady) return dbReady;

  dbReady = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("IndexedDB not available in SSR"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("progress")) {
        db.createObjectStore("progress", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("highlights")) {
        db.createObjectStore("highlights", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("articleHighlights")) {
        db.createObjectStore("articleHighlights", { keyPath: "articleId" });
      }
      if (!db.objectStoreNames.contains("stickyNotes")) {
        db.createObjectStore("stickyNotes", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("writtenDrafts")) {
        db.createObjectStore("writtenDrafts", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("flashcardReviews")) {
        db.createObjectStore("flashcardReviews", { keyPath: "key" });
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };

    req.onerror = () => reject(req.error);
  });

  return dbReady;
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => {
      resolve(req.result?.value ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => {
      resolve(req.result ?? []);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbPutBatch(storeName: string, entries: Array<{ key: string; value: unknown }>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const entry of entries) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ── In-memory cache for synchronous reads (hydration from IDB) ─────── */

const memoryCache = new Map<string, unknown>();
let cacheHydrated = false;

async function hydrateCache(): Promise<void> {
  if (cacheHydrated) return;
  try {
    const db = await openDB();
    const storeNames = Array.from(db.objectStoreNames);
    const tx = db.transaction(storeNames, "readonly");
    for (const name of storeNames) {
      const store = tx.objectStore(name);
      const req = store.getAll();
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
          for (const item of req.result ?? []) {
            if (item.key && item.value !== undefined) {
              memoryCache.set(`${name}:${item.key}`, item.value);
            }
          }
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    }
    cacheHydrated = true;
  } catch (e) {
    console.warn("Failed to hydrate IndexedDB cache:", e);
  }
}

// Start hydrating immediately
if (typeof window !== "undefined") {
  hydrateCache().catch(() => {});
}

function getCached<T>(storeName: string, key: string): T | null {
  return (memoryCache.get(`${storeName}:${key}`) as T) ?? null;
}

function setCached(storeName: string, key: string, value: unknown): void {
  memoryCache.set(`${storeName}:${key}`, value);
}

function deleteCached(storeName: string, key: string): void {
  memoryCache.delete(`${storeName}:${key}`);
}

function clearCached(storeName: string): void {
  // Delete all keys that start with storeName:
  for (const k of memoryCache.keys()) {
    if (k.startsWith(`${storeName}:`)) memoryCache.delete(k);
  }
}

/* ── Event dispatching (same as before for reactivity) ─────────────── */

function dispatchChange(event: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(event));
}

/* ── Types ──────────────────────────────────────────────────────────── */

export interface QuestionRecord {
  uid: string;
  qid: string;
  engine: EngineType;
  selected?: number;
  correct: boolean;
  flagged: boolean;
  timestamp: number;
}

export interface PackProgress {
  uid: string;
  attempted: number;
  correct: number;
  wrong: number;
  flagged: number;
  lastAttempt: number | null;
}

export interface HighlightItem {
  id: string;
  color: string;
  text: string;
  target: string;
  ranges?: { start: number; end: number }[];
  createdAt?: string;
}

export interface StickyNoteData {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface WrittenEvaluation {
  score: number | null;
  passed: boolean;
  strengths: string[];
  gaps: string[];
  feedback: string;
  source: string;
  manualVerdict?: "pass" | "fail" | null;
}

export interface WrittenDraft {
  text: string;
  rubricChecked: boolean[];
  submitted: boolean;
  evaluation?: WrittenEvaluation | null;
  childAnswers?: string[];
  childEvaluations?: (WrittenEvaluation | null)[];
}

export interface SavedSession {
  id: string;
  packUid: string;
  packTitle: string;
  engine: EngineType;
  mode: "tutor" | "timed";
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  flaggedCount: number;
  startedAt: number;
  completedAt?: number;
  answers: Record<number, number>;
  revealed: Record<number, boolean>;
  flagged: Record<number, boolean>;
  current: number;
  examTimeRemaining: number;
  writtenDrafts?: Record<string, WrittenDraft>;
  rubricState?: Record<string, boolean[]>;
  ratings?: Record<string, "easy" | "hard" | "unknown">;
}

/* ── Progress (question-level) ──────────────────────────────────────── */

export const storage = {
  recordAnswer(
    uid: string,
    qid: string,
    engine: EngineType,
    selected: number | undefined,
    correct: boolean,
    flagged: boolean
  ) {
    const key = `${uid}:${qid}`;
    const record: QuestionRecord = {
      uid, qid, engine, selected, correct, flagged, timestamp: Date.now(),
    };
    setCached("progress", key, record);
    idbPut("progress", key, record).catch(console.warn);
    dispatchChange("osler-progress-changed");
  },

  getRecord(uid: string, qid: string): QuestionRecord | null {
    return getCached<QuestionRecord>("progress", `${uid}:${qid}`);
  },

  async clearPack(uid: string) {
    // Gather all keys for this pack from cache
    const keysToDelete: string[] = [];
    for (const [k] of memoryCache) {
      if (k.startsWith(`progress:${uid}:`)) {
        keysToDelete.push(k.replace("progress:", ""));
        memoryCache.delete(k);
      }
    }
    for (const key of keysToDelete) {
      await idbDelete("progress", key).catch(console.warn);
    }
    dispatchChange("osler-progress-changed");
  },

  async clearAll() {
    clearCached("progress");
    await idbClear("progress").catch(console.warn);
    dispatchChange("osler-progress-changed");
  },

  packProgress(uid: string): PackProgress {
    const records: QuestionRecord[] = [];
    for (const [k, v] of memoryCache) {
      if (k.startsWith("progress:") && (v as QuestionRecord).uid === uid) {
        records.push(v as QuestionRecord);
      }
    }
    return {
      uid,
      attempted: records.length,
      correct: records.filter((r) => r.correct).length,
      wrong: records.filter((r) => !r.correct).length,
      flagged: records.filter((r) => r.flagged).length,
      lastAttempt: records.length
        ? Math.max(...records.map((r) => r.timestamp))
        : null,
    };
  },

  allProgress(): PackProgress[] {
    const byUid = new Map<string, QuestionRecord[]>();
    for (const [k, v] of memoryCache) {
      if (k.startsWith("progress:")) {
        const r = v as QuestionRecord;
        const list = byUid.get(r.uid) ?? [];
        list.push(r);
        byUid.set(r.uid, list);
      }
    }
    return Array.from(byUid.entries()).map(([uid, records]) => ({
      uid,
      attempted: records.length,
      correct: records.filter((r) => r.correct).length,
      wrong: records.filter((r) => !r.correct).length,
      flagged: records.filter((r) => r.flagged).length,
      lastAttempt: Math.max(...records.map((r) => r.timestamp)),
    }));
  },

  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const handler = () => cb();
    window.addEventListener("osler-progress-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("osler-progress-changed", handler);
      window.removeEventListener("storage", handler);
    };
  },
};

/* ── Saved Sessions ─────────────────────────────────────────────────── */

function sessionKey(id: string): string {
  return `session:${id}`;
}

export const sessions = {
  list(): SavedSession[] {
    const sessions: SavedSession[] = [];
    for (const [k, v] of memoryCache) {
      if (k.startsWith("sessions:session:")) {
        sessions.push(v as SavedSession);
      }
    }
    return sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  },

  save(session: SavedSession) {
    const key = sessionKey(session.id);
    setCached("sessions", key, session);
    idbPut("sessions", key, session).catch(console.warn);
    dispatchChange("osler-sessions-changed");
  },

  delete(id: string) {
    const key = sessionKey(id);
    deleteCached("sessions", key);
    idbDelete("sessions", key).catch(console.warn);
    dispatchChange("osler-sessions-changed");
  },

  get(id: string): SavedSession | null {
    return getCached<SavedSession>("sessions", sessionKey(id));
  },

  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const handler = () => cb();
    window.addEventListener("osler-sessions-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("osler-sessions-changed", handler);
      window.removeEventListener("storage", handler);
    };
  },
};

/* ── Highlights (per question in a pack) ────────────────────────────── */

function highlightsKey(packUid: string, questionIdx?: number): string {
  return questionIdx !== undefined
    ? `${packUid}:${questionIdx}`
    : packUid;
}

export const highlights = {
  get(packUid: string, questionIdx: number): HighlightItem[] {
    const key = highlightsKey(packUid, questionIdx);
    return getCached<HighlightItem[]>("highlights", key) ?? [];
  },

  getAll(packUid: string): Record<number, HighlightItem[]> {
    const result: Record<number, HighlightItem[]> = {};
    const prefix = `highlights:${packUid}:`;
    for (const [k, v] of memoryCache) {
      if (k.startsWith(prefix)) {
        const idx = parseInt(k.replace(prefix, ""), 10);
        if (!isNaN(idx)) result[idx] = v as HighlightItem[];
      }
    }
    return result;
  },

  add(packUid: string, questionIdx: number, item: HighlightItem) {
    const existing = highlights.get(packUid, questionIdx);
    const updated = [...existing, item];
    const key = highlightsKey(packUid, questionIdx);
    setCached("highlights", key, updated);
    idbPut("highlights", key, updated).catch(console.warn);
  },

  remove(packUid: string, questionIdx: number, id: string) {
    const existing = highlights.get(packUid, questionIdx);
    const updated = existing.filter((h) => h.id !== id);
    const key = highlightsKey(packUid, questionIdx);
    setCached("highlights", key, updated);
    idbPut("highlights", key, updated).catch(console.warn);
  },

  clear(packUid: string, questionIdx: number) {
    const key = highlightsKey(packUid, questionIdx);
    deleteCached("highlights", key);
    idbDelete("highlights", key).catch(console.warn);
  },

  clearAll(packUid: string) {
    const prefix = `highlights:${packUid}:`;
    const keys: string[] = [];
    for (const [k] of memoryCache) {
      if (k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) {
      const rawKey = k.replace("highlights:", "");
      memoryCache.delete(k);
      idbDelete("highlights", rawKey).catch(console.warn);
    }
  },
};

/* ── Article Highlights ─────────────────────────────────────────────── */

export const articleHighlights = {
  get(articleId: string): HighlightItem[] {
    return getCached<HighlightItem[]>("articleHighlights", articleId) ?? [];
  },

  save(articleId: string, items: HighlightItem[]) {
    setCached("articleHighlights", articleId, items);
    idbPut("articleHighlights", articleId, items).catch(console.warn);
  },

  clear(articleId: string) {
    deleteCached("articleHighlights", articleId);
    idbDelete("articleHighlights", articleId).catch(console.warn);
  },
};

/* ── Sticky Notes (per question in a pack) ──────────────────────────── */

function stickyNotesKey(packUid: string, questionIdx?: number): string {
  return questionIdx !== undefined
    ? `${packUid}:${questionIdx}`
    : packUid;
}

export const stickyNotes = {
  get(packUid: string, questionIdx: number): StickyNoteData[] {
    const key = stickyNotesKey(packUid, questionIdx);
    return getCached<StickyNoteData[]>("stickyNotes", key) ?? [];
  },

  add(packUid: string, questionIdx: number, note: StickyNoteData) {
    const existing = stickyNotes.get(packUid, questionIdx);
    const updated = [...existing, note];
    const key = stickyNotesKey(packUid, questionIdx);
    setCached("stickyNotes", key, updated);
    idbPut("stickyNotes", key, updated).catch(console.warn);
  },

  update(packUid: string, questionIdx: number, id: string, text: string) {
    const existing = stickyNotes.get(packUid, questionIdx);
    const note = existing.find((n) => n.id === id);
    if (note) {
      note.text = text;
      const key = stickyNotesKey(packUid, questionIdx);
      setCached("stickyNotes", key, existing);
      idbPut("stickyNotes", key, existing).catch(console.warn);
    }
  },

  move(packUid: string, questionIdx: number, id: string, x: number, y: number) {
    const existing = stickyNotes.get(packUid, questionIdx);
    const note = existing.find((n) => n.id === id);
    if (note) {
      note.x = x;
      note.y = y;
      const key = stickyNotesKey(packUid, questionIdx);
      setCached("stickyNotes", key, existing);
      idbPut("stickyNotes", key, existing).catch(console.warn);
    }
  },

  delete(packUid: string, questionIdx: number, id: string) {
    const existing = stickyNotes.get(packUid, questionIdx);
    const updated = existing.filter((n) => n.id !== id);
    const key = stickyNotesKey(packUid, questionIdx);
    setCached("stickyNotes", key, updated);
    idbPut("stickyNotes", key, updated).catch(console.warn);
  },

  clearAll(packUid: string) {
    const prefix = `stickyNotes:${packUid}:`;
    const keys: string[] = [];
    for (const [k] of memoryCache) {
      if (k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) {
      const rawKey = k.replace("stickyNotes:", "");
      memoryCache.delete(k);
      idbDelete("stickyNotes", rawKey).catch(console.warn);
    }
  },
};

/* ── Written Drafts (per pack) ──────────────────────────────────────── */

function writtenDraftsKey(packUid: string): string {
  return packUid;
}

export const writtenDrafts = {
  get(packUid: string): Record<string, WrittenDraft> {
    return getCached<Record<string, WrittenDraft>>("writtenDrafts", writtenDraftsKey(packUid)) ?? {};
  },

  save(packUid: string, drafts: Record<string, WrittenDraft>) {
    const key = writtenDraftsKey(packUid);
    setCached("writtenDrafts", key, drafts);
    idbPut("writtenDrafts", key, drafts).catch(console.warn);
  },

  clear(packUid: string) {
    const key = writtenDraftsKey(packUid);
    deleteCached("writtenDrafts", key);
    idbDelete("writtenDrafts", key).catch(console.warn);
  },
};

/* ── Flashcard Review Data (spaced repetition) ──────────────────────── */

export interface FlashcardReviewRecord {
  ease: number;
  interval: number;
  dueDate: number;
  lastReviewed: number;
  reviewCount: number;
  correctCount: number;
}

function flashcardKey(deckUid: string, cardId: string): string {
  return `${deckUid}:${cardId}`;
}

export const flashcardReview = {
  get(cardId: string): FlashcardReviewRecord | null {
    // Search through cache for this cardId
    for (const [k, v] of memoryCache) {
      if (k.startsWith("flashcardReviews:") && k.endsWith(`:${cardId}`)) {
        return v as FlashcardReviewRecord;
      }
    }
    return null;
  },

  getAll(): Record<string, FlashcardReviewRecord> {
    const result: Record<string, FlashcardReviewRecord> = {};
    for (const [k, v] of memoryCache) {
      if (k.startsWith("flashcardReviews:")) {
        const rawKey = k.replace("flashcardReviews:", "");
        result[rawKey] = v as FlashcardReviewRecord;
      }
    }
    return result;
  },

  getCardsDue(deckUid: string, cardIds: string[]): string[] {
    const reviews = flashcardReview.getAll();
    const now = Date.now();
    return cardIds.filter((id) => {
      const key = flashcardKey(deckUid, id);
      const r = reviews[key];
      return !r || r.dueDate <= now;
    });
  },

  recordReview(
    deckUid: string,
    cardId: string,
    rating: "again" | "hard" | "good" | "easy",
  ) {
    const key = flashcardKey(deckUid, cardId);
    const reviews = flashcardReview.getAll();
    const prev = reviews[key];

    const now = Date.now();
    const msPerDay = 86400000;

    let ease = prev?.ease ?? 2.5;
    let interval = prev?.interval ?? 0;

    switch (rating) {
      case "again":
        ease = Math.max(1.3, ease - 0.2);
        interval = 1;
        break;
      case "hard":
        ease = Math.max(1.3, ease - 0.15);
        interval = Math.max(1, Math.round(interval * 1.2));
        break;
      case "good":
        interval = interval === 0 ? 1 : Math.round(interval * ease);
        break;
      case "easy":
        ease += 0.15;
        interval = interval === 0 ? 2 : Math.round(interval * ease * 1.3);
        break;
    }

    const record: FlashcardReviewRecord = {
      ease: Math.round(ease * 100) / 100,
      interval,
      dueDate: now + interval * msPerDay,
      lastReviewed: now,
      reviewCount: (prev?.reviewCount ?? 0) + 1,
      correctCount: rating === "good" || rating === "easy"
        ? (prev?.correctCount ?? 0) + 1
        : (prev?.correctCount ?? 0),
    };

    setCached("flashcardReviews", key, record);
    idbPut("flashcardReviews", key, record).catch(console.warn);
    dispatchChange("osler-flashcard-changed");
  },

  clearDeck(deckUid: string, cardIds: string[]) {
    for (const id of cardIds) {
      const key = flashcardKey(deckUid, id);
      deleteCached("flashcardReviews", key);
      idbDelete("flashcardReviews", key).catch(console.warn);
    }
    dispatchChange("osler-flashcard-changed");
  },

  async clearAll() {
    clearCached("flashcardReviews");
    await idbClear("flashcardReviews").catch(console.warn);
    dispatchChange("osler-flashcard-changed");
  },

  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const handler = () => cb();
    window.addEventListener("osler-flashcard-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("osler-flashcard-changed", handler);
      window.removeEventListener("storage", handler);
    };
  },
};

/* ── Migration from localStorage ─────────────────────────────────────── */

async function migrateFromLocalStorage() {
  if (typeof window === "undefined") return;

  const migrated = "osler-idb-migrated-v1";
  if (localStorage.getItem(migrated)) return;

  try {
    // Progress
    const progressRaw = localStorage.getItem("osler-progress-v1");
    if (progressRaw) {
      const db = JSON.parse(progressRaw) as { records: Record<string, QuestionRecord> };
      const entries = Object.entries(db.records).map(([key, value]) => ({
        key, value,
      }));
      if (entries.length > 0) {
        await idbPutBatch("progress", entries);
        for (const [key, value] of Object.entries(db.records)) {
          setCached("progress", key, value);
        }
      }
    }

    // Sessions
    const sessionsRaw = localStorage.getItem("osler-qbank-sessions-v1");
    if (sessionsRaw) {
      const list = JSON.parse(sessionsRaw) as SavedSession[];
      const entries = list.map((s) => ({ key: sessionKey(s.id), value: s }));
      if (entries.length > 0) {
        await idbPutBatch("sessions", entries);
        for (const entry of entries) {
          setCached("sessions", entry.key, entry.value);
        }
      }
    }

    // Flashcard reviews
    const flashRaw = localStorage.getItem("osler-flashcard-review-v1");
    if (flashRaw) {
      const reviews = JSON.parse(flashRaw) as Record<string, FlashcardReviewRecord>;
      const entries = Object.entries(reviews).map(([key, value]) => ({
        key, value,
      }));
      if (entries.length > 0) {
        await idbPutBatch("flashcardReviews", entries);
        for (const [key, value] of Object.entries(reviews)) {
          setCached("flashcardReviews", key, value);
        }
      }
    }

    // Article highlights
    const artHlRaw = localStorage.getItem("osler-article-highlights-v1");
    if (artHlRaw) {
      const data = JSON.parse(artHlRaw) as Record<string, HighlightItem[]>;
      const entries = Object.entries(data).map(([articleId, items]) => ({
        key: articleId, value: items,
      }));
      if (entries.length > 0) {
        await idbPutBatch("articleHighlights", entries);
        for (const entry of entries) {
          setCached("articleHighlights", entry.key, entry.value);
        }
      }
    }

    localStorage.setItem(migrated, "true");
  } catch (e) {
    console.warn("Failed to migrate from localStorage:", e);
  }
}

// Run migration on load
if (typeof window !== "undefined") {
  openDB().then(() => {
    migrateFromLocalStorage().catch(console.warn);
  }).catch(console.warn);
}
