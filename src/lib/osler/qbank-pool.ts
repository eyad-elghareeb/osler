/**
 * Osler QBank shared question-pool utilities.
 *
 * Single source of truth for:
 *   - converting AnyContent → flat question list (`contentToQuestions`)
 *   - counting questions in a pack (`countQuestions`)
 *   - merging multiple packs into one pool (`buildQuestionPool`)
 *   - filtering by question-level tags (`filterPoolByTags`)
 *   - filtering by stored progress (`filterPoolByProgress`)
 *   - picking N questions in sequential/random order (`pickQuestions`)
 *
 * Used by:
 *   - Content tab (for stats/counts)
 *   - Create Test tab (for source picker + build action)
 *   - Previous Tests / Review (for reconstructing saved sessions)
 *   - Tracker tab (for building review sessions from selections)
 *
 * Constraints enforced here (see `osler-qbank-rework-plan.md` §2):
 *   - `buildQuestionPool` only merges `quiz` + `bank` packs. `written` has a
 *     different render path and must NOT be pooled with quiz/bank. Callers
 *     that pass a `written` pack alongside quiz/bank will get the written
 *     pack dropped with a console warning.
 */

import type {
  AnyContent,
  BankContent,
  EngineType,
  FlashcardContent,
  OsceContent,
  QuizContent,
  WrittenContent,
  ContentTreeNode,
} from "./types";
import { storage } from "./storage";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface PoolQuestionChild {
  id: string;
  label?: string;
  question?: string;
  modelAnswer?: string;
  rubric?: string;
  explanation?: string;
}

export interface PoolQuestion {
  id: string;
  stem: string;
  choices: string[];
  correct: number; // -1 for non-MCQ
  explanation: string;
  modelAnswer?: string;
  tags?: string[];
  difficulty?: string;
  rubric?: string[];
  redFlags?: string[];
  differential?: string[];
  children?: PoolQuestionChild[];
  /**
   * Originating pack uid. Always set when produced by `buildQuestionPool`.
   * May be undefined for legacy single-pack paths that call `contentToQuestions`
   * without passing a source — callers must fall back to `session.itemId`.
   */
  sourceUid?: string;
  /** Title of the originating pack. */
  sourceTitle?: string;
}

export type OnlyMode = "all" | "wrong" | "flagged";
export type OrderMode = "sequential" | "random";

/* ── Counting ───────────────────────────────────────────────────────── */

export function countQuestions(content: AnyContent | null | undefined): number {
  if (!content) return 0;
  switch (content.type) {
    case "quiz":
      return content.questions.length;
    case "bank":
      return content.passages.reduce((a, p) => a + p.questions.length, 0);
    case "flashcard":
      return content.cards.length;
    case "written":
      return content.prompts.length;
    case "osce":
      return content.stations.length;
    default:
      return 0;
  }
}

/* ── Single-pack conversion ─────────────────────────────────────────── */

/**
 * Convert a single content pack's raw shape into the generic PoolQuestion[]
 * used by the QBank runtime. Optional `sourceUid`/`sourceTitle` stamp each
 * question with its origin so multi-pack pools can record progress correctly.
 *
 * Mirrors the historical `contentToQuestions` from qbank-studio.tsx verbatim
 * (just lifted here so other modules can call it without circular imports).
 */
