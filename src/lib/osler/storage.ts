/**
 * Osler storage — progress tracking + sessions + highlights + sticky notes.
 * All via localStorage. Mirrors medos-lite's storage capabilities.
 */

import type { EngineType } from "./types";

const KEY = "osler-progress-v1";
const SESSIONS_KEY = "osler-qbank-sessions-v1";
const HIGHLIGHTS_KEY = "osler-highlights-v1";
const STICKY_NOTES_KEY = "osler-sticky-notes-v1";
const WRITTEN_DRAFTS_KEY = "osler-written-drafts-v1";

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

interface ProgressDB {
  records: Record<string, QuestionRecord>;
}

/* ── Highlights ─────────────────────────────────────────────────────── */
export interface HighlightItem {
  id: string;
  color: string;
  text: string;
  target: string; // "stem" | "choice-0" | "choice-1" | ... | "explanation" | "article"
}

/* ── Sticky Notes ───────────────────────────────────────────────────── */
export interface StickyNoteData {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

/* ── Written Drafts ─────────────────────────────────────────────────── */
export interface WrittenDraft {
  text: string;
  rubricChecked: boolean[];
  submitted: boolean;
}

/* ── Session (saved test) ───────────────────────────────────────────── */
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
  // Full session state for resume
  answers: Record<number, number>;
  revealed: Record<number, boolean>;
  flagged: Record<number, boolean>;
  current: number;
  examTimeRemaining: number;
  writtenDrafts?: Record<string, WrittenDraft>;
  rubricState?: Record<string, boolean[]>;
  ratings?: Record<string, "easy" | "hard" | "unknown">;
}

function readProgress(): ProgressDB {
  if (typeof window === "undefined") return { records: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { records: {} };
    return JSON.parse(raw) as ProgressDB;
  } catch {
    return { records: {} };
  }
}

