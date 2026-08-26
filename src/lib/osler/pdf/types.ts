/**
 * Public types — every config/options/result contract surfaced by the PDF
 * module. Types only; no runtime behavior lives here.
 */
import type { UiLang } from "@/lib/osler/i18n";
import type { StyleMode, PdfPageConfig } from "./layout";

/**
 * The UI language to use for PDF template strings (QUESTION, EXPLANATION,
 * CHAPTER, etc.). Defaults to "en" if not specified. When set to "ar",
 * all chrome text is translated to Arabic and rendered RTL.
 */
export type PdfLang = UiLang;

export interface CoverConfig {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  description?: string;
  eyebrow?: string;
  features?: string[];
  footerNote?: string;
}

export interface ScoreSummaryData {
  pct: number;
  correct: number;
  total: number;
  answered: number;
  incorrect: number;
  flagged: number;
  percentile: number;
  totalTime: string;
  avgTime: string;
}

export interface QuestionReviewItem {
  num: number;
  stem: string;
  correct: boolean;
  unanswered: boolean;
}

export interface FullQuestion {
  stem: string;
  choices: string[];
  correct: number;
  explanation: string;
  modelAnswer?: string;
  isWritten?: boolean;
  difficulty?: string;
  tags?: string[];
  rubric?: string[];
}

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  author: string;
  includeCover: boolean;
  page: PdfPageConfig;
  styleMode: StyleMode;
  answersMode: "inline" | "endchapter" | "endbook" | "none";
  showExplanations: boolean;
  twoCol: boolean;
  showScoreSummary?: boolean;
  showReview?: boolean;
  fontSize?: "small" | "medium" | "large";
  fontType?: "serif" | "sans";
  /** UI language for PDF template strings (QUESTION, EXPLANATION, etc.). Defaults to "en". */
  lang?: PdfLang;
}

export interface QuestionDrawOpts {
  answersMode: PdfExportOptions["answersMode"];
  showExplanations: boolean;
  styleMode: PdfExportOptions["styleMode"];
  twoCol: boolean;
  /** Index of the chapter this question belongs to (for answer-key links). */
  chapterIdx?: number;
  /** Index of the user's chosen choice (session reports) — undefined when untaken. */
  userAnswer?: number;
  /** Whether the question was submitted/revealed in the exported session. */
  revealed?: boolean;
}

export interface PdfExportConfig {
  page: PdfPageConfig;
  cover: CoverConfig;
  includeCover: boolean;
  styleMode: PdfExportOptions["styleMode"];
  answersMode: PdfExportOptions["answersMode"];
  showExplanations: boolean;
  twoCol: boolean;
  author?: string;
  fontSize?: "small" | "medium" | "large";
  fontType?: "serif" | "sans";
  lang?: PdfLang;
  chapters: Array<{
    title: string;
    description?: string;
    questions: FullQuestion[];
  }>;
}

export interface ResultsPdfConfig {
  packTitle: string;
  mode: "tutor" | "timed";
  score: ScoreSummaryData;
  questions: FullQuestion[];
  userAnswers: Record<number, number>;
  revealed: Record<number, boolean>;
  flagged: Record<number, boolean>;
  opts: PdfExportOptions;
}

export interface DashboardPdfConfig {
  username: string;
  stats: { packs: number; attempted: number; correct: number; accuracy: number };
  recentPacks: Array<{
    title: string;
    engine: string;
    attempted: number;
    correct: number;
    lastAttempt: number | null;
  }>;
  opts: PdfExportOptions;
}

export interface ArticlePdfConfig {
  title: string;
  subtitle?: string;
  author?: string;
  content: string;
  opts: PdfExportOptions;
}

