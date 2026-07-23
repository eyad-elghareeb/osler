/**
 * Arabic text shaping + bidirectional reordering for PDF output.
 *
 * The pipeline is split into TWO stages so that line-breaking happens
 * in logical order (before BiDi reordering). If we BiDi-reordered the
 * whole paragraph first and then split it into lines, the line order
 * would be reversed for multi-line Arabic — the first line would show
 * the END of the paragraph and the last line would show the BEGINNING.
 *
 * Stage 1 — `shapeArabicLetters(text)`:
 *   `arabic-reshaper` converts basic Arabic codepoints (U+0600–U+06FF)
 *   into their Presentation Forms-A/B equivalents (U+FB50–U+FDFF,
 *   U+FE70–U+FEFF) so jsPDF can render the correct contextual form
 *   (isolated / initial / medial / final) per letter. This is a
 *   battle-tested JS port of the well-known Python `arabic_reshaper`
 *   library by Louy Alakkad. The output stays in **logical order** —
 *   no reordering yet.
 *
 * Stage 2 — `bidiReorder(text)`:
 *   `bidi-js` implements the Unicode Bidirectional Algorithm (UAX #9).
 *   It is the same library PDFKit ships with (a JS port of GNU
 *   fribidi). It properly reorders mixed LTR/RTL runs (Arabic + Latin
 *   acronyms + numbers + punctuation) so that "ST", "(STEMI)", "aVF",
 *   "90", "V1" etc. keep their correct character order inside an RTL
 *   paragraph. This MUST be applied **per line** (after
 *   `splitTextToSize`), not on the whole paragraph.
 *
 * Stage 3 — Cairo fallback (applied in stage 1):
 *   Cairo (the font we ship for Arabic) is missing ~42 isolated-form
 *   codepoints, so we map those back to their basic Arabic equivalents
 *   before jsPDF tries to look up the glyph.
 *
 * @module
 */
import arabicReshaper from "arabic-reshaper";
import bidiFactory from "bidi-js";

// `bidiFactory` returns a fresh instance — we only need one.
const bidi = bidiFactory();

/** Detect any Arabic characters in text. */
export function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

// ── Cairo font fallback ──────────────────────────────────────────
// Cairo is missing 42 isolated presentation-form codepoints
// (FE70–FEFC, FB50–FDFF). When `arabic-reshaper` emits one of these
// as the isolated form, jsPDF cannot find the glyph and renders a
// blank box. We map them back to their basic Arabic equivalents,
// which Cairo does ship. After mapping, the visual glyph is
// identical because the isolated presentation form and the basic
// codepoint are designed to render the same way.
//
// IMPORTANT: this map is intentionally keyed on the *isolated*
// presentation form codepoints only. Initial/medial/final forms are
// all present in Cairo and must NOT be replaced — replacing them
// would break the cursive joining.
const _CAIRO_FALLBACK: Record<number, number> = {
  0xFE80: 0x0621, 0xFE81: 0x0622, 0xFE83: 0x0623, 0xFE85: 0x0624,
  0xFE87: 0x0625, 0xFE89: 0x0626, 0xFE8D: 0x0627, 0xFE8F: 0x0628,
  0xFE93: 0x0629, 0xFE95: 0x062A, 0xFE99: 0x062B, 0xFE9D: 0x062C,
  0xFEA1: 0x062D, 0xFEA5: 0x062E, 0xFEA9: 0x062F, 0xFEAB: 0x0630,
  0xFEAD: 0x0631, 0xFEAF: 0x0632, 0xFEB1: 0x0633, 0xFEB5: 0x0634,
  0xFEB9: 0x0635, 0xFEBD: 0x0636, 0xFEC1: 0x0637, 0xFEC5: 0x0638,
  0xFEC9: 0x0639, 0xFECD: 0x063A, 0xFED1: 0x0641, 0xFED5: 0x0642,
  0xFED9: 0x0643, 0xFEDD: 0x0644, 0xFEE1: 0x0645, 0xFEE5: 0x0646,
  0xFEE9: 0x0647, 0xFEED: 0x0648, 0xFEEF: 0x0649, 0xFEF1: 0x064A,
  0xFB56: 0x067E, 0xFB7A: 0x0686, 0xFB8A: 0x0698,
  0xFB8E: 0x06A9, 0xFB92: 0x06AF, 0xFBFC: 0x06CC,
};

function _fallbackCairo(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const fb = _CAIRO_FALLBACK[cp];
    out += fb ? String.fromCharCode(fb) : text[i];
  }
  return out;
}

/**
 * Stage 1: Shape Arabic letters into contextual presentation forms.
 *
 * Uses `arabic-reshaper` for letter-joining, ligatures (LAM-ALEF),
 * and transparent diacritics. The output stays in **logical order**
 * (no BiDi reordering) so that `splitTextToSize` can break it into
 * lines at the correct word boundaries. After line-breaking, call
 * `bidiReorder()` on each line to get visual order.
 *
 * Also applies the Cairo isolated-form fallback.
 */
export function shapeArabicLetters(text: string): string {
  if (!hasArabic(text)) return text;
  return _fallbackCairo(arabicReshaper.convertArabic(text));
}

/**
 * Stage 2: Apply the Unicode Bidirectional Algorithm to reorder a
 * single line of text into visual order.
 *
 * `bidi-js` is a port of GNU fribidi and properly handles:
 *   - strong LTR (Latin letters, Latin digits) inside RTL paragraphs
 *   - neutral characters (punctuation, spaces) adopting the
 *     surrounding direction
 *   - mirrored characters (parentheses, brackets) flipping to
 *     their visual mirror in RTL runs
 *   - nested isolates and embeddings
 *
 * MUST be called **per line** (after `splitTextToSize`), not on the
 * whole paragraph. Calling it on the whole paragraph before line-
 * breaking reverses the line order for multi-line Arabic.
 */
export function bidiReorder(text: string): string {
  if (!hasArabic(text)) return text;
  const levels = bidi.getEmbeddingLevels(text);
  return bidi.getReorderedString(text, levels);
}

/**
 * Convenience: shape + BiDi in one call, for SINGLE-LINE text only.
 *
 * For multi-line text (anything that will be passed to
 * `splitTextToSize`), use `shapeArabicLetters` first, then
 * `bidiReorder` per line. Using this on multi-line text will reverse
 * the line order.
 */
export function shapeArabic(text: string): string {
  if (!hasArabic(text)) return text;
  return bidiReorder(shapeArabicLetters(text));
}

/**
 * Apply only the Cairo isolated-form fallback to already-shaped text.
 *
 * Kept for backwards compatibility with the `preProcessText` hook in
 * `pdf.ts`, which runs on every string jsPDF touches (including ones
 * we've already shaped) — running the full pipeline again there would
 * double-shape. The fallback is idempotent, so it's safe to apply
 * repeatedly.
 */
export function fallbackArabicPres(text: string): string {
  if (!hasArabic(text)) return text;
  return _fallbackCairo(text);
}
