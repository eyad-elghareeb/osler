"use client";

import * as React from "react";
import { ClipboardCheck, Check, Pause, Sparkles, BookOpen, PenTool, Activity, Keyboard, Layers, Video as VideoIcon } from "lucide-react";
import { contentToQuestions as poolContentToQuestions, countQuestions as poolCountQuestions, buildQuestionPool, type OnlyMode } from "@/lib/osler/qbank-pool";
import type { AnyContent, ContentImage, EngineType, ContentTreeNode } from "@/lib/osler/types";
import { sessions, writtenDrafts, type SavedSession, type WrittenDraft } from "@/lib/osler/storage";
import { renderRichText, resolveContentAsset } from "@/lib/osler/richtext";
import { HIGHLIGHT_COLOR_KEYS } from "@/lib/osler/highlight-palette";
import { cn } from "@/lib/utils";
import { parseBinding, chordMatches } from "@/lib/osler/shortcuts";
import { useLightbox } from "@/components/osler/lightbox-provider";
import type { SessionMode } from "@/lib/osler/session-options";



































































export const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const ARABIC_LETTERS = ["أ", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط", "ي"];
// Choice indicators localised to the content language — Arabic content uses
// the Abjad-style sequence أ,ب,ت,… instead of Latin A,B,C,…
export const choiceLetter = (idx: number, lang?: string): string =>
  (lang && lang.startsWith("ar") ? ARABIC_LETTERS : LETTERS)[idx] ?? "?";
export const HIGHLIGHT_COLORS = HIGHLIGHT_COLOR_KEYS;

/** How many saved sessions the Tracker tab shows before collapsing into the
 *  "View all sessions" link to /qbank/history. */
export const RECENT_SESSION_PREVIEW_COUNT = 5;

/** Resolve the action a keydown event matches against a scope's single-chord
 *  bindings (Settings → Keyboard). Multi-chord (sequence) bindings are not
 *  handled here — the qbank session only binds single keys. */
export function matchSingleChordBinding(
  e: KeyboardEvent,
  bindings: Record<string, string>,
  scope: string,
): string | null {
  for (const [actionId, binding] of Object.entries(bindings)) {
    if (!actionId.startsWith(`${scope}.`)) continue;
    const chords = parseBinding(binding);
    if (chords.length !== 1) continue;
    if (chordMatches(e, chords[0])) return actionId;
  }
  return null;
}

/** Resolve the content-relative base (category + folder) for a question. */
export function questionAssetBase(q: SessionQuestion, item?: ContentTreeNode): {
  category: string;
  path: string;
} {
  if (q.sourceCategory && q.sourcePath) {
    return { category: q.sourceCategory, path: q.sourcePath };
  }
  if (!item) return { category: "qbank", path: "" };
  const category =
    item.type === "flashcard"
      ? "flashcard"
      : item.type === "osce"
        ? "osce"
        : item.type === "library"
          ? "library"
          : "qbank";
  return { category, path: item.path };
}

/** Render markdown + inline images for a piece of question text. */
export function renderQuestionText(text: string, q: SessionQuestion, item?: ContentTreeNode): string {
  const base = questionAssetBase(q, item);
  return renderRichText(text, base.category, base.path);
}

/** Normalize a ContentImage field (single or array) to an array. */
export function imageListOf(field?: ContentImage | ContentImage[]): ContentImage[] {
  if (!field) return [];
  return Array.isArray(field) ? field : [field];
}

/** A content image that opens the lightbox when tapped/clicked. Used for stem,
 * choice and explanation images so they work even inside the swipe gallery,
 * where pointer capture can swallow the synthetic click. */
export function ContentImageFigure({
  img,
  category,
  path,
  className,
}: {
  img: ContentImage;
  category: string;
  path: string;
  className: string;
}) {
  const { openLightbox } = useLightbox();
  const src = resolveContentAsset(img.src, category, path);
  return (
    <figure key={img.src} className="m-0">
      <img
        src={src}
        alt={img.alt ?? ""}
        onClick={(e) => {
          e.stopPropagation();
          openLightbox(src, img.alt ?? "");
        }}
        className={cn(className, "cursor-zoom-in")}
      />
      {img.caption && (
        <figcaption className="text-center text-xs text-muted-foreground mt-1.5">
          {img.caption}
        </figcaption>
      )}
    </figure>
  );
}
export function nodeFromPack(uid: string, content: AnyContent): ContentTreeNode {
  return {
    uid,
    title: content.meta?.title || uid,
    type: content.type,
    path: "",
    items: [],
    lang: content.meta?.lang,
  };
}
export type QuizMode = "home" | "quiz" | "results" | "review";
export type TestMode = SessionMode;
export type HomeTab = "content" | "create" | "tracker";

export interface SessionData {
  itemId: string;
  itemTitle: string;
  engine: EngineType;
  mode: TestMode;
  questions: SessionQuestion[];
  answers: Record<number, number>;
  revealed: Record<number, boolean>;
  flagged: Record<number, boolean>;
  current: number;
  startedAt: number;
  completedAt?: number;
  examTimeRemaining: number;
  examPaused: boolean;
  /** Absolute wall-clock expiry (ms) for timed exams, pause-adjusted. Survives hard refresh so a resumed countdown doesn't restart. */
  timeEndsAt?: number;
  sessionId: string;
  // Written drafts: questionId → { text, rubricChecked, submitted }
  writtenDrafts: Record<string, WrittenDraft>;
  // OSCE/Flashcard rubric state: questionId → boolean[]
  rubricState: Record<string, boolean[]>;
  // Flashcard ratings: questionId → "easy" | "hard" | "unknown"
  ratings: Record<string, "easy" | "hard" | "unknown">;
  // Strikethroughs: questionIdx → number[] (choice indices)
  strikethroughs: Record<number, number[]>;
  tagsFilter?: string[];
  onlyMode?: OnlyMode;
  dismissAfterCorrect?: boolean;
  isReview?: boolean;
  /** Pause-adjusted wall-clock duration (ms) per question id, captured at reveal. */
  questionTimes?: Record<string, number>;
}

export interface SessionQuestionChild {
  id: string;
  label?: string;
  question?: string;
  modelAnswer?: string;
  rubric?: string;
  explanation?: string;
}

export interface SessionQuestion {
  id: string;
  stem: string;
  images?: ContentImage | ContentImage[];
  choiceImages?: (ContentImage | ContentImage[] | undefined)[];
  choices: string[];
  correct: number;
  explanation: string;
  explanationImages?: ContentImage | ContentImage[];
  modelAnswer?: string;
  tags?: string[];
  difficulty?: string;
  rubric?: string[];
  redFlags?: string[];
  differential?: string[];
  children?: SessionQuestionChild[];
  sourceUid?: string;
  sourceTitle?: string;
  sourcePath?: string;
  sourceCategory?: string;
}
export type PackEntry = { node: ContentTreeNode; content: AnyContent | null };
/* ─────────────────────────────────────────────────────────────────────────
 * CONTENT TAB — Grid of premade content packs grouped by engine type
 * ───────────────────────────────────────────────────────────────────────── */
export const ENGINE_ICONS: Record<
  EngineType,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  quiz: ClipboardCheck,
  bank: BookOpen,
  flashcard: Layers,
  written: PenTool,
  osce: Activity,
  library: BookOpen,
  video: VideoIcon,
};

