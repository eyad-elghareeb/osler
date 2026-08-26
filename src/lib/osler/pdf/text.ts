/**
 * Text utilities — every string destined for the page passes through this
 * module: markdown stripping, smart-punctuation normalization, HTML tag
 * stripping, BiDi-safe label helpers, and the i18n binding for template
 * strings.
 */
import { hasArabic } from "@/lib/osler/arabic";
import { translate, type StringKey } from "@/lib/osler/i18n";
import type { PdfLang } from "./types";

/** A `t()` helper bound to a specific language. */
export function makeT(lang: PdfLang) {
  return (key: StringKey, params?: Record<string, string | number>) =>
    translate(lang, key, params);
}

;


export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function stripMd(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

/** Normalize smart punctuation & symbols core PDF fonts can't render. */
export function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "*")
    .replace(/\u00B7/g, ".")
    .replace(/\u2190/g, "<-")
    .replace(/\u2192/g, "->")
    .replace(/\u2194/g, "<->")
    .replace(/\u2713|\u2714/g, "[v]")
    .replace(/\u2717|\u2718/g, "[x]")
    .replace(/\u25BA|\u25B6/g, ">")
    .replace(/\u2002|\u2003|\u00A0/g, " ")
    // Insert ZWNJ between Arabic letters and Arabic punctuation so that
    // jsPDF's processArabic does not treat punctuation as a connecting letter.
    .replace(/([\u0621-\u064A\u0671-\u06D3])([\u060C\u061B\u061F\u066A-\u066D])/g, '$1\u200C$2')
    .replace(/([\u060C\u061B\u061F\u066A-\u066D])([\u0621-\u064A\u0671-\u06D3])/g, '$1\u200C$2')
    .trim();
}

/** Strip HTML tags, preserving paragraph/heading breaks. */
export function stripHtml(text: string): string {
  if (!text) return "";
  const s = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

// hasArabic, shapeArabic, shapeArabicLetters, bidiReorder imported from @/lib/osler/arabic

/**
 * Split text into lines for a given max width, then BiDi-reorder each
 * line independently.
 *
 * For Arabic text, the line-breaking MUST happen in logical order
 * (before BiDi reordering). If we BiDi-reordered the whole paragraph
 * first and then split, the line order would be reversed — the first
 * line would show the END of the paragraph and the last line would
 * show the BEGINNING.
 *
 * So the correct sequence is:
 *   1. `shapeArabicLetters(text)` — shape into presentation forms,
 *      keep logical order
 *   2. `splitTextToSize(shaped, maxW)` — break into lines at word
 *      boundaries (still logical order)
 *   3. `bidiReorder(line)` per line — reorder each line into visual
 *      order
 *
 * For non-Arabic text, this just delegates to `splitTextToSize`.
 */
export function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "\u2026";
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** English ordinal suffix — 1st / 2nd / 3rd / 4th / 11th-13th → "th". */
export function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/** Small-caps tracking via inter-character spacing (no kerning API in core PDF text). */
export function tracked(text: string): string {
  return text.split("").join(" ");
}

/**
 * Render a label string: for Arabic, return as-is (jsPDF's built-in
 * processArabic handles letter shaping inside d.text()); for non-Arabic,
 * apply letter-spacing tracking.
 *
 * Use this instead of `tracked()` whenever the string could be Arabic
 * (i18n labels, user-supplied titles, etc.).  Applying letter-spacing
 * to Arabic breaks cursive joining, so `tracked` is skipped for Arabic.
 */
export function tlabel(text: string): string {
  return hasArabic(text) ? text : tracked(text);
}
