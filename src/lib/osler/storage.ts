/**
 * Osler storage — progress tracking + sessions + highlights + notes + quiz settings.
 * Powered by IndexedDB for robust, large-capacity local persistence.
 */

import type { EngineType } from "./types";
import type { AchievementRecord } from "./achievements";

const DB_NAME = "osler-db-v1";
const DB_VERSION = 5;

/** localStorage key holding the bookmark state for library article paths —
 *  `Record<path, { a: addedAt, d?: deletedAt }>` (two-phase LWW set). Each
 *  counter is grow-only, so deletions propagate across sync and a later
 *  re-add (newer `a`) revives the path. Legacy data stored a bare array of
 *  paths (or `path: 1` docs) and migrates lazily on read: `a` starts at 0,
 *  which means a deletion always out-ranks a legacy add. */
export const ARTICLE_BOOKMARKS_KEY = "osler-article-bookmarks";

export interface BookmarkEntry {
  a: number;
  d?: number;
}

/** Reads + migrates the stored bookmark state. */
function readBookmarkState(): Record<string, BookmarkEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ARTICLE_BOOKMARKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Legacy: bare array of live paths.
      return Object.fromEntries(parsed.filter((p) => typeof p === "string").map((p) => [p, { a: 0 }]));
    }
    const out: Record<string, BookmarkEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k !== "string" || !v) continue;
      if (typeof v === "number" || typeof v === "boolean") out[k] = { a: 0 };
      else if (typeof v === "object" && typeof (v as BookmarkEntry).a === "number") {
        out[k] = { a: (v as BookmarkEntry).a, ...((v as BookmarkEntry).d ? { d: (v as BookmarkEntry).d } : {}) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeBookmarkState(state: Record<string, BookmarkEntry>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ARTICLE_BOOKMARKS_KEY, JSON.stringify(state));
  } catch {}
}

/** Live (non-deleted) bookmarked paths — the UI view of the set. */
function liveBookmarkPaths(state: Record<string, BookmarkEntry>): string[] {
  return Object.entries(state)
    .filter(([, e]) => e.a > (e.d ?? 0))
    .map(([p]) => p);
}

export const articleBookmarks = {
  /** Bookmarked paths (tombstoned removals excluded). */
  live(): string[] {
    return liveBookmarkPaths(readBookmarkState());
  },

  /** Toggle a path; persists the LWW counters and reports the new live set. */
  toggle(path: string): string[] {
    const state = readBookmarkState();
    const entry = state[path];
    if (!entry || entry.a <= (entry.d ?? 0)) {
      state[path] = { a: Date.now() };
    } else {
      state[path] = { a: entry.a, d: Date.now() };
    }
    writeBookmarkState(state);
    return liveBookmarkPaths(state);
  },

  /** Max-merge a remote bookmark doc into the local state (used by pulls). */
  merge(state: Record<string, BookmarkEntry>): boolean {
    const local = readBookmarkState();
    let changed = false;
    for (const [path, inc] of Object.entries(state)) {
      if (typeof path !== "string" || !inc || typeof inc !== "object") continue;
      const cur = local[path] ?? { a: 0 };
      const mergedA = Math.max(cur.a ?? 0, Number(inc.a) || 0);
      const mergedD = Math.max(cur.d ?? 0, Number(inc.d) || 0);
      const merged: BookmarkEntry = { a: mergedA, ...(mergedD > 0 ? { d: mergedD } : {}) };
      if (JSON.stringify(local[path]) !== JSON.stringify(merged)) {
        local[path] = merged;
        changed = true;
      }
    }
    if (changed) writeBookmarkState(local);
    return changed;
  },
};

/** Every content kind synced to the cloud, mirroring the worker's SYNC_KINDS.
 *  The GET response also carries a `quota` field, which callers must skip when
 *  iterating kinds. */
export const SYNC_KINDS = [
  "qbank",
  "flashcards",
  "sessions",
  "notes",
  "highlights",
  "articleHighlights",
  "writtenDrafts",
  "bookmarks",
  "achievements",
  "settings",
] as const;