/** Single tool row inside the mobile session tools sheet. */
export function SessionToolRow({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-start px-3 py-2.5 hover:bg-muted flex items-center gap-3 rounded-lg text-sm transition-colors",
        active ? "text-primary font-medium" : "text-foreground",
      )}
    >
      <span
        className={cn(
          "size-9 rounded-lg flex items-center justify-center shrink-0",
          active ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {active && <Check className="size-4 text-primary shrink-0" />}
    </button>
  );
}
export function findNodeByUid(nodes: ContentTreeNode[], uid: string): ContentTreeNode | null {
  for (const node of nodes) {
    if (node.uid === uid) return node;
    if (node.items.length > 0) {
      const found = findNodeByUid(node.items, uid);
      if (found) return found;
    }
  }
  return null;
}

/* Helper: collect all uids (leaf + branch) under a tree — used to
 * auto-expand every folder when a search is active. */
export function collectAllUids(nodes: ContentTreeNode[]): string[] {
  const out: string[] = [];
  function walk(list: ContentTreeNode[]) {
    for (const n of list) {
      out.push(n.uid);
      if (n.items.length > 0) walk(n.items);
    }
  }
  walk(nodes);
  return out;
}
export function Lightbulb({ className }: { className?: string }) {
  return <Sparkles className={className} />;
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function formatTime(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Compact duration for a single question — "42s" or "1m 12s". */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function countQuestions(content: AnyContent): number {
  return poolCountQuestions(content);
}

export function contentToQuestions(
  content: AnyContent,
  sourceUid?: string,
  sourceTitle?: string,
  sourceNode?: ContentTreeNode,
): SessionQuestion[] {
  // Delegate to the shared module. Note: sourceUid/sourceTitle are NOT
  // stamped here — single-pack paths still rely on `session.itemId` for
  // progress recording. The multi-pack path (buildQuestionPool) stamps them
  // explicitly when constructing the pool.
  return poolContentToQuestions(content, sourceUid, sourceTitle, sourceNode) as SessionQuestion[];
}

/**
 * Preserve a genuinely in-progress active session as a saved record before a
 * fresh session overwrites it. Called when a start attempt could NOT resume
 * the active record (different pack, or the same pack with a different
 * question set) — so starting another test never silently destroys unresolved
 * progress. Skip conditions: no sessionId, completed, review replays, stale
 * (>7 days), or zero progress so the tracker stays free of noise. Re-saving
 * is idempotent (the store keys by sessionId).
 */
export async function archiveDisplacedActive() {
  try {
    const active = (await sessions.getActiveFromDb()) as SessionData | null;
    const hasProgress =
      Object.keys(active?.answers ?? {}).some(
        (k) => active?.answers[+k] !== undefined
      ) ||
      (active?.current ?? 0) > 0 ||
      Object.values(active?.flagged ?? {}).some(Boolean);
    if (
      active &&
      active.sessionId &&
      !active.completedAt &&
      !active.isReview &&
      Array.isArray(active.questions) &&
      active.questions.length > 0 &&
      hasProgress &&
      Date.now() - (active.startedAt ?? 0) < 7 * 24 * 60 * 60 * 1000
    ) {
      saveSession(active);
    }
  } catch {} // Non-fatal — the session still starts regardless.
}

export function saveSession(s: SessionData) {
  const total = s.questions.length;
  const answeredCount = Object.keys(s.answers).filter(
    (k) => s.answers[+k] !== undefined
  ).length;
  const mcqCorrect = s.questions.filter(
    (q, i) => s.revealed[i] && s.answers[i] === q.correct
  ).length;
  const nonMcqCorrect = s.questions.filter((q, i) => {
    if (q.correct >= 0) return false;
    if (!s.revealed[i]) return false;
    if (s.engine === "flashcard") return s.ratings[q.id] === "easy";
    if (s.engine === "written" || s.engine === "osce") {
      const rubric = s.rubricState[q.id] ?? [];
      return (
        q.rubric &&
        q.rubric.length > 0 &&
        rubric.filter(Boolean).length / q.rubric.length >= 0.6
      );
    }
    return false;
  }).length;
  const correctCount = mcqCorrect + nonMcqCorrect;
  const incorrectCount = answeredCount - mcqCorrect;
  const flaggedCount = Object.values(s.flagged).filter(Boolean).length;

  // P2-6: persist questionRefs (id+sourceUid parallel to the questions array),
  // the deduped source uids, and the filters that were active when the session
  // was built. Lets Previous Tests / Tracker reopen & retake accurately.
  const questionRefs = s.questions.map((q) => ({
    id: q.id,
    sourceUid: q.sourceUid ?? s.itemId,
  }));
  const sources = Array.from(new Set(questionRefs.map((r) => r.sourceUid)));

  const saved: SavedSession = {
    id: s.sessionId,
    packUid: s.itemId,
    packTitle: s.itemTitle,
    engine: s.engine,
    mode: s.mode,
    totalQuestions: total,
    answeredCount,
    correctCount,
    incorrectCount,
    flaggedCount,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    answers: s.answers,
    revealed: s.revealed,
    flagged: s.flagged,
    current: s.current,
    examTimeRemaining: s.examTimeRemaining,
    timeEndsAt: s.timeEndsAt,
    writtenDrafts: s.writtenDrafts,
    rubricState: s.rubricState,
    ratings: s.ratings,
    questionTimes: s.questionTimes,
    questionRefs,
    sources,
    tagsFilter: s.tagsFilter,
    onlyMode: s.onlyMode,
  };
  sessions.save(saved);
}