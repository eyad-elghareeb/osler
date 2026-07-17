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
 *   - `buildQuestionPool` merges `quiz` + `bank` + `written` packs freely.
 *     MCQ and written questions coexist in the same pool; per-question
 *     detection (`correct >= 0` for MCQ, rubric/modelAnswer for written)
 *     drives the rendering branch at runtime.
 */

import type {
  AnyContent,
  BankContent,
  BankQuestion,
  ContentImage,
  EngineType,
  FlashcardContent,
  OsceContent,
  QuizContent,
  QuizQuestion,
  WrittenContent,
  ContentTreeNode,
} from "./types";
import { storage } from "./storage";

/** Map an engine type to its content category folder (mirrors content.ts). */
function categoryFolderForEngine(type: EngineType): string {
  const map: Record<string, string> = {
    quiz: "qbank",
    bank: "qbank",
    written: "qbank",
    flashcard: "flashcard",
    osce: "osce",
    library: "library",
    video: "videos",
  };
  return map[type] ?? type;
}

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
  /** Optional image(s) shown above the stem (resolved against the source pack). */
  images?: ContentImage | ContentImage[];
  /** Optional image(s) shown above a specific choice, keyed by 0-based index. */
  choiceImages?: (ContentImage | ContentImage[] | undefined)[];
  choices: string[];
  correct: number; // -1 for non-MCQ
  explanation: string;
  /** Optional image(s) shown below the explanation. */
  explanationImages?: ContentImage | ContentImage[];
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
  /** Content-relative folder path of the originating pack (for asset resolution). */
  sourcePath?: string;
  /** Category folder of the originating pack (qbank / flashcard / osce / …). */
  sourceCategory?: string;
}

export type OnlyMode = "all" | "wrong" | "flagged" | "new";
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
  sourceNode?: ContentTreeNode,
): PoolQuestion[] {
  const sourcePath = sourceNode?.path;
  const sourceCategory = sourceNode
    ? categoryFolderForEngine(sourceNode.type)
    : undefined;
  const out: PoolQuestion[] = [];
  if (content.type === "quiz") {
    (content as QuizContent).questions.forEach((q) => {
      out.push({
        id: q.id,
        stem: q.question,
        images: q.images,
        choiceImages: q.options.map((_o, i) =>
          (q as QuizQuestion & { choiceImages?: (ContentImage | ContentImage[] | undefined)[] }).choiceImages?.[i],
        ),
        choices: q.options,
        correct: q.correct,
        explanation: q.explanation,
        explanationImages: q.explanationImages,
        tags: q.tags,
        difficulty: q.difficulty ? `${q.difficulty}/5` : undefined,
        sourceUid,
        sourceTitle,
        sourcePath,
        sourceCategory,
      });
    });
  } else if (content.type === "bank") {
    (content as BankContent).passages.forEach((p) => {
      p.questions.forEach((q) => {
        out.push({
          id: q.id,
          stem: `${p.content}\n\n${q.question}`,
          images: p.images ?? q.images,
          choiceImages: q.options.map((_o, i) =>
            (q as BankQuestion & { choiceImages?: (ContentImage | ContentImage[] | undefined)[] }).choiceImages?.[i],
          ),
          choices: q.options,
          correct: q.correct,
          explanation: q.explanation,
          explanationImages: q.explanationImages,
          tags: q.tags,
          difficulty: q.difficulty ? `${q.difficulty}/5` : undefined,
          sourceUid,
          sourceTitle,
          sourcePath,
          sourceCategory,
        });
      });
    });
  } else if (content.type === "flashcard") {
    (content as FlashcardContent).cards.forEach((c) => {
      out.push({
        id: c.id,
        stem: c.front ?? c.text ?? "",
        choices: [],
        correct: -1,
        explanation: c.back ?? c.extra ?? "",
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
 *   - `quiz`, `bank`, and `written` may be freely mixed in one pool.
 *     MCQ questions (quiz/bank) have `correct >= 0` and choices; written
 *     questions have `correct === -1` and rubric/modelAnswer. Per-question
 *     detection drives the rendering branch at runtime.
 *   - `flashcard`/`osce`/`video` are ignored here — QBank Studio does not
 *     own them.
 */
export function buildQuestionPool(entries: PoolSourceEntry[]): PoolQuestion[] {
  const pool: PoolQuestion[] = [];
  for (const { node, content } of entries) {
    if (!content) continue;
    // Drop flashcard/osce/video — not owned by QBank
    if (
      content.type === "flashcard" ||
      content.type === "osce" ||
      content.type === "video"
    ) {
      continue;
    }
    const stamped = contentToQuestions(content, node.uid, node.title, node);
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
    if (mode === "new") return !rec;
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
 *
 * Note: quiz/bank and written CAN be mixed — this function only classifies
 * individual types. The source picker uses `canPoolTogether` for mixing logic.
 */
export function poolFamilyForEngine(type: EngineType): "mcq" | "written" | null {
  if (type === "quiz" || type === "bank") return "mcq";
  if (type === "written") return "written";
  return null;
}

/**
 * Given a list of selected engine types, return the family they all share
 * (or null if mixed). Used by the source picker to determine if all selected
 * packs belong to a single family.
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

/**
 * Check if a set of engine types can be pooled together.
 * quiz/bank/written are all compatible. flashcard/osce/video cannot participate.
 */
export function canPoolTogether(types: EngineType[]): boolean {
  return types.every((t) => {
    const f = poolFamilyForEngine(t);
    return f === "mcq" || f === "written";
  });
}

/**
 * Determine the engine type for a pool question (per-question detection).
 * MCQ questions (correct >= 0) return "quiz"; written/osce questions return
 * their actual engine type.
 */
export function engineForPoolQuestion(q: PoolQuestion): EngineType {
  if (q.correct >= 0) return "quiz";
  if (q.rubric && q.rubric.length > 0 && q.choices.length === 0) return "written";
  return "quiz";
}