export type SyncKind = (typeof SYNC_KINDS)[number];

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
      // v3: fix sessions store keyPath from "id" to "key" (generic helpers use { key, value } shape)
      if (db.objectStoreNames.contains("sessions")) {
        db.deleteObjectStore("sessions");
      }
      db.createObjectStore("sessions", { keyPath: "key" });
      if (!db.objectStoreNames.contains("highlights")) {
        db.createObjectStore("highlights", { keyPath: "key" });
      }
      // v4: fix articleHighlights store keyPath from "articleId" to "key"
      // (generic helpers store { key, value }; a missing keyPath key throws DataError).
      if (db.objectStoreNames.contains("articleHighlights")) {
        db.deleteObjectStore("articleHighlights");
      }
      db.createObjectStore("articleHighlights", { keyPath: "key" });
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
      // v5: achievements store — persisted unlock records, synced like progress.
      if (!db.objectStoreNames.contains("achievements")) {
        db.createObjectStore("achievements", { keyPath: "key" });
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
  return trackWrite(new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return trackWrite(new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}


/** Imported sync keys (P2P / QR / file) are untrusted. "__proto__" etc. as
 *  data keys would set object prototypes when records are merged into plain
 *  objects later — never let them into IndexedDB. */
function isSafeImportKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

async function idbPutBatch(storeName: string, entries: Array<{ key: string; value: unknown }>): Promise<void> {
  const db = await openDB();
  return trackWrite(new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const entry of entries) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/* ── In-memory cache for synchronous reads (hydration from IDB) ─────── */

const memoryCache = new Map<string, unknown>();
let cacheHydrated = false;

/**
 * Pending IDB write promises. Tracked so we can flush them on page unload,
 * guaranteeing the last in-flight write is durable before the tab closes.
 */
const pendingWrites = new Set<Promise<void>>();

function trackWrite(p: Promise<void>): Promise<void> {
  pendingWrites.add(p);
  p.finally(() => pendingWrites.delete(p)).catch(() => {});
  return p;
}

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
  } finally {
    // Notes have their own cache; mark hydration done regardless of IDB success
    // so synchronous readers can re-render with whatever we have.
    dispatchChange("osler-hydrated");
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

/* ── Merge helpers (shared by cloud snapshot merge) ─────────────────── */

function sessionVersion(s: SavedSession): number {
  return (s?.completedAt ?? s?.startedAt ?? 0) as number;
}

function itemVersion(item: any): number {
  const raw = item?.createdAt ?? item?.updatedAt;
  const n = typeof raw === "number" ? raw : Date.parse(String(raw ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Union of two item lists by id — later version wins, ties go to incoming.
 *  Monotonic (only adds/replaces), so it converges across devices. */
function mergeItemArraysById<T>(current: T[], incoming: T[], version: (item: T) => number): T[] {
  const byId = new Map<string, T>();
  for (const item of current) if (item && typeof item === "object" && "id" in item) byId.set((item as any).id, item);
  for (const item of incoming) {
    if (!item || typeof item !== "object" || !("id" in item)) continue;
    const existing = byId.get((item as any).id);
    if (!existing) byId.set((item as any).id, item);
    else if (version(item) > version(existing)) byId.set((item as any).id, item);
    else if (version(item) === version(existing)) byId.set((item as any).id, item);
  }
  return Array.from(byId.values());
}

/* ── Highlight tombstones (sync deletions) ──────────────────────────── */
/* A deletion is recorded as `{ id, deletedAt, updatedAt }` so the union
 * merges (here and in the worker's sync-docs) rank it above the older live
 * item — otherwise a deleted highlight is resurrected by the next pull.
 * Tombstones must SURVIVE into exports/snapshots; only readers filter them. */

/** Retention window; must stay in sync with TOMBSTONE_TTL_MS in the worker's
 *  sync-docs.ts (pruning is deterministic per replica, so they converge). */
const HIGHLIGHT_TOMBSTONE_TTL_MS = 90 * 86_400_000;

function isLiveHighlight(h: HighlightItem | undefined | null): boolean {
  return !!h && h.deletedAt == null;
}

/** Replacement record for a deleted highlight — content dropped on purpose
 *  (readers filter tombstones out, so color/text are never observed). */
function tombstoneHighlight(id: string): HighlightItem {
  const now = Date.now();
  return { id, deletedAt: now, updatedAt: now } as HighlightItem;
}

/** Drops tombstones past the retention window (deterministic by deletedAt). */
function pruneHighlightTombstones(list: HighlightItem[]): HighlightItem[] {
  const cutoff = Date.now() - HIGHLIGHT_TOMBSTONE_TTL_MS;
  return list.filter((h) => isLiveHighlight(h) || (h.deletedAt ?? 0) > cutoff);
}

/** Deep dict merge (e.g. writtenDrafts: Record<pack, Record<question, draft>>).
 *  Incoming wins per leaf — no timestamps exist on the data. Idempotent. */
function mergeDictDeep(current: Record<string, any>, incoming: Record<string, any>, depth = 0): { records: Record<string, any>; changed: boolean } {
  if (depth > 4) return { records: { ...current, ...incoming }, changed: JSON.stringify(current) !== JSON.stringify({ ...current, ...incoming }) };
  const out: Record<string, any> = { ...current };
  let changed = false;
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      const sub = mergeDictDeep(out[k], v, depth + 1);
      if (sub.changed) { out[k] = sub.records; changed = true; }
    } else if (
      v && typeof v === "object" && !Array.isArray(v) && typeof (v as any).updatedAt === "number" &&
      out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) && typeof (out[k] as any).updatedAt === "number"
    ) {
      // LWW leaves (writtenDrafts): the newer updatedAt wins, so a cleared
      // draft's tombstone out-ranks older live drafts arriving from elsewhere.
      if ((v as any).updatedAt >= (out[k] as any).updatedAt && JSON.stringify(out[k]) !== JSON.stringify(v)) { out[k] = v; changed = true; }
    } else {
      if (JSON.stringify(out[k]) !== JSON.stringify(v)) { out[k] = v; changed = true; }
    }
  }
  return { records: out, changed };
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
  /** Tombstone from a progress reset — union merges rank by `timestamp`, so a
   *  reset out-ranks the older live record on every replica. Readers filter. */
  deletedAt?: number;
  /**
   * Soft-dismissed flag — set to true when a question was answered correctly
   * during a "remove on correct" review session. Records are never deleted,
   * only marked dismissed, so the Tracker can reveal them again via a
   * "show dismissed" toggle.
   */
  dismissed?: boolean;
  /**
   * Total number of times this question was answered (on this device).
   * Accumulated in `recordAnswer`; max-merged across devices on sync.
   */
  attempts?: number;
  /** Total number of times this question was answered correctly. */
  correctCount?: number;
  /**
   * Whether the very first answer was correct. Frozen on the first answer,
   * never overwritten — this is the single source for "first-try accuracy".
   */
  firstAttemptCorrect?: boolean;
  /** Timestamp of the very first answer (used to reconcile across devices). */
  firstAttemptAt?: number;
  /** Duration (ms) of the most recent answer, pause-adjusted. */
  timeMs?: number;
  /** Rolling average duration (ms) across attempts on this device. */
  avgTimeMs?: number;
  /** Topic tags denormalized onto the record at first answer. */
  tags?: string[];
  /** Difficulty denormalized onto the record at first answer. */
  difficulty?: string;
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
  /** Region the highlight was recorded against — QBank scopes per
   *  stem / choice-N / explanation; library highlights use "body". */
  target?: string;
  ranges?: { start: number; end: number }[];
  createdAt?: string;
  /** Tombstone (sync) fields: a deletion is stored as `{ id, deletedAt,
   *  updatedAt }` — content dropped — so the deletion out-ranks the older
   *  live item during union merges on every replica. Tombstones are
   *  invisible to readers (filtered by isLiveHighlight) and pruned past a
   *  retention window. */
  deletedAt?: number;
  updatedAt?: number;
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
  /** LWW stamp for sync (mergeDictDeep ranks leaves by it) and tombstone
   *  marker: a cleared draft is `{ deletedAt, updatedAt }` with content
   *  dropped, so the clearing out-ranks older live drafts elsewhere. */
  updatedAt?: number;
  deletedAt?: number;
}

export interface SavedSession {
  id: string;
  /** Tombstone from sessions.delete — carried so the deletion survives the
   *  per-key union merge (ranked via completedAt). */
  deletedAt?: number;
  packUid: string;
  packTitle: string;
  /** Declared pack language (content direction + PDF export language). */
  packLang?: string;
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
  /** Absolute wall-clock expiry (ms) for timed exams, pause-adjusted, so a resumed session keeps its remaining time. */
  timeEndsAt?: number;
  writtenDrafts?: Record<string, WrittenDraft>;
  rubricState?: Record<string, boolean[]>;
  ratings?: Record<string, "easy" | "hard" | "unknown">;
  /**
   * Per-question duration map (question id → pause-adjusted ms) captured
   * during the live session, so a replayed/completed session can surface
   * pacing without relying on the progress records.
   */
  questionTimes?: Record<string, number>;
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
  /** Session-bound highlights captured per question index. */
  highlights?: Record<number, HighlightItem[]>;
}

/* ── Progress (question-level) ──────────────────────────────────────── */

/**
 * Combine a newer (higher-timestamp) incoming record with the local one
 * without letting either device clobber the other's accumulated counters.
 * The incoming record wins on the stateful fields (correct/selected/times),
 * while attempts/correctCount take the max, first-attempt facts come from
 * whichever record holds the earliest first attempt, and sticky flags
 * (flagged/dismissed) are OR-merged.
 */
function mergeQuestionRecord(
  local: QuestionRecord | null | undefined,
  incoming: QuestionRecord
): QuestionRecord {
  if (!local) return incoming;
  const incomingFirst = incoming.firstAttemptAt ?? Number.POSITIVE_INFINITY;
  const localFirst = local.firstAttemptAt ?? Number.POSITIVE_INFINITY;
  const firstFromIncoming = incomingFirst < localFirst;
  return {
    ...incoming,
    attempts: Math.max(local.attempts ?? 0, incoming.attempts ?? 0),
    correctCount: Math.max(local.correctCount ?? 0, incoming.correctCount ?? 0),
    firstAttemptCorrect: firstFromIncoming
      ? incoming.firstAttemptCorrect ?? local.firstAttemptCorrect
      : local.firstAttemptCorrect ?? incoming.firstAttemptCorrect,
    firstAttemptAt: firstFromIncoming
      ? incoming.firstAttemptAt ?? local.firstAttemptAt
      : local.firstAttemptAt ?? incoming.firstAttemptAt,
    timeMs: incoming.timeMs ?? local.timeMs,
    avgTimeMs: incoming.avgTimeMs ?? local.avgTimeMs,
    tags: incoming.tags ?? local.tags,
    difficulty: incoming.difficulty ?? local.difficulty,
    flagged: local.flagged || incoming.flagged,
    dismissed: incoming.dismissed ?? local.dismissed,
  };
}

export const storage = {
  recordAnswer(
    uid: string,
    qid: string,
    engine: EngineType,
    options: {
      selected?: number;
      correct: boolean;
      flagged?: boolean;
      dismissed?: boolean;
      /** Duration of this answer in ms (pause-adjusted). */
      timeMs?: number;
      /** Topic tags to denormalize onto the record on its first answer. */
      tags?: string[];
      difficulty?: string;
    }
  ) {
    const { selected, correct, flagged = false, dismissed, timeMs, tags, difficulty } = options;
    const key = `${uid}:${qid}`;
    // Preserve existing dismissed flag if caller doesn't explicitly pass one
    // (so a wrong answer during a "remove on correct" review doesn't accidentally
    // re-show a previously dismissed question).
    const existing = getCached<QuestionRecord>("progress", key);
    const finalDismissed = dismissed ?? existing?.dismissed ?? false;

    const prevAttempts = existing?.attempts ?? 0;
    const attempts = prevAttempts + 1;
    const correctCount = (existing?.correctCount ?? 0) + (correct ? 1 : 0);
    const isFirst = prevAttempts === 0;
    const avgTimeMs =
      timeMs != null
        ? Math.round(((existing?.avgTimeMs ?? 0) * prevAttempts + timeMs) / attempts)
        : existing?.avgTimeMs;

    const record: QuestionRecord = {
      uid,
      qid,
      engine,
      selected,
      correct,
      flagged,
      dismissed: finalDismissed,
      timestamp: Date.now(),
      attempts,
      correctCount,
      firstAttemptCorrect: isFirst ? correct : existing?.firstAttemptCorrect,
      firstAttemptAt: existing?.firstAttemptAt ?? Date.now(),
      timeMs,
      avgTimeMs,
      tags: existing?.tags ?? tags,
      difficulty: existing?.difficulty ?? difficulty,
    };
    setCached("progress", key, record);
    idbPut("progress", key, record).catch(console.warn);
    dispatchChange("osler-progress-changed");
  },

  getRecord(uid: string, qid: string): QuestionRecord | null {
    const record = getCached<QuestionRecord>("progress", `${uid}:${qid}`);
    return record?.deletedAt ? null : record;
  },

  async clearPack(uid: string) {
    // Tombstone every record of the pack instead of deleting: the cloud merge
    // is a per-key union ranked by timestamp, so a plain delete would be
    // resurrected by the next pull from a device that still holds the records.
    const now = Date.now();
    for (const [k, v] of memoryCache) {
      if (k.startsWith(`progress:${uid}:`) && !(v as QuestionRecord).deletedAt) {
        const record = { ...(v as QuestionRecord), timestamp: now, deletedAt: now };
        setCached("progress", k.replace("progress:", ""), record);
        idbPut("progress", k.replace("progress:", ""), record).catch(console.warn);
      }
    }
    dispatchChange("osler-progress-changed");
  },

  async clearAll() {
    const now = Date.now();
    for (const [k, v] of memoryCache) {
      if (k.startsWith("progress:") && !(v as QuestionRecord).deletedAt) {
        const record = { ...(v as QuestionRecord), timestamp: now, deletedAt: now };
        setCached("progress", k.replace("progress:", ""), record);
        idbPut("progress", k.replace("progress:", ""), record).catch(console.warn);
      }
    }
    dispatchChange("osler-progress-changed");
  },

  packProgress(uid: string): PackProgress {
    const records: QuestionRecord[] = [];
    for (const [k, v] of memoryCache) {
      if (k.startsWith("progress:") && (v as QuestionRecord).uid === uid && !(v as QuestionRecord).deletedAt) {
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
      if (k.startsWith("progress:") && !(v as QuestionRecord).deletedAt) {
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
   * Return every progress record (across all packs). Used by the metrics
   * engine for cross-content analytics (first-try accuracy, pacing, weakness
   * by topic). Cheap: reads the in-memory cache, which is always hydrated
   * before the app UI renders.
   */
  allRecords(): QuestionRecord[] {
    const out: QuestionRecord[] = [];
    for (const [k, v] of memoryCache) {
      if (!k.startsWith("progress:")) continue;
      out.push(v as QuestionRecord);
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
    // Notes live in a separate cache; await it so exports never read stale [].
    if (typeof window !== "undefined") {
      await ensureNotesCache().catch(() => {});
    }
  },

  /** Resolve once the in-memory cache has been hydrated from IDB. */
  isHydrated(): boolean {
    return cacheHydrated;
  },

  /**
   * Subscribe to the hydration-completion event. Fires immediately (and
   * invokes cb once) if hydration already finished, so callers can safely
   * seed synchronous state after the cache is populated.
   */
  onHydrated(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    if (cacheHydrated) {
      cb();
      return () => {};
    }
    const handler = () => cb();
    window.addEventListener("osler-hydrated", handler);
    return () => window.removeEventListener("osler-hydrated", handler);
  },

  /**
   * Await all in-flight IndexedDB writes. Called automatically on page
   * unload so the most recent write is never lost on refresh/close.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(pendingWrites));
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

  /** Merge server records without allowing an older device to overwrite newer local work. */
  async mergeCloudProgress(
    progress: Record<string, QuestionRecord> | undefined,
    flashcards: Record<string, FlashcardReviewRecord> | undefined,
  ): Promise<void> {
    const progressEntries = Object.entries(progress ?? {})
      .filter(([key, incoming]) => {
        if (!isSafeImportKey(key)) return false;
        const local = getCached<QuestionRecord>("progress", key);
        return !!incoming && (!local || incoming.timestamp > local.timestamp);
      })
      .map(([key, value]) => ({ key, value: mergeQuestionRecord(getCached<QuestionRecord>("progress", key), value) }));
    if (progressEntries.length) {
      await idbPutBatch("progress", progressEntries);
      progressEntries.forEach((entry) => setCached("progress", entry.key, entry.value));
      dispatchChange("osler-progress-changed");
    }

    const flashcardEntries = Object.entries(flashcards ?? {}).filter(([key, incoming]) => {
      if (!isSafeImportKey(key)) return false;
      const local = getCached<FlashcardReviewRecord>("flashcardReviews", key);
      return !!incoming && (!local || incoming.lastReviewed > local.lastReviewed);
    }).map(([key, value]) => ({ key, value }));
    if (flashcardEntries.length) {
      await idbPutBatch("flashcardReviews", flashcardEntries);
      flashcardEntries.forEach((entry) => setCached("flashcardReviews", entry.key, entry.value));
      dispatchChange("osler-flashcard-changed");
    }
  },

  /**
   * Serialize syncable kinds into a { kind: { records } } snapshot that
   * mirrors the worker's SYNC_KINDS. Pass optional `kinds` array/Set to
   * export only specific dirty kinds to save payload size and server work.
   */
  exportSyncSnapshot(kinds?: SyncKind[] | Set<SyncKind>): Record<string, { records: Record<string, unknown> }> {
    const snapshot: Record<string, { records: Record<string, unknown> }> = {};
    const shouldExport = (kind: SyncKind) => {
      if (!kinds) return true;
      return Array.isArray(kinds) ? kinds.includes(kind) : kinds.has(kind);
    };

    if (shouldExport("qbank")) {
      snapshot.qbank = { records: storage.exportProgressRecords() as unknown as Record<string, unknown> };
    }
    if (shouldExport("flashcards")) {
      snapshot.flashcards = { records: flashcardReview.getAll() as unknown as Record<string, unknown> };
    }
    if (shouldExport("sessions")) {
      const sessionRecords: Record<string, unknown> = {};
      for (const s of sessions.list()) {
        if (s.id === "__active__") continue;
        sessionRecords[s.id] = s;
      }
      snapshot.sessions = { records: sessionRecords };
    }
    if (shouldExport("notes")) {
      const noteRecords: Record<string, unknown> = {};
      for (const n of notes.listSync()) noteRecords[n.id] = n;
      snapshot.notes = { records: noteRecords };
    }
    if (shouldExport("highlights")) {
      const highlightRecords: Record<string, unknown> = {};
      for (const [k, v] of memoryCache) {
        if (k.startsWith("highlights:")) {
          const key = k.replace("highlights:", "");
          if (Array.isArray(v)) highlightRecords[key] = v;
        }
      }
      snapshot.highlights = { records: highlightRecords };
    }
    if (shouldExport("articleHighlights")) {
      snapshot.articleHighlights = { records: storage.exportArticleHighlights() as unknown as Record<string, unknown> };
    }
    if (shouldExport("bookmarks")) {
      snapshot.bookmarks = { records: readBookmarkState() as unknown as Record<string, unknown> };
    }
    if (shouldExport("writtenDrafts")) {
      const writtenDraftRecords: Record<string, unknown> = {};
      for (const [k, v] of memoryCache) {
        if (k.startsWith("writtenDrafts:")) {
          writtenDraftRecords[k.replace("writtenDrafts:", "")] = v;
        }
      }
      snapshot.writtenDrafts = { records: writtenDraftRecords };
    }
    if (shouldExport("achievements")) {
      snapshot.achievements = { records: achievements.getAll() as unknown as Record<string, unknown> };
    }
    if (shouldExport("settings")) {
      const settingsRecords: Record<string, unknown> = {};
      for (const [k, v] of memoryCache) {
        if (k.startsWith("settings:")) {
          settingsRecords[k.replace("settings:", "")] = v;
        }
      }
      snapshot.settings = { records: settingsRecords };
    }
    return snapshot;
  },

  /**
   * Merge a full cloud snapshot (all kinds) into local storage, newest-wins.
   * Item-array kinds (highlights) and bookmarks merge by union so no device's
   * additions are ever lost.
   */
  async mergeCloudSnapshot(snapshot: Record<string, { records?: Record<string, any> }>): Promise<void> {
    await storage.mergeCloudProgress(
      snapshot.qbank?.records as Record<string, QuestionRecord> | undefined,
      snapshot.flashcards?.records as Record<string, FlashcardReviewRecord> | undefined,
    );

    const sessionRecords = snapshot.sessions?.records;
    if (sessionRecords && typeof sessionRecords === "object") {
      const entries = Object.entries(sessionRecords)
        .filter(([id, incoming]) => {
          if (id === "__active__" || !isSafeImportKey(id)) return false;
          const local = getCached<SavedSession>("sessions", sessionKey(id));
          return !!incoming && typeof incoming === "object" && (!local || sessionVersion(incoming as SavedSession) > sessionVersion(local));
        })
        .map(([id, value]) => ({ key: sessionKey(id), value }));
      if (entries.length) {
        await idbPutBatch("sessions", entries);
        entries.forEach((e) => setCached("sessions", e.key, e.value));
        dispatchChange("osler-sessions-changed");
      }
    }

    const noteRecords = snapshot.notes?.records;
    if (noteRecords && typeof noteRecords === "object") {
      const current = notesCache ?? await ensureNotesCache();
      const incoming = Object.values(noteRecords).filter((n): n is NoteRecord =>
        !!n && typeof n === "object" && typeof n.id === "string");
      const merged = mergeItemArraysById(current, incoming, (n) => n.updatedAt);
      if (merged.length !== current.length || merged.some((n, i) => n !== current[i])) {
        for (const note of merged) await idbPutNote(note);
        notesCache = merged;
        notifyNotesChanged();
      }
    }

    for (const kind of ["highlights", "articleHighlights"] as const) {
      const docs = snapshot[kind]?.records;
      if (!docs || typeof docs !== "object") continue;
      let changed = false;
      for (const [key, incoming] of Object.entries(docs)) {
        if (!Array.isArray(incoming)) continue;
        const current = getCached<HighlightItem[]>(kind, key) ?? [];
        // Raw merge (tombstones included) — readers filter; pruning here
        // mirrors the worker's merge so old tombstones GC everywhere.
        const merged = pruneHighlightTombstones(mergeItemArraysById(current, incoming, (h) => itemVersion(h)));
        if (merged.length !== current.length || merged.some((it, i) => it !== current[i])) {
          changed = true;
          setCached(kind, key, merged);
          await idbPut(kind, key, merged);
        }
      }
      if (changed) dispatchChange(kind === "highlights" ? "osler-highlights-changed" : "osler-article-highlights-changed");
    }

    const bookmarkRecords = snapshot.bookmarks?.records;
    if (bookmarkRecords && typeof bookmarkRecords === "object" && typeof window !== "undefined") {
      if (articleBookmarks.merge(bookmarkRecords as Record<string, BookmarkEntry>)) {
        window.dispatchEvent(new CustomEvent("osler-bookmarks-changed"));
      }
    }

    // writtenDrafts: deep-dict merge per pack per question, incoming-wins at leaf
    const wdRecords = snapshot.writtenDrafts?.records;
    if (wdRecords && typeof wdRecords === "object") {
      let changed = false;
      for (const [packUid, incomingPack] of Object.entries(wdRecords)) {
        if (!incomingPack || typeof incomingPack !== "object" || Array.isArray(incomingPack)) continue;
        const current = getCached<Record<string, any>>("writtenDrafts", packUid) ?? {};
        const merged = mergeDictDeep(current, incomingPack as Record<string, any>);
        if (merged.changed) {
          changed = true;
          setCached("writtenDrafts", packUid, merged.records);
          await idbPut("writtenDrafts", packUid, merged.records);
        }
      }
      if (changed) dispatchChange("osler-written-drafts-changed");
    }

    // achievements: union by id, newest unlockedAt wins.
    const achRecords = snapshot.achievements?.records;
    if (achRecords && typeof achRecords === "object") {
      const entries = Object.entries(achRecords)
        .filter(([id, incoming]) => {
          const local = getCached<AchievementRecord>("achievements", id);
          return !!incoming && typeof incoming === "object" && (!local || (incoming.unlockedAt ?? 0) > (local.unlockedAt ?? 0));
        })
        .map(([key, value]) => ({ key, value }));
      if (entries.length) {
        await idbPutBatch("achievements", entries);
        entries.forEach((e) => setCached("achievements", e.key, e.value));
        dispatchChange("osler-achievements-changed");
      }
    }

    // settings: key/value map (string or JSON object), last writer wins per key (union).
    const settingsRecords = snapshot.settings?.records;
    if (settingsRecords && typeof settingsRecords === "object") {
      let settingsChanged = false;
      let syncPrefChanged = false;
      let newSyncPref: boolean | null = null;
      const batch: Array<{ key: string; value: unknown }> = [];
      for (const [key, incoming] of Object.entries(settingsRecords)) {
        if (!isSafeImportKey(key)) continue;
        const current = getCached<unknown>("settings", key);
        // Use JSON stringify for deep compare (handles object values like quiz-settings).
        if (JSON.stringify(current) !== JSON.stringify(incoming)) {
          batch.push({ key, value: incoming });
          setCached("settings", key, incoming);
          // Keep quiz-settings in-memory cache in sync when it arrives from cloud.
          if (key === QUIZ_SETTINGS_KEY && incoming && typeof incoming === "object") {
            cachedQuizSettings = { ...DEFAULT_QUIZ_SETTINGS, ...(incoming as QuizSettings) };
          }
          settingsChanged = true;
          if (key === "cloud-sync-enabled" && typeof incoming === "string") {
            syncPrefChanged = true;
            newSyncPref = incoming === "true";
          }
        }
      }
      if (batch.length) {
        await idbPutBatch("settings", batch);
      }
      if (settingsChanged) {
        dispatchChange("osler-settings-changed");
        // Also refresh quiz-settings listeners if that key changed.
        if (batch.some((b) => b.key === QUIZ_SETTINGS_KEY) && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(QUIZ_SETTINGS_EVENT));
          quizSettingsSubscribers.forEach((cb) => {
            try { cb(); } catch (e) { console.warn(e); }
          });
        }
        if (syncPrefChanged && newSyncPref !== null && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("osler-cloud-sync-pref", { detail: { enabled: newSyncPref } }));
        }
      }
    }
  },

  /** Serialize all article highlights (articleId -> HighlightItem[]) for backup/sync. */
  exportArticleHighlights(): Record<string, HighlightItem[]> {
    const result: Record<string, HighlightItem[]> = {};
    for (const [k, v] of memoryCache) {
      if (k.startsWith("articleHighlights:")) {
        const articleId = k.replace("articleHighlights:", "");
        result[articleId] = v as HighlightItem[];
      }
    }
    return result;
  },

  async importData(data: Record<string, unknown>): Promise<void> {
    // 1. Progress — individual question records
    const rawProgress = data["osler_raw_progress"] as Record<string, QuestionRecord> | undefined;
    if (rawProgress && typeof rawProgress === "object") {
      const entries = Object.entries(rawProgress)
        .filter(([key, v]) => isSafeImportKey(key) && v && typeof v === "object" && "uid" in v && "qid" in v)
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
        .filter(([key, v]) => isSafeImportKey(key) && v && typeof v === "object" && "dueDate" in v)
        .map(([key, value]) => ({ key, value }));
      if (entries.length > 0) {
        await idbPutBatch("flashcardReviews", entries);
        for (const e of entries) {
          setCached("flashcardReviews", e.key, e.value);
        }
        dispatchChange("osler-flashcard-changed");
      }
    }

    // 3b. Article highlights (per-article keys: osler_article_highlights_<articleId>)
    const articleHlEntries = Object.entries(data)
      .filter(([key]) => key.startsWith("osler_article_highlights_"))
      .map(([key, value]) => ({
        key: key.replace("osler_article_highlights_", ""),
        value: value as HighlightItem[],
      }))
      .filter((e) => isSafeImportKey(e.key) && Array.isArray(e.value));
    for (const e of articleHlEntries) {
      const current = getCached<HighlightItem[]>("articleHighlights", e.key) ?? [];
      const merged = pruneHighlightTombstones(mergeItemArraysById(current, e.value, (h) => itemVersion(h)));
      if (merged.length !== current.length || merged.some((it, i) => it !== current[i])) {
        setCached("articleHighlights", e.key, merged);
        await idbPut("articleHighlights", e.key, merged);
      }
    }
    if (articleHlEntries.length > 0) {
      dispatchChange("osler-article-highlights-changed");
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

    // 5. Achievements (id → { id, unlockedAt })
    const achArr = data["osler_achievements"] as Record<string, AchievementRecord> | AchievementRecord[] | undefined;
    if (achArr) {
      const entries = Array.isArray(achArr)
        ? achArr.filter((r) => r && typeof r === "object" && typeof r.id === "string")
        : Object.entries(achArr)
            .filter(([, v]) => v && typeof v === "object" && typeof v.id === "string")
            .map(([, value]) => value as AchievementRecord);
      for (const rec of entries) {
        const local = getCached<AchievementRecord>("achievements", rec.id);
        if (!local || rec.unlockedAt > local.unlockedAt) {
          setCached("achievements", rec.id, rec);
        }
      }
      const batch = Object.entries(achievements.getAll()).map(([key, value]) => ({ key, value }));
      if (batch.length > 0) {
        await idbPutBatch("achievements", batch);
        dispatchChange("osler-achievements-changed");
      }
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
      // The active (in-progress) session lives under __active__ — it is NOT a
      // finished, reviewable session and must not appear in the saved list.
      if (k.startsWith("sessions:session:") && k !== "sessions:session:__active__" && !(v as SavedSession).deletedAt) {
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
    const existing = getCached<SavedSession>("sessions", key);
    if (!existing || existing.deletedAt) return;
    // Tombstone so the deletion wins the per-key union merge on every device.
    const tombstone: SavedSession = { ...existing, completedAt: Date.now(), deletedAt: Date.now() };
    setCached("sessions", key, tombstone);
    idbPut("sessions", key, tombstone).catch(console.warn);
    dispatchChange("osler-sessions-changed");
  },

  get(id: string): SavedSession | null {
    const session = getCached<SavedSession>("sessions", sessionKey(id));
    return session?.deletedAt ? null : session;
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

  /** Subscribe to active-session changes (in-progress save/clear). */
  subscribeActive(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const handler = () => cb();
    window.addEventListener("osler-active-session-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("osler-active-session-changed", handler);
      window.removeEventListener("storage", handler);
    };
  },

  /** Persist the active (in-progress) session so it survives hard refresh. */
  saveActive(session: unknown) {
    const key = "session:__active__";
    setCached("sessions", key, session);
    idbPut("sessions", key, session).catch(console.warn);
    dispatchChange("osler-active-session-changed");
  },

  /** Load the active session from IDB (returns null if none). */
  getActive(): unknown | null {
    return getCached<unknown>("sessions", "session:__active__");
  },

  /** Load the active session straight from IndexedDB (hydration-independent). */
  async getActiveFromDb(): Promise<unknown | null> {
    return idbGet<unknown>("sessions", "session:__active__");
  },

  /** Clear the active session from IDB when session ends or is exited. */
  clearActive() {
    deleteCached("sessions", "session:__active__");
    idbDelete("sessions", "session:__active__").catch(console.warn);
    dispatchChange("osler-active-session-changed");
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
    return (getCached<HighlightItem[]>("highlights", key) ?? []).filter(isLiveHighlight);
  },

  getAll(packUid: string): Record<number, HighlightItem[]> {
    const result: Record<number, HighlightItem[]> = {};
    const prefix = `highlights:${packUid}:`;
    for (const [k, v] of memoryCache) {
      if (k.startsWith(prefix)) {
        const idx = parseInt(k.replace(prefix, ""), 10);
        if (!isNaN(idx)) result[idx] = (v as HighlightItem[]).filter(isLiveHighlight);
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
    dispatchChange("osler-highlights-changed");
  },

  remove(packUid: string, questionIdx: number, id: string) {
    const key = highlightsKey(packUid, questionIdx);
    const current = getCached<HighlightItem[]>("highlights", key) ?? [];
    // Tombstone instead of removing: the union merge on every replica (and
    // the worker's) is monotonic, so a plain removal would be resurrected by
    // the next pull from a device that still holds the live item.
    const updated = current.map((h) => (h.id === id && isLiveHighlight(h) ? tombstoneHighlight(h.id) : h));
    if (updated.some((h, i) => h !== current[i])) {
      setCached("highlights", key, updated);
      idbPut("highlights", key, updated).catch(console.warn);
      dispatchChange("osler-highlights-changed");
    }
  },

  clear(packUid: string, questionIdx: number) {
    const key = highlightsKey(packUid, questionIdx);
    const current = getCached<HighlightItem[]>("highlights", key) ?? [];
    const updated = pruneHighlightTombstones(current.map((h) => (isLiveHighlight(h) ? tombstoneHighlight(h.id) : h)));
    setCached("highlights", key, updated);
    idbPut("highlights", key, updated).catch(console.warn);
    dispatchChange("osler-highlights-changed");
  },

  clearAll(packUid: string) {
    const prefix = `highlights:${packUid}:`;
    const keys: string[] = [];
    for (const [k, v] of memoryCache) {
      if (k.startsWith(prefix) && Array.isArray(v) && (v as HighlightItem[]).some(isLiveHighlight)) keys.push(k);
    }
    for (const k of keys) {
      const rawKey = k.replace("highlights:", "");
      const updated = pruneHighlightTombstones((memoryCache.get(k) as HighlightItem[]).map((h) => (isLiveHighlight(h) ? tombstoneHighlight(h.id) : h)));
      setCached("highlights", rawKey, updated);
      idbPut("highlights", rawKey, updated).catch(console.warn);
    }
    if (keys.length) dispatchChange("osler-highlights-changed");
  },
};

/* ── Article Highlights ─────────────────────────────────────────────── */

export const articleHighlights = {
  get(articleId: string): HighlightItem[] {
    return (getCached<HighlightItem[]>("articleHighlights", articleId) ?? []).filter(isLiveHighlight);
  },

  save(articleId: string, items: HighlightItem[]) {
    // Whole-list replace from the caller's (filtered) view — derive deletions
    // by diffing against the raw stored list, so a removed highlight becomes
    // a tombstone instead of silently resurrecting on the next pull.
    const current = getCached<HighlightItem[]>("articleHighlights", articleId) ?? [];
    const incomingIds = new Set(items.filter(isLiveHighlight).map((h) => h.id));
    const tombstones = current
      .filter((h) => h && typeof h === "object" && h.id && !incomingIds.has(h.id))
      .map((h) => (isLiveHighlight(h) ? tombstoneHighlight(h.id) : h));
    const merged = pruneHighlightTombstones([...items, ...tombstones]);
    setCached("articleHighlights", articleId, merged);
    idbPut("articleHighlights", articleId, merged).catch(console.warn);
    dispatchChange("osler-article-highlights-changed");
  },

  clear(articleId: string) {
    const current = getCached<HighlightItem[]>("articleHighlights", articleId) ?? [];
    const updated = pruneHighlightTombstones(current.map((h) => (isLiveHighlight(h) ? tombstoneHighlight(h.id) : h)));
    setCached("articleHighlights", articleId, updated);
    idbPut("articleHighlights", articleId, updated).catch(console.warn);
    dispatchChange("osler-article-highlights-changed");
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
    const drafts = getCached<Record<string, WrittenDraft>>("writtenDrafts", writtenDraftsKey(packUid)) ?? {};
    return Object.fromEntries(Object.entries(drafts).filter(([, d]) => d && !d.deletedAt));
  },

  save(packUid: string, drafts: Record<string, WrittenDraft>) {
    const key = writtenDraftsKey(packUid);
    // Stamp every leaf for LWW sync — merges rank leaves by updatedAt, so a
    // cleared draft's tombstone loses to a subsequently re-saved draft.
    const now = Date.now();
    const stamped = Object.fromEntries(
      Object.entries(drafts).map(([qid, d]) => [qid, d && !d.deletedAt ? { ...d, updatedAt: now } : d]),
    );
    setCached("writtenDrafts", key, stamped);
    idbPut("writtenDrafts", key, stamped).catch(console.warn);
    dispatchChange("osler-written-drafts-changed");
  },

  clear(packUid: string) {
    const key = writtenDraftsKey(packUid);
    const current = getCached<Record<string, WrittenDraft>>("writtenDrafts", key) ?? {};
    const now = Date.now();
    const tombstoned = Object.fromEntries(
      Object.entries(current).map(([qid, d]) => [qid, d && !d.deletedAt ? { updatedAt: now, deletedAt: now } as WrittenDraft : d]),
    );
    setCached("writtenDrafts", key, tombstoned);
    idbPut("writtenDrafts", key, tombstoned).catch(console.warn);
    dispatchChange("osler-written-drafts-changed");
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
  /** Tombstone from a deck reset — merges rank by `lastReviewed`. */
  deletedAt?: number;
}

function flashcardKey(deckUid: string, cardId: string): string {
  return `${deckUid}:${cardId}`;
}

export const flashcardReview = {
  get(cardId: string): FlashcardReviewRecord | null {
    // Search through cache for this cardId (tombstoned resets read as absent)
    for (const [k, v] of memoryCache) {
      if (k.startsWith("flashcardReviews:") && k.endsWith(`:${cardId}`)) {
        return (v as FlashcardReviewRecord).deletedAt ? null : (v as FlashcardReviewRecord);
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
    // Tombstone every card's record (even ones never reviewed here) so the
    // reset out-ranks the records other devices still hold.
    const now = Date.now();
    for (const id of cardIds) {
      const key = flashcardKey(deckUid, id);
      const existing = getCached<FlashcardReviewRecord>("flashcardReviews", key);
      if (existing?.deletedAt) continue;
      const tombstone: FlashcardReviewRecord = {
        ease: 0, interval: 0, dueDate: 0, lastReviewed: now, reviewCount: 0, correctCount: 0, deletedAt: now,
      };
      setCached("flashcardReviews", key, tombstone);
      idbPut("flashcardReviews", key, tombstone).catch(console.warn);
    }
    dispatchChange("osler-flashcard-changed");
  },

  async clearAll() {
    // Tombstone every record (same semantics as clearDeck) so a full reset
    // propagates to every synced device instead of being resurrected by pulls.
    const now = Date.now();
    for (const [k, v] of memoryCache) {
      if (k.startsWith("flashcardReviews:") && !(v as FlashcardReviewRecord).deletedAt) {
        const tombstone: FlashcardReviewRecord = {
          ease: 0, interval: 0, dueDate: 0, lastReviewed: now, reviewCount: 0, correctCount: 0, deletedAt: now,
        };
        setCached("flashcardReviews", k.replace("flashcardReviews:", ""), tombstone);
        idbPut("flashcardReviews", k.replace("flashcardReviews:", ""), tombstone).catch(console.warn);
      }
    }
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
    dispatchChange("osler-settings-changed");
  },

  async getBool(key: string): Promise<boolean> {
    const val = await settings.get(key);
    return val === "true";
  },
};

/* ── Achievements (persisted unlock records, synced like progress) ───── */

export const achievements = {
  get(id: string): AchievementRecord | null {
    return getCached<AchievementRecord>("achievements", id);
  },

  /** All unlocked achievements as `id → record`. */
  getAll(): Record<string, AchievementRecord> {
    const result: Record<string, AchievementRecord> = {};
    for (const [k, v] of memoryCache) {
      if (k.startsWith("achievements:")) {
        result[k.replace("achievements:", "")] = v as AchievementRecord;
      }
    }
    return result;
  },

  isUnlocked(id: string): boolean {
    return !!getCached<AchievementRecord>("achievements", id);
  },

  unlock(id: string, unlockedAt = Date.now()) {
    if (achievements.isUnlocked(id)) return;
    const record: AchievementRecord = { id, unlockedAt };
    setCached("achievements", id, record);
    idbPut("achievements", id, record).catch(console.warn);
    dispatchChange("osler-achievements-changed");
  },

  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const handler = () => cb();
    window.addEventListener("osler-achievements-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("osler-achievements-changed", handler);
      window.removeEventListener("storage", handler);
    };
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
  /** Tombstone from notes.delete — content dropped; ranked by `updatedAt`. */
  deletedAt?: number;
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

// Flush pending IndexedDB writes before the tab is hidden/closed so the
// most recent mutation (answer, session, highlight) is never lost on refresh.
if (typeof window !== "undefined") {
  const flushOnUnload = () => {
    void storage.flush();
  };
  window.addEventListener("pagehide", flushOnUnload);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnUnload();
  });
}

export const notes = {
  async list(): Promise<NoteRecord[]> {
    const cached = await ensureNotesCache();
    return [...cached].filter((n) => !n.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** Raw view (tombstones included) — sync exports only. */
  listSync(): NoteRecord[] {
    return notesCache ? [...notesCache].sort((a, b) => b.updatedAt - a.updatedAt) : [];
  },

  /** Live count for UI stats (tombstones excluded). */
  countLive(): number {
    return notesCache ? notesCache.filter((n) => !n.deletedAt).length : 0;
  },

  async get(id: string): Promise<NoteRecord | null> {
    const cached = await ensureNotesCache();
    return cached.find((n) => n.id === id && !n.deletedAt) ?? null;
  },

  async listByPack(packUid: string): Promise<NoteRecord[]> {
    const cached = await ensureNotesCache();
    return cached
      .filter((n) => n.packUid === packUid && !n.deletedAt)
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
    // Tombstone instead of removing: notes merge per-key by updatedAt, so a
    // plain delete would be resurrected by the next pull from a device that
    // still holds the note.
    const existing = notesCache?.find((n) => n.id === id);
    if (existing && !existing.deletedAt) {
      const tombstone: NoteRecord = { ...existing, title: "", body: "", tags: [], updatedAt: Date.now(), deletedAt: Date.now() };
      await idbPutNote(tombstone);
      if (notesCache) {
        const idx = notesCache.findIndex((n) => n.id === id);
        if (idx >= 0) notesCache[idx] = tombstone;
        else notesCache.push(tombstone);
      }
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
      window.dispatchEvent(new CustomEvent("osler-settings-changed"));
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

/* ── Streak (daily consecutive-day tracking) ─────────────────────────── */

/**
 * Returns the UTC date string (YYYY-MM-DD) for a given timestamp.
 * All streak logic is anchored to UTC midnight to be timezone-agnostic.
 */
function toUtcDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function todayUtc(): string {
  return toUtcDay(Date.now());
}

/** Build the union of all days on which ≥1 question was answered. */
function collectActiveDaysFromCache(): Set<string> {
  const days = new Set<string>();
  for (const [k, v] of memoryCache) {
    if (k.startsWith("progress:")) {
      const r = v as QuestionRecord;
      if (r?.timestamp) days.add(toUtcDay(r.timestamp));
    } else if (k.startsWith("flashcardReviews:")) {
      const r = v as FlashcardReviewRecord;
      if (r?.lastReviewed) days.add(toUtcDay(r.lastReviewed));
    }
  }
  return days;
}

export interface StreakData {
  /** Current consecutive-day streak count (with 48h restore window). */
  current: number;
  /** All-time longest streak. */
  longest: number;
  /** Set of YYYY-MM-DD strings on which the user was active. */
  activeDays: Set<string>;
  /** Whether the user has been active today (or in the last 24h). */
  activeToday: boolean;
  /**
   * Epoch ms deadline by which the user must study to keep `current` alive,
   * or null when the streak is safe (active today) or already broken.
   * The restore window spans 48h from UTC midnight of the first missed day,
   * so the user can skip one full day and still have all of the next day
   * to restore the chain.
   */
  restoreDeadlineMs: number | null;
}

export interface DailyActivity {
  /** YYYY-MM-DD */
  date: string;
  /** Questions answered on this date. */
  count: number;
}

export const streak = {
  /**
   * Compute streak metrics from the in-memory cache.
   *
   * Restore window: a gap of exactly 1 missed day is tolerated when computing
   * the current streak — the user has a 48h window (from UTC midnight of the
   * first missed day) to study before the streak breaks. Concretely: skip one
   * full day and you can still restore on the next day.
   *
   * Concretely: when walking backwards we allow one "skip" in the chain.
   * The skip token is consumed the first time we see a missing day, and the
   * chain breaks on the second consecutive miss.
   */
  compute(): StreakData {
    const activeDays = collectActiveDaysFromCache();
    const today = todayUtc();
    const activeToday = activeDays.has(today);

    if (activeDays.size === 0)
      return { current: 0, longest: 0, activeDays, activeToday: false, restoreDeadlineMs: null };

    // Sort all active days ascending.
    const sorted = Array.from(activeDays).sort();

    // ── Compute longest streak (no grace window for all-time best) ──────
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + "T00:00:00Z");
      const curr = new Date(sorted[i] + "T00:00:00Z");
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
      if (diffDays === 1) {
        run++;
        longest = Math.max(longest, run);
      } else {
        run = 1;
      }
    }

    // ── Compute current streak (with 48h restore window) ────────────────
    // Walk backwards from today. We allow the chain to skip exactly one
    // missing day (the restore window). The starting cursor is "today" —
    // if the user hasn't studied today the window covers that gap.
    let current = 0;
    let graceUsed = !activeToday; // if not active today, grace is pre-consumed
    let cursorMs = new Date(today + "T00:00:00Z").getTime();

    for (let i = 0; i < 366; i++) {
      const dayStr = toUtcDay(cursorMs);
      if (activeDays.has(dayStr)) {
        current++;
        cursorMs -= 86_400_000;
      } else if (!graceUsed) {
        // consume the grace skip — don't increment, just step back one more day
        graceUsed = true;
        cursorMs -= 86_400_000;
      } else {
        break;
      }
    }

    // ── Restore deadline ─────────────────────────────────────────────────
    // When the streak is alive but today is still empty, the user has until
    // 48h after UTC midnight of the first missed day to study. Anchoring at
    // midnight (not "now") keeps the deadline stable across refreshes.
    let restoreDeadlineMs: number | null = null;
    if (!activeToday && current > 0) {
      let lastActive: string | null = null;
      for (const d of sorted) {
        if (d < today) lastActive = d;
        else break;
      }
      if (lastActive) {
        const firstMissedMs = new Date(lastActive + "T00:00:00Z").getTime() + 86_400_000;
        const deadline = firstMissedMs + 2 * 86_400_000;
        if (deadline > Date.now()) restoreDeadlineMs = deadline;
      }
    }

    return { current, longest, activeDays, activeToday, restoreDeadlineMs };
  },

  /**
   * Return per-day question counts for the last `days` calendar days
   * (including today), sorted oldest → newest.
   */
  dailyActivity(days: number): DailyActivity[] {
    const counts = new Map<string, number>();
    // Seed all days with 0 so the chart always has a full range.
    for (let i = days - 1; i >= 0; i--) {
      counts.set(toUtcDay(Date.now() - i * 86_400_000), 0);
    }
    for (const [k, v] of memoryCache) {
      if (k.startsWith("progress:")) {
        const r = v as QuestionRecord;
        if (r?.timestamp) {
          const day = toUtcDay(r.timestamp);
          if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
        }
      } else if (k.startsWith("flashcardReviews:")) {
        const r = v as FlashcardReviewRecord;
        if (r?.lastReviewed) {
          const day = toUtcDay(r.lastReviewed);
          if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  },

  /** Subscribe to any data changes that may affect streak (progress + flashcards). */
  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const handler = () => cb();
    window.addEventListener("osler-progress-changed", handler);
    window.addEventListener("osler-flashcard-changed", handler);
    window.addEventListener("osler-hydrated", handler);
    return () => {
      window.removeEventListener("osler-progress-changed", handler);
      window.removeEventListener("osler-flashcard-changed", handler);
      window.removeEventListener("osler-hydrated", handler);
    };
  },
};

// Run migration on load
if (typeof window !== "undefined") {
  openDB().then(() => {
    migrateFromLocalStorage().catch(console.warn);
  }).catch(console.warn);
}
