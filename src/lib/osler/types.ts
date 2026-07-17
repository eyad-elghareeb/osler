/**
 * Osler content schemas — TypeScript types matching Osler v1 content packs.
 * Each engine (quiz, bank, flashcard, written, osce) has its own content shape.
 */

export type EngineType =
  | "quiz"
  | "bank"
  | "flashcard"
  | "written"
  | "osce"
  | "library"
  | "video";

/** Content language. `en` is the default when omitted. */
export type ContentLang = "en" | "ar";

export interface ContentMeta {
  uid: string;
  title: string;
  description?: string;
  icon?: string;
  tags?: string[];
  schemaVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Language this content was authored in. Drives `dir` on the rendered body. */
  lang?: ContentLang;
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
  /** Image asset filenames in this folder's `images/` subfolder (leaf nodes only). */
  images?: string[];
  /** Child nodes — empty array for leaf (content-having) nodes. */
  items: ContentTreeNode[];
  /**
   * Language this pack's content is authored in (BCP-47 subset: `en` | `ar`).
   * When set on a parent folder, children inherit unless they override.
   * Defaults to `en` if absent.
   */
  lang?: ContentLang;
}

/** Per-category manifest listing the full tree. */
export interface CategoryManifest {
  type: EngineType;
  items: ContentTreeNode[];
}

/* ── Quiz ────────────────────────────────────────────────────────────── */
/** An image attached to a question. `src` resolves like flashcard assets —
 *  a bare filename is looked up in the pack's `images/` subfolder. */
export interface ContentImage {
  src: string;
  alt?: string;
  caption?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  /** Optional image(s) shown above the stem (resolved against the pack folder). */
  images?: ContentImage | ContentImage[];
  options: string[];
  correct: number;
  explanation: string;
  /** Optional image(s) shown below the explanation. */
  explanationImages?: ContentImage | ContentImage[];
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
  /** Optional image(s) shown above the question stem. */
  images?: ContentImage | ContentImage[];
  options: string[];
  correct: number;
  explanation: string;
  /** Optional image(s) shown below the explanation. */
  explanationImages?: ContentImage | ContentImage[];
  tags?: string[];
  difficulty?: number;
}

export interface BankPassage {
  id: string;
  content: string;
  /** Optional image(s) shown alongside the passage text. */
  images?: ContentImage | ContentImage[];
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

/**
 * Card format, Anki-style.
 *  - "basic"  — a front/back card (default when omitted).
 *  - "cloze"  — a single `text` field with `{{c1::hidden}}` deletions.
 *               Each distinct cloze index (c1, c2 …) becomes its own review
 *               card so the same passage can hide different terms.
 */
export type FlashcardType = "basic" | "cloze";

/**
 * An image attached to a card face. `src` is resolved relative to the pack's
 * folder (e.g. `ecg.png` → `/osler-content/flashcard/<path>/ecg.png`) unless
 * it is already an absolute URL or a `data:` URI.
 */
export interface FlashcardImage {
  src: string;
  alt?: string;
  caption?: string;
}

export interface Flashcard {
  id: string;
  /** Card format. Defaults to "basic" when omitted. */
  type?: FlashcardType;
  /** Front face (basic cards). Markdown is supported. */
  front?: string;
  /** Back face (basic cards). Markdown is supported. */
  back?: string;
  /**
   * Cloze source text (cloze cards). Uses Anki `{{c1::answer::hint}}` syntax.
   * The hint (`::hint`) is optional.
   */
  text?: string;
  /** Extra info shown under the answer on cloze cards. Markdown supported. */
  extra?: string;
  /** Image(s) shown on the front / question face. */
  image?: FlashcardImage | FlashcardImage[];
  /** Image(s) shown on the back / answer face. */
  backImage?: FlashcardImage | FlashcardImage[];
  /** Optional audio clip URL (resolved like images). */
  audio?: string;
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

/* ── Video ─────────────────────────────────────────────────────────── */

/**
 * A single video resource.
 *
 * The platform supports a "facade" player that hides the upstream provider
 * completely — the user never sees YouTube branding, controls, or links.
 * The `source` field is intentionally provider-agnostic so future CDN-hosted
 * videos can be added without breaking existing manifests.
 */
export interface VideoSource {
  /**
   * Upstream provider. Currently supported:
   *  - "youtube"   — uses YouTube IFrame Player API under a custom UI
   *  - "mp4"       — direct video file (CDN or same-origin)
   *  - "hls"       — HLS stream (.m3u8)
   */
  type: "youtube" | "mp4" | "hls";
  /** YouTube video ID (when type === "youtube") */
  id?: string;
  /** Direct URL for mp4/hls streams */
  url?: string;
}

export interface VideoChapter {
  /** Chapter start time in seconds. */
  time: number;
  title: string;
}

export interface VideoResource {
  id: string;
  title: string;
  description?: string;
  /** Medical specialty (e.g., "Cardiology"). */
  specialty?: string;
  /** Sub-topic for grouping within a folder (e.g., "ECG Interpretation"). */
  topic?: string;
  /** Duration in seconds (used for display; the actual duration comes from the player). */
  duration?: number;
  /** Optional custom poster/thumbnail URL. Falls back to a provider thumbnail when omitted. */
  thumbnail?: string;
  source: VideoSource;
  /** Optional instructor / presenter. */
  instructor?: string;
  /** Optional list of tags for search & filtering. */
  tags?: string[];
  /** Optional chapter markers for the timeline. */
  chapters?: VideoChapter[];
  /** Optional list of related article file paths in the library. */
  relatedArticles?: string[];
  /** Language the video audio/title is in. Defaults to "en". */
  lang?: ContentLang;
}

export interface VideoContent {
  meta: ContentMeta;
  type: "video";
  videos: VideoResource[];
}

export type AnyContent =
  | QuizContent
  | BankContent
  | FlashcardContent
  | WrittenContent
  | OsceContent
  | VideoContent;
