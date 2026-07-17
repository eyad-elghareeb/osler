/**
 * Osler storage — progress tracking + sessions + highlights + notes + quiz settings.
 * Powered by IndexedDB for robust, large-capacity local persistence.
 */

import type { EngineType } from "./types";

const DB_NAME = "osler-db-v1";
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      // v2: notes store — markdown notes with optional pack/question context.
      if (!db.objectStoreNames.contains("notes")) {
        const notesStore = db.createObjectStore("notes", { keyPath: "id" });
        notesStore.createIndex("byUpdatedAt", "updatedAt");
        notesStore.createIndex("byPack", "packUid");
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
  /**
   * Soft-dismissed flag — set to true when a question was answered correctly
   * during a "remove on correct" review session. Records are never deleted,
   * only marked dismissed, so the Tracker can reveal them again via a
   * "show dismissed" toggle.
   */
  dismissed?: boolean;
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
  /**
   * Ordered list of {id, sourceUid} pairs parallel to the session's
   * questions array — lets a saved session be reopened in review mode
   * without needing to keep the full SessionQuestion[] in storage.
   * Optional for backward compat with sessions saved before this field
   * existed.
   */
  questionRefs?: Array<{ id: string; sourceUid: string }>;
  /** All pack uids included in this session (deduped). */
  sources?: string[];
  /** Tag filters that were active when the session was built. */
  tagsFilter?: string[];
  /** Progress-mode filter that was active when the session was built. */
  onlyMode?: "all" | "wrong" | "flagged" | "new";
}

/* ── Progress (question-level) ──────────────────────────────────────── */