export function contentToQuestions(
  content: AnyContent,
  sourceUid?: string,
  sourceTitle?: string,
): PoolQuestion[] {
  const out: PoolQuestion[] = [];
  if (content.type === "quiz") {
    (content as QuizContent).questions.forEach((q) => {
      out.push({
        id: q.id,
        stem: q.question,
        choices: q.options,
        correct: q.correct,
        explanation: q.explanation,
        tags: q.tags,
        difficulty: q.difficulty ? `${q.difficulty}/5` : undefined,
        sourceUid,
        sourceTitle,
      });
    });
  } else if (content.type === "bank") {
    (content as BankContent).passages.forEach((p) => {
      p.questions.forEach((q) => {
        out.push({
          id: q.id,
          stem: `${p.content}\n\n${q.question}`,
          choices: q.options,
          correct: q.correct,
          explanation: q.explanation,
          tags: q.tags,
          difficulty: q.difficulty ? `${q.difficulty}/5` : undefined,
          sourceUid,
          sourceTitle,
        });
      });
    });
  } else if (content.type === "flashcard") {
    (content as FlashcardContent).cards.forEach((c) => {
      out.push({
        id: c.id,
        stem: c.front,
        choices: [],
        correct: -1,
        explanation: c.back,
        tags: c.tags,
        sourceUid,
        sourceTitle,
      });
    });
  } else if (content.type === "written") {
    (content as WrittenContent).prompts.forEach((p) => {
      const children = p.children?.map((c) => ({
        id: c.id,
        label: c.label,
        question: c.question,
        modelAnswer: c.modelAnswer,
        rubric: c.rubric,
        explanation: c.explanation,
      }));
      out.push({
        id: p.id,
        stem: p.prompt,
        choices: [],
        correct: -1,
        modelAnswer: p.modelAnswer,
        explanation: p.explanation ?? (
          p.rubric.length > 0
            ? `Self-grading rubric:\n${p.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
            : ""
        ),
        rubric: p.rubric,
        tags: p.tags,
        children,
        sourceUid,
        sourceTitle,
      });
    });
  } else if (content.type === "osce") {
    (content as OsceContent).stations.forEach((s) => {
      const rubricArr = s.rubric?.mustAsk || [];
      out.push({
        id: s.id,
        stem: s.task || s.title,
        choices: [],
        correct: -1,
        explanation:
          rubricArr.length > 0
            ? `Performance rubric:\n${rubricArr.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}`
            : "",
        rubric: rubricArr,
        redFlags: s.hiddenProfile?.redFlags || [],
        differential: s.hiddenProfile?.keySymptoms || [],
        tags: ["osce"],
        sourceUid,
        sourceTitle,
      });
    });
  }
  return out;
}

/* ── Multi-pack pool building ───────────────────────────────────────── */

export interface PoolSourceEntry {
  node: ContentTreeNode;
  content: AnyContent | null;
}

/**
 * Build a merged question pool from multiple source packs.
 *
 * Rules (see plan §2):
 *   - `quiz` and `bank` may be freely mixed (both flatten to the same MCQ
 *     shape and render via the same QuizView path).
 *   - `written` is rendered via a different path (WrittenEngineView) and
 *     must NOT be pooled with quiz/bank. If `entries` contains a `written`
 *     pack alongside quiz/bank, the written pack is dropped with a warning.
 *   - `flashcard`/`osce`/`video` are ignored here — QBank Studio does not
 *     own them.
 */
export function buildQuestionPool(entries: PoolSourceEntry[]): PoolQuestion[] {
  const hasQuizBank = entries.some(
    (e) => e.content && (e.content.type === "quiz" || e.content.type === "bank"),
  );
  const hasWritten = entries.some((e) => e.content?.type === "written");

  if (hasQuizBank && hasWritten) {
    console.warn(
      "[qbank-pool] Cannot merge quiz/bank packs with written packs in a single session — dropping written entries. See osler-qbank-rework-plan.md §2.",
    );
  }

  const pool: PoolQuestion[] = [];
  for (const { node, content } of entries) {
    if (!content) continue;
    // Drop written if mixed with quiz/bank
    if (content.type === "written" && hasQuizBank) continue;
    // Drop flashcard/osce/video — not owned by QBank
    if (
      content.type === "flashcard" ||
      content.type === "osce" ||
      content.type === "video"
    ) {
      continue;
    }
    const stamped = contentToQuestions(content, node.uid, node.title);
    pool.push(...stamped);
  }
  return pool;
}

/* ── Tag filtering (question-level) ─────────────────────────────────── */

/**
 * Filter a pool to questions whose `tags` array contains at least one of the
 * given `tags`. Operates on the *question-level* tags (SessionQuestion.tags),
 * not the pack-level `meta.tags` — this is the fix for the half-built tag
 * filter in the old CreateTestTab.
 *
 * Empty `tags` array returns the pool unchanged.
 */
export function filterPoolByTags(pool: PoolQuestion[], tags: string[]): PoolQuestion[] {
  if (!tags || tags.length === 0) return pool;
  const set = new Set(tags);
  return pool.filter((q) => Array.isArray(q.tags) && q.tags.some((t) => set.has(t)));
}

/* ── Progress filtering ─────────────────────────────────────────────── */

/**
 * Filter a pool based on stored progress for each question.
 *
 *   - "all"      → return pool unchanged
 *   - "wrong"    → only questions whose most recent record is incorrect
 *   - "flagged"  → only questions whose most recent record has flagged=true
 *
 * Uses `storage.getRecord(sourceUid, id)` for O(1) lookup per question.
 * Questions without a sourceUid fall back to no record (so they're excluded
 * from "wrong"/"flagged" — there's nothing to be wrong or flagged yet).
 */
export function filterPoolByProgress(
  pool: PoolQuestion[],
  mode: OnlyMode,
): PoolQuestion[] {
  if (mode === "all") return pool;
  return pool.filter((q) => {
    const uid = q.sourceUid;
    if (!uid) return false;
    const rec = storage.getRecord(uid, q.id);
    if (!rec) return false;
    if (rec.dismissed) return false;
    if (mode === "wrong") return !rec.correct;
    if (mode === "flagged") return rec.flagged;
    return false;
  });
}

/* ── Picking / ordering ─────────────────────────────────────────────── */

/**
 * Pick `count` questions from a pool, optionally shuffled.
 *
 *   - "sequential" → first `count` questions, in original order
 *   - "random"     → Fisher-Yates shuffle of the pool, then take `count`
 *
 * Always returns at most `pool.length` items (no overflow).
 */
export function pickQuestions(
  pool: PoolQuestion[],
  count: number,
  order: OrderMode = "sequential",
): PoolQuestion[] {
  if (count <= 0) return [];
  if (order === "random") {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/* ── Engine-family helper (for source picker UI) ────────────────────── */

/**
 * Return the merge family for an engine type. Packs of the same family may
 * be combined into one session; packs from different families may not.
 *
 *   - quiz/bank → "mcq"
 *   - written   → "written"
 *   - others    → null (not pool-able)
 */
export function poolFamilyForEngine(type: EngineType): "mcq" | "written" | null {
  if (type === "quiz" || type === "bank") return "mcq";
  if (type === "written") return "written";
  return null;
}

/**
 * Given a list of selected engine types, return the family they all share
 * (or null if mixed). Used by the source picker to disable cross-family
 * selections.
 */
export function sharedPoolFamily(types: EngineType[]): "mcq" | "written" | null {
  if (types.length === 0) return null;
  const first = poolFamilyForEngine(types[0]);
  if (!first) return null;
  for (const t of types) {
    if (poolFamilyForEngine(t) !== first) return null;
  }
  return first;
}
