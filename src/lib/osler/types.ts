/**
 * Osler content schemas — TypeScript types matching Osler v1 content packs.
 * Each engine (quiz, bank, flashcard, written, osce) has its own content shape.
 */

export type EngineType = "quiz" | "bank" | "flashcard" | "written" | "osce";

export interface ContentMeta {
  uid: string;
  title: string;
  description?: string;
  icon?: string;
  tags?: string[];
  schemaVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ManifestItem {
  uid: string;
  type: EngineType;
  title: string;
  path: string;
  tags?: string[];
}

export interface Manifest {
  type: "hub";
  meta: ContentMeta;
  items: ManifestItem[];
}

/* ── Quiz ────────────────────────────────────────────────────────────── */
export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  tags?: string[];
  difficulty?: number;
}

export interface QuizContent {
  meta: ContentMeta;
  type: "quiz";
  questions: QuizQuestion[];
}

/* ── Bank (passage-based) ────────────────────────────────────────────── */
export interface BankQuestion {
  id: string;
  passageId: string;
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  tags?: string[];
  difficulty?: number;
}

export interface BankPassage {
  id: string;
  content: string;
  questions: BankQuestion[];
}

export interface BankContent {
  meta: ContentMeta;
  type: "bank";
  passages: BankPassage[];
}

/* ── Flashcard Subdeck ─────────────────────────────────────────────── */
export interface FlashcardSubdeck {
  id: string;
  title: string;
  description?: string;
  parentId?: string;
  icon?: string;
}

/* ── Flashcard ───────────────────────────────────────────────────────── */
export interface Flashcard {
  id: string;
  front: string;
  back: string;
  tags?: string[];
  subdeckId?: string;
}

export interface FlashcardContent {
  meta: ContentMeta;
  type: "flashcard";
  cards: Flashcard[];
  subdecks?: FlashcardSubdeck[];
}

/* ── Written ─────────────────────────────────────────────────────────── */
export interface WrittenPromptChild {
  id: string;
  label?: string;
  question?: string;
  modelAnswer?: string;
  rubric?: string;
  explanation?: string;
}

export interface WrittenPrompt {
  id: string;
  prompt: string;
  modelAnswer?: string;
  rubric: string[];
  wordLimit?: number;
  explanation?: string;
  tags?: string[];
  children?: WrittenPromptChild[];
}

export interface WrittenContent {
  meta: ContentMeta;
  type: "written";
  prompts: WrittenPrompt[];
}

/* ── OSCE ────────────────────────────────────────────────────────────── */
export interface OsceStation {
  id: string;
  scenario: string;
  redFlags: string[];
  differential: string[];
  rubric: string[];
}

export interface OsceContent {
  meta: ContentMeta;
  type: "osce";
  stations: OsceStation[];
}

export type AnyContent =
  | QuizContent
  | BankContent
  | FlashcardContent
  | WrittenContent
  | OsceContent;
