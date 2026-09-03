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
  BankPassage,
  BankQuestion,
  ContentChapter,
  ContentImage,
  EngineType,
  FlashcardContent,
  MixedContent,
  OsceContent,
  QuizContent,
  QuizQuestion,
  WrittenContent,
  WrittenPrompt,
  ContentTreeNode,
} from "./types";
import { storage } from "./storage";

/** Map an engine type to its content category folder (mirrors content.ts). */
function categoryFolderForEngine(type: EngineType): string {
  const map: Record<string, string> = {
    quiz: "qbank",
    bank: "qbank",
    written: "qbank",
    mixed: "qbank",
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
  chapter?: string;
  chapterId?: string;
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

export interface ChapterSummary {
  id: string;
  title: string;
  count: number;
}

export type OnlyMode = "all" | "wrong" | "flagged" | "new";
export type OrderMode = "sequential" | "random";

/* ── Counting ───────────────────────────────────────────────────────── */

export function countQuestions(content: AnyContent | null | undefined): number {
  if (!content) return 0;
  switch (content.type) {
    case "quiz":
      return content.questions.length + (content.prompts?.length ?? 0);
    case "bank":
      return (
        (content.passages ?? []).reduce((a, p) => a + p.questions.length, 0) +
        (content.questions?.length ?? 0) +
        (content.prompts?.length ?? 0)
      );
    case "mixed":
      return (
        (content.passages ?? []).reduce((a, p) => a + p.questions.length, 0) +
        (content.questions?.length ?? 0) +
        (content.prompts?.length ?? 0)
      );
    case "flashcard":
      return content.cards.length;
    case "written":
      return content.prompts.length + (content.questions?.length ?? 0);
    case "osce":
      return content.stations.length;
    default:
      return 0;
  }
}

/* ── Chapter parsing & resolution ────────────────────────────────────── */

export function parseChapterRange(rangeStr?: string): { start: number; end: number } | null {
  if (!rangeStr) return null;
  const match = rangeStr.match(/(\d+)\s*[-–—:]\s*(\d+)/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  if (isNaN(start) || isNaN(end)) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function resolveQuestionChapter(
  chapters: ContentChapter[] | undefined,
  q: { id?: string; chapter?: string; chapterId?: string; passageId?: string },
  qIndex: number, // 1-based index in the pack
): { chapter?: string; chapterId?: string } {
  if (chapters && chapters.length > 0) {
    for (const ch of chapters) {
      if (ch.questionIds && q.id && ch.questionIds.includes(q.id)) {
        return { chapter: ch.title, chapterId: ch.id };
      }
      if (ch.passageIds && q.passageId && ch.passageIds.includes(q.passageId)) {
        return { chapter: ch.title, chapterId: ch.id };
      }
      if (ch.start != null && ch.end != null && qIndex >= ch.start && qIndex <= ch.end) {
        return { chapter: ch.title, chapterId: ch.id };
      }
      if (ch.from != null && ch.to != null && qIndex >= ch.from && qIndex <= ch.to) {
        return { chapter: ch.title, chapterId: ch.id };
      }
      const parsed = parseChapterRange(ch.range);
      if (parsed && qIndex >= parsed.start && qIndex <= parsed.end) {
        return { chapter: ch.title, chapterId: ch.id };
      }
      if (q.chapterId && q.chapterId === ch.id) {
        return { chapter: ch.title, chapterId: ch.id };
      }
      if (q.chapter && (q.chapter === ch.id || q.chapter === ch.title)) {
        return { chapter: ch.title, chapterId: ch.id };
      }
    }
  }
  if (q.chapter) {
    return { chapter: q.chapter, chapterId: q.chapterId ?? q.chapter };
  }
  return {};
}

/** Normalize image fields (accepting string, ContentImage, or arrays of either) */
export function normalizeContentImages(
  img?: ContentImage | ContentImage[] | string | string[],
): ContentImage | ContentImage[] | undefined {
  if (!img) return undefined;
  if (Array.isArray(img)) {
    const list = img
      .map((item) => (typeof item === "string" ? { src: item } : item))
      .filter((item): item is ContentImage => Boolean(item?.src));
    return list.length > 0 ? list : undefined;
  }
  return typeof img === "string" ? { src: img } : img;
}

/** Normalize choiceImages array */
export function normalizeChoiceImages(
  images?: unknown[],
): (ContentImage | ContentImage[] | undefined)[] | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  return images.map((item) =>
    normalizeContentImages(item as ContentImage | ContentImage[] | string | string[]),
  );
}

/**
 * Extract summary of chapters for a given content pack (including question count per chapter).
 */
export function getChapters(content: AnyContent | null | undefined): ChapterSummary[] {
  if (!content) return [];
  const questions = contentToQuestions(content);
  if (questions.length === 0) return [];

  const chaptersProp: ContentChapter[] =
    (content as QuizContent | BankContent | MixedContent | WrittenContent).chapters ?? [];

  if (chaptersProp.length > 0) {
    return chaptersProp.map((ch) => {
      const matchingCount = questions.filter(
        (q) => q.chapterId === ch.id || q.chapter === ch.title,
      ).length;
      return {
        id: ch.id,
        title: ch.title,
        count: matchingCount,
      };
    });
  }

  // If no root chapters array was declared, look for distinct question chapters
  const map = new Map<string, { id: string; title: string; count: number }>();
  for (const q of questions) {
    if (q.chapter) {
      const key = q.chapterId || q.chapter;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { id: key, title: q.chapter, count: 1 });
      }
    }
  }
  return Array.from(map.values());
}

export function hasChapters(content: AnyContent | null | undefined): boolean {
  return getChapters(content).length > 0;
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

  const chaptersProp: ContentChapter[] | undefined =
    (content as QuizContent | BankContent | MixedContent | WrittenContent).chapters;

  const addMcqQuestion = (
    q: QuizQuestion | BankQuestion | any,
    passage?: BankPassage,
  ) => {
    const qIndex = out.length + 1;
    const { chapter, chapterId } = resolveQuestionChapter(
      chaptersProp,
      {
        id: q.id,
        chapter: q.chapter ?? passage?.chapter,
        chapterId: q.chapterId ?? passage?.chapterId,
        passageId: q.passageId ?? passage?.id,
      },
      qIndex,
    );
    const rawImages = passage?.images ?? q.images ?? q.image;
    const rawChoiceImages = q.choiceImages;
    const rawExplImages = q.explanationImages ?? q.explanationImage;

    out.push({
      id: q.id,
      stem: passage?.content
        ? `${passage.content}\n\n${q.question ?? q.stem ?? ""}`
        : (q.question ?? q.stem ?? ""),
      images: normalizeContentImages(rawImages),
      choiceImages: normalizeChoiceImages(
        Array.isArray(rawChoiceImages)
          ? rawChoiceImages
          : q.options?.map((_o: any, i: number) => (q as any).choiceImages?.[i]),
      ),
      choices: q.options ?? q.choices ?? [],
      correct: typeof q.correct === "number" ? q.correct : 0,
      explanation: q.explanation ?? "",
      explanationImages: normalizeContentImages(rawExplImages),
      tags: q.tags,
      difficulty: q.difficulty ? `${q.difficulty}/5` : undefined,
      chapter,
      chapterId,
      sourceUid,
      sourceTitle,
      sourcePath,
      sourceCategory,
    });
  };

  const addWrittenPrompt = (p: WrittenPrompt | any) => {
    const qIndex = out.length + 1;
    const { chapter, chapterId } = resolveQuestionChapter(
      chaptersProp,
      {
        id: p.id,
        chapter: p.chapter,
        chapterId: p.chapterId,
      },
      qIndex,
    );
    const children = p.children?.map((c: any) => ({
      id: c.id,
      label: c.label,
      question: c.question,
      modelAnswer: c.modelAnswer,
      rubric: c.rubric,
      explanation: c.explanation,
    }));
    const rawImages = p.images ?? p.image;
    const rawExplImages = p.explanationImages ?? p.explanationImage;

    out.push({
      id: p.id,
      stem: p.prompt ?? p.question ?? "",
      images: normalizeContentImages(rawImages),
      choices: [],
      correct: -1,
      modelAnswer: p.modelAnswer,
      explanation:
        p.explanation ??
        (Array.isArray(p.rubric) && p.rubric.length > 0
          ? `Self-grading rubric:\n${p.rubric.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}`
          : ""),
      explanationImages: normalizeContentImages(rawExplImages),
      rubric: p.rubric,
      tags: p.tags,
      difficulty: p.difficulty ? `${p.difficulty}/5` : undefined,
      children,
      chapter,
      chapterId,
      sourceUid,
      sourceTitle,
      sourcePath,
      sourceCategory,
    });
  };

  if (content.type === "quiz") {
    const quiz = content as QuizContent;
    for (const q of quiz.questions ?? []) {
      if ((q as any).options && (q as any).options.length > 0) {
        addMcqQuestion(q);
      } else if ((q as any).rubric || (q as any).modelAnswer || (q as any).prompt) {
        addWrittenPrompt(q);
      } else {
        addMcqQuestion(q);
      }
    }
    for (const p of quiz.prompts ?? []) {
      addWrittenPrompt(p);
    }
  } else if (content.type === "bank") {
    const bank = content as BankContent;
    for (const passage of bank.passages ?? []) {
      for (const question of passage.questions) addMcqQuestion(question, passage);
    }
    for (const question of bank.questions ?? []) {
      if ((question as any).options && (question as any).options.length > 0) {
        addMcqQuestion(question);
      } else if ((question as any).rubric || (question as any).modelAnswer || (question as any).prompt) {
        addWrittenPrompt(question);
      } else {
        addMcqQuestion(question);
      }
    }
    for (const p of bank.prompts ?? []) {
      addWrittenPrompt(p);
    }
  } else if (content.type === "mixed") {
    const mixed = content as MixedContent;
    for (const passage of mixed.passages ?? []) {
      for (const question of passage.questions) addMcqQuestion(question, passage);
    }
    for (const q of mixed.questions ?? []) {
      const anyQ = q as any;
      if (anyQ.type === "written" || (!anyQ.options && (anyQ.rubric || anyQ.modelAnswer || anyQ.prompt))) {
        addWrittenPrompt(anyQ);
      } else {
        addMcqQuestion(anyQ);
      }
    }
    for (const p of mixed.prompts ?? []) {
      addWrittenPrompt(p);
    }
  } else if (content.type === "written") {
    const written = content as WrittenContent;
    for (const p of written.prompts ?? []) addWrittenPrompt(p);
    for (const q of written.questions ?? []) addMcqQuestion(q);
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
 * Rules:
 *   - `quiz`, `bank`, `written`, and `mixed` may be freely mixed in one pool.
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
 * given `tags`. Operates on the *question-level* tags (SessionQuestion.tags).
 *
 * Empty `tags` array returns the pool unchanged.
 */
export function filterPoolByTags(pool: PoolQuestion[], tags: string[]): PoolQuestion[] {
  if (!tags || tags.length === 0) return pool;
  const set = new Set(tags);
  return pool.filter((q) => Array.isArray(q.tags) && q.tags.some((t) => set.has(t)));
}

/* ── Chapter filtering ──────────────────────────────────────────────── */

/**
 * Filter a pool to questions belonging to any of the selected chapters (by chapter title or id).
 */
export function filterPoolByChapters(pool: PoolQuestion[], chapters: string[]): PoolQuestion[] {
  if (!chapters || chapters.length === 0) return pool;
  const set = new Set(chapters);
  return pool.filter(
    (q) => (q.chapter && set.has(q.chapter)) || (q.chapterId && set.has(q.chapterId)),
  );
}

/* ── Question Type filtering ────────────────────────────────────────── */

/**
 * Filter a pool by question type ("all" | "mcq" | "written").
 */
export function filterPoolByQuestionType(
  pool: PoolQuestion[],
  type?: "all" | "mcq" | "written",
): PoolQuestion[] {
  if (!type || type === "all") return pool;
  if (type === "mcq") return pool.filter((q) => q.correct >= 0);
  if (type === "written") return pool.filter((q) => q.correct < 0);
  return pool;
}

/* ── Difficulty filtering ───────────────────────────────────────────── */

/**
 * Filter a pool by difficulty rating ("all" | "easy" | "medium" | "hard").
 */
export function filterPoolByDifficulty(
  pool: PoolQuestion[],
  difficulty?: "all" | "easy" | "medium" | "hard",
): PoolQuestion[] {
  if (!difficulty || difficulty === "all") return pool;
  return pool.filter((q) => {
    if (!q.difficulty) return false;
    const num = parseInt(q.difficulty, 10);
    if (isNaN(num)) {
      const lower = q.difficulty.toLowerCase();
      if (difficulty === "easy") return lower.includes("easy");
      if (difficulty === "medium") return lower.includes("med");
      if (difficulty === "hard") return lower.includes("hard");
      return false;
    }
    if (difficulty === "easy") return num <= 2;
    if (difficulty === "medium") return num === 3;
    if (difficulty === "hard") return num >= 4;
    return false;
  });
}

/* ── Progress filtering ─────────────────────────────────────────────── */

/**
 * Filter a pool based on stored progress for each question.
 *
 *   - "all"      → return pool unchanged
 *   - "wrong"    → only questions whose most recent record is incorrect
 *   - "flagged"  → only questions whose most recent record has flagged=true
 */
export function filterPoolByProgress(
  pool: PoolQuestion[],
  mode: OnlyMode,
  /** Optional fallback uid when sourceUid is missing (single-pack path). */
  fallbackUid?: string,
): PoolQuestion[] {
  if (mode === "all") return pool;
  return pool.filter((q) => {
    const uid = q.sourceUid || fallbackUid;
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
 * Return the merge family for an engine type.
 */
export function poolFamilyForEngine(type: EngineType): "mcq" | "written" | "mixed" | null {
  if (type === "quiz" || type === "bank") return "mcq";
  if (type === "written") return "written";
  if (type === "mixed") return "mixed";
  return null;
}

/**
 * Given a list of selected engine types, return the family they all share
 * (or null if mixed).
 */
export function sharedPoolFamily(types: EngineType[]): "mcq" | "written" | "mixed" | null {
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
 * quiz/bank/written/mixed are all compatible. flashcard/osce/video cannot participate.
 */
export function canPoolTogether(types: EngineType[]): boolean {
  return types.every((t) => {
    const f = poolFamilyForEngine(t);
    return f === "mcq" || f === "written" || f === "mixed";
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