function writeProgress(db: ProgressDB) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    window.dispatchEvent(new CustomEvent("osler-progress-changed"));
  } catch (e) {
    console.warn("Failed to write progress:", e);
  }
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
    const db = readProgress();
    const key = `${uid}:${qid}`;
    db.records[key] = {
      uid,
      qid,
      engine,
      selected,
      correct,
      flagged,
      timestamp: Date.now(),
    };
    writeProgress(db);
  },

  getRecord(uid: string, qid: string): QuestionRecord | null {
    const db = readProgress();
    return db.records[`${uid}:${qid}`] ?? null;
  },

  clearPack(uid: string) {
    const db = readProgress();
    Object.keys(db.records).forEach((k) => {
      if (k.startsWith(`${uid}:`)) delete db.records[k];
    });
    writeProgress(db);
  },

  clearAll() {
    writeProgress({ records: {} });
  },

  packProgress(uid: string): PackProgress {
    const db = readProgress();
    const records = Object.values(db.records).filter((r) => r.uid === uid);
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
    const db = readProgress();
    const byUid = new Map<string, QuestionRecord[]>();
    Object.values(db.records).forEach((r) => {
      const list = byUid.get(r.uid) ?? [];
      list.push(r);
      byUid.set(r.uid, list);
    });
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

/* ── Saved Sessions (previous tests) ────────────────────────────────── */
function readSessions(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedSession[];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SavedSession[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  window.dispatchEvent(new CustomEvent("osler-sessions-changed"));
}

export const sessions = {
  list(): SavedSession[] {
    return readSessions().sort(
      (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)
    );
  },

  save(session: SavedSession) {
    const all = readSessions().filter((s) => s.id !== session.id);
    all.push(session);
    writeSessions(all);
  },

  delete(id: string) {
    writeSessions(readSessions().filter((s) => s.id !== id));
  },

  get(id: string): SavedSession | null {
    return readSessions().find((s) => s.id === id) ?? null;
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
function highlightsKey(packUid: string): string {
  return `${HIGHLIGHTS_KEY}:${packUid}`;
}

function readHighlights(packUid: string): Record<number, HighlightItem[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(highlightsKey(packUid));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeHighlights(
  packUid: string,
  data: Record<number, HighlightItem[]>
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(highlightsKey(packUid), JSON.stringify(data));
}

export const highlights = {
  get(packUid: string, questionIdx: number): HighlightItem[] {
    return readHighlights(packUid)[questionIdx] ?? [];
  },

  getAll(packUid: string): Record<number, HighlightItem[]> {
    return readHighlights(packUid);
  },

  add(packUid: string, questionIdx: number, item: HighlightItem) {
    const data = readHighlights(packUid);
    if (!data[questionIdx]) data[questionIdx] = [];
    data[questionIdx].push(item);
    writeHighlights(packUid, data);
  },

  remove(packUid: string, questionIdx: number, id: string) {
    const data = readHighlights(packUid);
    if (!data[questionIdx]) return;
    data[questionIdx] = data[questionIdx].filter((h) => h.id !== id);
    writeHighlights(packUid, data);
  },

  clear(packUid: string, questionIdx: number) {
    const data = readHighlights(packUid);
    delete data[questionIdx];
    writeHighlights(packUid, data);
  },

  clearAll(packUid: string) {
    if (typeof window === "undefined") return;
    localStorage.removeItem(highlightsKey(packUid));
  },
};

/* ── Article Highlights ─────────────────────────────────────────────── */
const ARTICLE_HL_KEY = "osler-article-highlights-v1";

export const articleHighlights = {
  get(articleId: string): HighlightItem[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(ARTICLE_HL_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw) as Record<string, HighlightItem[]>;
      return data[articleId] ?? [];
    } catch {
      return [];
    }
  },

  save(articleId: string, items: HighlightItem[]) {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(ARTICLE_HL_KEY);
      const data = raw ? JSON.parse(raw) : {};
      data[articleId] = items;
      localStorage.setItem(ARTICLE_HL_KEY, JSON.stringify(data));
    } catch {}
  },

  clear(articleId: string) {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(ARTICLE_HL_KEY);
      const data = raw ? JSON.parse(raw) : {};
      delete data[articleId];
      localStorage.setItem(ARTICLE_HL_KEY, JSON.stringify(data));
    } catch {}
  },
};

/* ── Sticky Notes (per question in a pack) ──────────────────────────── */
function stickyNotesKey(packUid: string): string {
  return `${STICKY_NOTES_KEY}:${packUid}`;
}

function readStickyNotes(packUid: string): Record<number, StickyNoteData[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(stickyNotesKey(packUid));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStickyNotes(
  packUid: string,
  data: Record<number, StickyNoteData[]>
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(stickyNotesKey(packUid), JSON.stringify(data));
}

export const stickyNotes = {
  get(packUid: string, questionIdx: number): StickyNoteData[] {
    return readStickyNotes(packUid)[questionIdx] ?? [];
  },

  add(packUid: string, questionIdx: number, note: StickyNoteData) {
    const data = readStickyNotes(packUid);
    if (!data[questionIdx]) data[questionIdx] = [];
    data[questionIdx].push(note);
    writeStickyNotes(packUid, data);
  },

  update(packUid: string, questionIdx: number, id: string, text: string) {
    const data = readStickyNotes(packUid);
    if (!data[questionIdx]) return;
    const note = data[questionIdx].find((n) => n.id === id);
    if (note) note.text = text;
    writeStickyNotes(packUid, data);
  },

  move(packUid: string, questionIdx: number, id: string, x: number, y: number) {
    const data = readStickyNotes(packUid);
    if (!data[questionIdx]) return;
    const note = data[questionIdx].find((n) => n.id === id);
    if (note) {
      note.x = x;
      note.y = y;
    }
    writeStickyNotes(packUid, data);
  },

  delete(packUid: string, questionIdx: number, id: string) {
    const data = readStickyNotes(packUid);
    if (!data[questionIdx]) return;
    data[questionIdx] = data[questionIdx].filter((n) => n.id !== id);
    writeStickyNotes(packUid, data);
  },

  clearAll(packUid: string) {
    if (typeof window === "undefined") return;
    localStorage.removeItem(stickyNotesKey(packUid));
  },
};

/* ── Written Drafts (per pack) ──────────────────────────────────────── */
export const writtenDrafts = {
  get(packUid: string): Record<string, WrittenDraft> {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(`${WRITTEN_DRAFTS_KEY}:${packUid}`);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  },

  save(packUid: string, drafts: Record<string, WrittenDraft>) {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      `${WRITTEN_DRAFTS_KEY}:${packUid}`,
      JSON.stringify(drafts)
    );
  },

  clear(packUid: string) {
    if (typeof window === "undefined") return;
    localStorage.removeItem(`${WRITTEN_DRAFTS_KEY}:${packUid}`);
  },
};
