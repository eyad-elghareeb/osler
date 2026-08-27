/**
 * Pure analytics for the QBank results (summary) view.
 *
 * Everything derives from the finished SessionData at render time — nothing is
 * persisted here, so the numbers always match what the user just played. The
 * score history reads the saved-session store (the same source the Tracker
 * tab uses) to place the current attempt in context of previous attempts on
 * the same content.
 */
import type { SavedSession } from "@/lib/osler/storage";
import type { SessionData, SessionQuestion } from "./shared";

/**
 * Unified per-question outcome for a finished session — covers MCQ (answer vs
 * correct), written/OSCE (rubric ≥60%), and flashcards ("easy" rating) in one
 * predicate. Single source for the hero counts, breakdowns, pacing and review
 * list, replacing three copies of the same conditional chain.
 */
export function questionIsCorrect(session: SessionData, q: SessionQuestion, idx: number): boolean {
  if (!session.revealed[idx]) return false;
  if (q.correct >= 0) return session.answers[idx] === q.correct;
  if (session.engine === "flashcard" && !q.rubric?.length) return session.ratings[q.id] === "easy";
  if (q.rubric && q.rubric.length > 0) {
    return (session.rubricState[q.id] ?? []).filter(Boolean).length / q.rubric.length >= 0.6;
  }
  return false;
}

export interface AccuracyBucket {
  /** Stable key — bucket id or tag text. */
  key: string;
  /** Display label (tag text; difficulty labels are localized in the view). */
  label: string;
  /** Questions in this bucket. */
  total: number;
  /** Questions actually revealed/answered. */
  answered: number;
  /** Correct answers among the answered. */
  correct: number;
}

export type DifficultyBucket = AccuracyBucket & { key: "easy" | "medium" | "hard" };

/** Content difficulty is stored as "N/5" → 1-2 easy, 3 medium, 4-5 hard. */
function difficultyLevel(difficulty?: string): 1 | 2 | 3 | null {
  const n = parseInt(difficulty ?? "", 10);
  if (Number.isNaN(n) || n < 1 || n > 5) return null;
  return n <= 2 ? 1 : n === 3 ? 2 : 3;
}

/** Accuracy per difficulty tier — only tiers present in the session, easy → hard. */
export function difficultyBreakdown(session: SessionData): DifficultyBucket[] {
  const byLevel = new Map<1 | 2 | 3, DifficultyBucket>();
  session.questions.forEach((q, i) => {
    const level = difficultyLevel(q.difficulty);
    if (level == null) return;
    const bucket = byLevel.get(level) ?? {
      key: level === 1 ? "easy" : level === 2 ? "medium" : "hard",
      label: "",
      total: 0,
      answered: 0,
      correct: 0,
    };
    bucket.total++;
    if (session.revealed[i]) bucket.answered++;
    if (questionIsCorrect(session, q, i)) bucket.correct++;
    byLevel.set(level, bucket);
  });
  return [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
}

/** Accuracy per topic tag — top `max` by question count (weakest first on ties). */
export function topicBreakdown(session: SessionData, max = 6): AccuracyBucket[] {
  const byTag = new Map<string, AccuracyBucket>();
  session.questions.forEach((q, i) => {
    for (const tag of q.tags ?? []) {
      const bucket = byTag.get(tag) ?? { key: tag, label: tag, total: 0, answered: 0, correct: 0 };
      bucket.total++;
      if (session.revealed[i]) bucket.answered++;
      if (questionIsCorrect(session, q, i)) bucket.correct++;
      byTag.set(tag, bucket);
    }
  });
  return [...byTag.values()]
    .sort((a, b) => b.total - a.total || a.correct / (a.answered || 1) - b.correct / (b.answered || 1))
    .slice(0, max);
}

export interface PacingPoint {
  index: number;
  /** Pause-adjusted time on the question (ms), null when never timed. */
  ms: number | null;
  state: "correct" | "wrong" | "unrevealed";
}

/** Per-question time + outcome for the pacing strip (spans all questions). */
export function pacingData(session: SessionData): PacingPoint[] {
  const times = session.questionTimes ?? {};
  return session.questions.map((q, i): PacingPoint => {
    const revealed = !!session.revealed[i];
    return {
      index: i,
      ms: times[q.id] ?? null,
      state: !revealed ? "unrevealed" : questionIsCorrect(session, q, i) ? "correct" : "wrong",
    };
  });
}

export interface ScoreHistory {
  /** Score percentages (oldest → newest, max 10), INCLUDING the current attempt. */
  scores: number[];
  /** Score of the previous attempt on the same content, null on a first attempt. */
  previous: number | null;
}

/**
 * Place the current attempt in the context of previous completed sessions over
 * the same content — matched by pack uid or shared source packs, mirroring how
 * the Tracker/history group sessions. Scores use correct/answered (the
 * Tracker's method) so trend points stay comparable across attempts.
 */
export function scoreHistory(current: SessionData, saved: SavedSession[]): ScoreHistory {
  const sources = new Set(current.questions.map((q) => q.sourceUid ?? current.itemId));
  const pctOf = (s: SavedSession) =>
    s.answeredCount > 0 ? Math.round((s.correctCount / s.answeredCount) * 100) : 0;
  const related = saved
    .filter((s) => !!s.completedAt && s.answeredCount > 0 && s.id !== current.sessionId)
    .filter((s) => sources.has(s.packUid) || (s.sources ?? []).some((src) => sources.has(src)))
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  const currentAnswered = Object.values(current.revealed).filter(Boolean).length;
  const currentCorrect = current.questions.filter((q, i) => questionIsCorrect(current, q, i)).length;
  const previous = related.length > 0 ? pctOf(related[related.length - 1]) : null;
  const scores =
    currentAnswered > 0
      ? [...related.slice(-9).map(pctOf), Math.round((currentCorrect / currentAnswered) * 100)]
      : [];
  return { scores, previous };
}