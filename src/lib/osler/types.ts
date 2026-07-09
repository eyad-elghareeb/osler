/**
 * Osler content schemas — TypeScript types matching Osler v1 content packs.
 * Each engine (quiz, bank, flashcard, written, osce) has its own content shape.
 */

export type EngineType = "quiz" | "bank" | "flashcard" | "written" | "osce" | "library";

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

/* ── Content Tree (folder-based discovery) ─────────────────────────── */

/** A node in the content tree derived from folder structure. */
export interface ContentTreeNode {
  uid: string;
  title: string;
  type: EngineType;
  description?: string;
  /** Relative path from the category root (with trailing /). */
  path: string;
  /** Data JSON files in this folder (present only on leaf nodes). */
  files?: string[];
  /** Child nodes — empty array for leaf (content-having) nodes. */
  items: ContentTreeNode[];
}

/** Per-category manifest listing the full tree. */
export interface CategoryManifest {
  type: EngineType;
  items: ContentTreeNode[];
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
export interface OscePatient {
  name: string;
  age: number;
  gender: string;
  avatarSeed: string;
  opening: string;
}

export interface OsceHiddenProfile {
  diagnosis: string;
  keySymptoms: string[];
  redFlags: string[];
  pastHistory: string[];
  vitalSigns: string;
}

export interface OsceRubric {
  mustAsk: string[];
  bonus: string[];
}

export interface OsceExaminer {
  name: string;
  title: string;
}

export interface OsceDataTable {
  title?: string;
  headers?: string[];
  rows?: string[][];
}

export interface OsceDataImage {
  title?: string;
  caption?: string;
  src?: string;
  url?: string;
  data?: string;
  alt?: string;
}

export interface OsceDataPresented {
  scenario?: string;
  tables?: OsceDataTable[];
  images?: OsceDataImage[];
}

export interface OsceQuestion {
  question: string;
  answer?: string;
  rubric?: string;
}

export interface OsceStation {
  id: string;
  title: string;
  type: "history" | "data-interp";
  specialty: string;
  difficulty: string;
  task: string;
  time: number;
  examiner: OsceExaminer;
  dataPresented?: OsceDataPresented | null;
  questions: OsceQuestion[];
  patient: OscePatient;
  hiddenProfile: OsceHiddenProfile;
  rubric: OsceRubric;
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