export const storage = {
  recordAnswer(
    uid: string,
    qid: string,
    engine: EngineType,
    selected: number | undefined,
    correct: boolean,
    flagged: boolean,
    dismissed?: boolean
  ) {
    const key = `${uid}:${qid}`;
    // Preserve existing dismissed flag if caller doesn't explicitly pass one
    // (so a wrong answer during a "remove on correct" review doesn't accidentally
    // re-show a previously dismissed question).
    const existing = getCached<QuestionRecord>("progress", key);
    const finalDismissed = dismissed ?? existing?.dismissed ?? false;
    const record: QuestionRecord = {
      uid, qid, engine, selected, correct, flagged,
      dismissed: finalDismissed,
      timestamp: Date.now(),
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

  /**
   * Return all progress records whose uid is in the given list.
   * Filters the in-memory cache once per call — much cheaper than
   * calling `getRecord` per question when scanning many packs.
   */
  recordsForUids(uids: string[]): QuestionRecord[] {
    const set = new Set(uids);
    const out: QuestionRecord[] = [];
    for (const [k, v] of memoryCache) {
      if (!k.startsWith("progress:")) continue;
      const r = v as QuestionRecord;
      if (set.has(r.uid)) out.push(r);
    }
    return out;
  },

  /**
   * Return all progress records (across the given uids, or all if omitted)
   * that are either incorrect or flagged — i.e. the questions the user
   * wants to revisit. Dismissed records are excluded by default.
   */
  wrongOrFlagged(uids?: string[]): QuestionRecord[] {
    const set = uids ? new Set(uids) : null;
    const out: QuestionRecord[] = [];
    for (const [k, v] of memoryCache) {
      if (!k.startsWith("progress:")) continue;
      const r = v as QuestionRecord;
      if (set && !set.has(r.uid)) continue;
      if (r.dismissed) continue;
      if (!r.correct || r.flagged) out.push(r);
    }
    return out;
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

  /* ── Bulk export/import (for sync/backup) ─────────────────────────── */

  async ensureCacheHydrated(): Promise<void> {
    await hydrateCache();
  },

  exportProgressRecords(): Record<string, QuestionRecord> {
    const result: Record<string, QuestionRecord> = {};
    for (const [k, v] of memoryCache) {
      if (k.startsWith("progress:")) {
        const record = v as QuestionRecord;
        result[`${record.uid}:${record.qid}`] = record;
      }
    }
    return result;
  },

  async importData(data: Record<string, unknown>): Promise<void> {
    // 1. Progress — individual question records
    const rawProgress = data["osler_raw_progress"] as Record<string, QuestionRecord> | undefined;
    if (rawProgress && typeof rawProgress === "object") {
      const entries = Object.entries(rawProgress)
        .filter(([, v]) => v && typeof v === "object" && "uid" in v && "qid" in v)
        .map(([key, value]) => ({ key, value }));
      if (entries.length > 0) {
        await idbPutBatch("progress", entries);
        for (const e of entries) {
          setCached("progress", e.key, e.value);
        }
        dispatchChange("osler-progress-changed");
      }
    }

    // 2. Sessions
    const sessionEntries = Object.entries(data)
      .filter(([key]) => key.startsWith("osler_sessions_"))
      .map(([, value]) => value as SavedSession)
      .filter((s): s is SavedSession => !!s && typeof s === "object" && "id" in s);
    if (sessionEntries.length > 0) {
      for (const session of sessionEntries) {
        const key = `session:${session.id}`;
        setCached("sessions", key, session);
      }
      await idbPutBatch(
        "sessions",
        sessionEntries.map((s) => ({ key: `session:${s.id}`, value: s })),
      );
      dispatchChange("osler-sessions-changed");
    }

    // 3. Flashcard reviews
    const flashcards = data["osler_flashcard_reviews"] as Record<string, FlashcardReviewRecord> | undefined;
    if (flashcards && typeof flashcards === "object") {
      const entries = Object.entries(flashcards)
        .filter(([, v]) => v && typeof v === "object" && "dueDate" in v)
        .map(([key, value]) => ({ key, value }));
      if (entries.length > 0) {
        await idbPutBatch("flashcardReviews", entries);
        for (const e of entries) {
          setCached("flashcardReviews", e.key, e.value);
        }
        dispatchChange("osler-flashcard-changed");
      }
    }

    // 4. Notes
    const notesArr = data["osler_notes"] as NoteRecord[] | undefined;
    if (Array.isArray(notesArr) && notesArr.length > 0) {
      for (const note of notesArr) {
        if (note && typeof note === "object" && note.id) {
          await idbPutNote(note);
        }
      }
      notesCache = await idbGetAllNotes();
      notifyNotesChanged();
    }
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

/* ── Settings (simple key/value, e.g. "dismiss-pwa-hint") ────────────── */

export const settings = {
  async get(key: string): Promise<string | null> {
    return idbGet<string>("settings", key);
  },

  async set(key: string, value: string): Promise<void> {
    setCached("settings", key, value);
    await idbPut("settings", key, value);
  },

  async getBool(key: string): Promise<boolean> {
    const val = await settings.get(key);
    return val === "true";
  },
};

/* ── Notes (markdown, IndexedDB-backed) ─────────────────────────────── */

export interface NoteRecord {
  id: string;
  title: string;
  body: string; // markdown source
  tags: string[];
  packUid?: string;     // optional: which content pack this note belongs to
  packTitle?: string;
  questionIdx?: number; // optional: which question in the pack
  createdAt: number;
  updatedAt: number;
}

async function idbGetAllNotes(): Promise<NoteRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readonly");
    const store = tx.objectStore("notes");
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result ?? []) as NoteRecord[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutNote(note: NoteRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    const store = tx.objectStore("notes");
    store.put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDeleteNote(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    const store = tx.objectStore("notes");
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// In-memory cache for synchronous reads
let notesCache: NoteRecord[] | null = null;
const notesSubscribers = new Set<() => void>();

function notifyNotesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("osler-notes-changed"));
  notesSubscribers.forEach((cb) => {
    try { cb(); } catch (e) { console.warn(e); }
  });
}

async function ensureNotesCache(): Promise<NoteRecord[]> {
  if (notesCache) return notesCache;
  notesCache = await idbGetAllNotes();
  return notesCache;
}

// Start hydrating immediately
if (typeof window !== "undefined") {
  ensureNotesCache().catch(console.warn);
}

export const notes = {
  async list(): Promise<NoteRecord[]> {
    const cached = await ensureNotesCache();
    return [...cached].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  listSync(): NoteRecord[] {
    return notesCache ? [...notesCache].sort((a, b) => b.updatedAt - a.updatedAt) : [];
  },

  async get(id: string): Promise<NoteRecord | null> {
    const cached = await ensureNotesCache();
    return cached.find((n) => n.id === id) ?? null;
  },

  async listByPack(packUid: string): Promise<NoteRecord[]> {
    const cached = await ensureNotesCache();
    return cached
      .filter((n) => n.packUid === packUid)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async save(note: NoteRecord): Promise<NoteRecord> {
    const existing = notesCache?.find((n) => n.id === note.id);
    const next: NoteRecord = {
      ...note,
      createdAt: existing?.createdAt ?? note.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await idbPutNote(next);
    if (notesCache) {
      const idx = notesCache.findIndex((n) => n.id === next.id);
      if (idx >= 0) notesCache[idx] = next;
      else notesCache.push(next);
    } else {
      notesCache = [next];
    }
    notifyNotesChanged();
    return next;
  },

  async delete(id: string): Promise<void> {
    await idbDeleteNote(id);
    if (notesCache) {
      notesCache = notesCache.filter((n) => n.id !== id);
    }
    notifyNotesChanged();
  },

  async create(partial: Partial<NoteRecord> = {}): Promise<NoteRecord> {
    const now = Date.now();
    const note: NoteRecord = {
      id: partial.id ?? crypto.randomUUID(),
      title: partial.title ?? "Untitled note",
      body: partial.body ?? "",
      tags: partial.tags ?? [],
      packUid: partial.packUid,
      packTitle: partial.packTitle,
      questionIdx: partial.questionIdx,
      createdAt: now,
      updatedAt: now,
    };
    return notes.save(note);
  },

  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    notesSubscribers.add(cb);
    const handler = () => cb();
    window.addEventListener("osler-notes-changed", handler);
    return () => {
      notesSubscribers.delete(cb);
      window.removeEventListener("osler-notes-changed", handler);
    };
  },
};

/* ── Quiz Settings (persisted user prefs for QBank view) ─────────────── */

export type QuestionAlign = "left" | "center" | "right";
export type ExplanationMode = "split" | "continuous"; // split = 2-page, continuous = single scroll

export interface QuizSettings {
  fontFamily: "system" | "serif" | "sans" | "mono";
  fontSize: number;
  fontWeight: number; // 400 | 500 | 600 | 700
  lineHeight: number;
  textAffectsChoices: boolean;
  autoSubmit: boolean;       // tutor mode: auto-reveal on choice select
  explanationMode: ExplanationMode;
  questionAlign: QuestionAlign;
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  fontFamily: "system",
  fontSize: 15,
  fontWeight: 400,
  lineHeight: 1.7,
  textAffectsChoices: true,
  autoSubmit: false,
  explanationMode: "split",
  questionAlign: "left",
};

function getDefaultQuestionAlign(): QuestionAlign {
  if (typeof window !== "undefined") {
    try {
      const uiLang = localStorage.getItem("osler-ui-lang");
      if (uiLang === "ar") return "right";
    } catch {}
  }
  return "left";
}

const QUIZ_SETTINGS_KEY = "quiz-settings-v1";
const QUIZ_SETTINGS_EVENT = "osler-quiz-settings-changed";
const quizSettingsSubscribers = new Set<() => void>();

let cachedQuizSettings: QuizSettings | null = null;
let quizSettingsHydrated = false;

async function hydrateQuizSettings(): Promise<void> {
  if (quizSettingsHydrated) return;
  quizSettingsHydrated = true;
  try {
    const raw = await idbGet<QuizSettings>("settings", QUIZ_SETTINGS_KEY);
    cachedQuizSettings = raw
      ? { ...DEFAULT_QUIZ_SETTINGS, ...raw }
      : { ...DEFAULT_QUIZ_SETTINGS, questionAlign: getDefaultQuestionAlign() };
    // Fix any invalid weight values from older saves
    const validWeights = [400, 500, 600, 700];
    if (!validWeights.includes(cachedQuizSettings.fontWeight)) {
      cachedQuizSettings.fontWeight = 400;
    }
  } catch (e) {
    console.warn("Failed to hydrate quiz settings:", e);
    cachedQuizSettings = { ...DEFAULT_QUIZ_SETTINGS, questionAlign: getDefaultQuestionAlign() };
  }
}

if (typeof window !== "undefined") {
  hydrateQuizSettings().catch(console.warn);
}

export const quizSettings = {
  getSync(): QuizSettings {
    if (!cachedQuizSettings) return { ...DEFAULT_QUIZ_SETTINGS, questionAlign: getDefaultQuestionAlign() };
    return { ...cachedQuizSettings };
  },

  async get(): Promise<QuizSettings> {
    await hydrateQuizSettings();
    return quizSettings.getSync();
  },

  async save(patch: Partial<QuizSettings>): Promise<QuizSettings> {
    await hydrateQuizSettings();
    const next: QuizSettings = {
      ...(cachedQuizSettings ?? { ...DEFAULT_QUIZ_SETTINGS, questionAlign: getDefaultQuestionAlign() }),
      ...patch,
    };
    cachedQuizSettings = next;
    setCached("settings", QUIZ_SETTINGS_KEY, next);
    await idbPut("settings", QUIZ_SETTINGS_KEY, next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(QUIZ_SETTINGS_EVENT));
      quizSettingsSubscribers.forEach((cb) => {
        try { cb(); } catch (e) { console.warn(e); }
      });
    }
    return next;
  },

  async reset(): Promise<QuizSettings> {
    return quizSettings.save({ ...DEFAULT_QUIZ_SETTINGS, questionAlign: getDefaultQuestionAlign() });
  },

  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    quizSettingsSubscribers.add(cb);
    const handler = () => cb();
    window.addEventListener(QUIZ_SETTINGS_EVENT, handler);
    return () => {
      quizSettingsSubscribers.delete(cb);
      window.removeEventListener(QUIZ_SETTINGS_EVENT, handler);
    };
  },
};

// Run migration on load
if (typeof window !== "undefined") {
  openDB().then(() => {
    migrateFromLocalStorage().catch(console.warn);
  }).catch(console.warn);
}
