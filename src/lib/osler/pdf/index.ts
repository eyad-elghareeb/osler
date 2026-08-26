/**
 * Osler PDF module — public entry point.
 * ─────────────────────────────────
 * Structure (one file, one concern):
 *   tokens.ts               design tokens: colors, section tints, accent themes
 *   text.ts                 markdown/HTML stripping, normalization, BiDi labels
 *   fonts.ts                font map + webfont resolution
 *   icons.ts                vector icon strokes (check / cross / pulse)
 *   layout.ts               page geometry, spacing grid, style-mode density
 *   types.ts                public config/options/result contracts
 *   doc.ts                  PdfDoc — paginated page/chrome/content model
 *   generators/*.ts         one engine per document family
 *   download.ts             filename sanitization + save
 *
 * The heavy engines (jsPDF + generators) are LAZY-LOADED: this barrel stays
 * free of static engine imports, so the dependency only downloads when an
 * export is actually triggered. Consumers always import from
 * `@/lib/osler/pdf` — never from the internal files.
 */
import type { jsPDF } from "jspdf";
import type { ArticlePdfConfig, DashboardPdfConfig, PdfExportConfig, ResultsPdfConfig } from "./types";

export type { PdfPageConfig } from "./layout";
export type {
  ArticlePdfConfig,
  CoverConfig,
  DashboardPdfConfig,
  FullQuestion,
  PdfExportConfig,
  PdfExportOptions,
  PdfLang,
  QuestionReviewItem,
  ResultsPdfConfig,
  ScoreSummaryData,
} from "./types";

export { downloadPdf } from "./download";

/** Multi-chapter quiz booklet with cover, linked TOC and answer keys. */
export async function generateQuizCompilationPdf(cfg: PdfExportConfig): Promise<jsPDF> {
  const { generateQuizCompilationPdf: generate } = await import("./generators/compilation");
  return generate(cfg);
}

/** Single-attempt session results with tutor-style answer marking. */
export async function generateResultsPdf(cfg: ResultsPdfConfig): Promise<jsPDF> {
  const { generateResultsPdf: generate } = await import("./generators/results");
  return generate(cfg);
}

/** Overall performance report with pack-by-pack breakdown. */
export async function generateDashboardPdf(cfg: DashboardPdfConfig): Promise<jsPDF> {
  const { generateDashboardPdf: generate } = await import("./generators/dashboard");
  return generate(cfg);
}

/** Library article rendered to mirror the print view. */
export async function generateArticlePdf(cfg: ArticlePdfConfig): Promise<jsPDF> {
  const { generateArticlePdf: generate } = await import("./generators/article");
  return generate(cfg);
}
