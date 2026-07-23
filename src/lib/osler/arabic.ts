/**
 * Arabic text shaping for PDF output.
 *
 * Uses `arabic-reshaper` for battle-tested character shaping, with
 * workarounds for a known bug: when a connecting letter (4 forms) is
 * preceded by an end-letter (non-connecting, like ا د ذ ر ز و) and
 * followed by a non-Arabic character, the shaping algorithm returns
 * isolated form instead of final form.
 *
 * The fix runs in two stages:
 *   1. Pre-process: convert end-letters to final forms BEFORE shaping,
 *      so the algorithm doesn't see them as non-connecting.
 *   2. Post-process: catch any remaining incorrect isolated→final
 *      swaps after shaping.
 *
 * Also applies a Cairo font fallback — Cairo is missing 42 isolated
 * presentation-form codepoints (FE70–FEFC, FB50–FDFF) so they need
 * to be mapped back to their basic Arabic equivalents.
 *
 * @module
 */
import arabicReshaper from "arabic-reshaper";

/** Detect any Arabic characters in text. */
export function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

// ── Static data ──────────────────────────────────────────────────
// End-letter basic codepoints → final presentation form codepoints.
// Derived from Unicode Arabic Presentation Forms B (FE70–FEFF).
// These are end-letters (non-connecting) that only have isolated + final forms.
const _END_LETTER_TO_FINAL: Record<number, number> = {
  0x0622: 0xFE82, 0x0623: 0xFE84, 0x0624: 0xFE86, 0x0625: 0xFE88,
  0x0627: 0xFE8E, 0x0629: 0xFE94, 0x062F: 0xFEAA, 0x0630: 0xFEAC,
  0x0631: 0xFEAE, 0x0632: 0xFEB0, 0x0648: 0xFEEE, 0x0649: 0xFEF0,
  0x0671: 0xFB51, 0x0688: 0xFB89, 0x068C: 0xFB85, 0x068D: 0xFB83,
  0x068E: 0xFB87, 0x0691: 0xFB8D, 0x0698: 0xFB8B, 0x06BA: 0xFB9F,
  0x06C0: 0xFBA5, 0x06C5: 0xFBE1, 0x06C6: 0xFBDA, 0x06C7: 0xFBD8,
  0x06C8: 0xFBDC, 0x06C9: 0xFBE3, 0x06CB: 0xFBDF, 0x06D2: 0xFBAF,
  0x06D3: 0xFBB1,
};
const _END_LETTER_BASIC = new Set(
  Object.keys(_END_LETTER_TO_FINAL).map(Number),
);

// Cairo font isolated-form fallback (42 missing codepoints → basic char).
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

// ── Maps built dynamically from arabic-reshaper ──────────────────
// These are populated once at module load time.

/** All presentation-form codepoints of end-letters (isolated + final). */
const _PRES_END_LETTER = new Set<number>();
/** Isolated → final form codepoints for 4-form connecting letters. */
const _ISOLATED_TO_FINAL: Record<number, number> = {};

function _isArabicCp(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06FF) ||
    (cp >= 0x0750 && cp <= 0x077F) ||
    (cp >= 0x08A0 && cp <= 0x08FF) ||
    (cp >= 0xFB50 && cp <= 0xFDFF) ||
    (cp >= 0xFE70 && cp <= 0xFEFF)
  );
}

function _initMaps(): void {
  for (const basicCp of _END_LETTER_BASIC) {
    const ch = String.fromCharCode(basicCp);
    const isolated = arabicReshaper.convertArabic(ch);
    _PRES_END_LETTER.add(isolated.charCodeAt(0));
    const finalCtx = arabicReshaper.convertArabic("\u0645" + ch);
    _PRES_END_LETTER.add(finalCtx.charCodeAt(finalCtx.length - 1));
  }
  for (let cp = 0x0621; cp <= 0x06D3; cp++) {
    if (_END_LETTER_BASIC.has(cp)) continue;
    const ch = String.fromCharCode(cp);
    const isolated = arabicReshaper.convertArabic(ch);
    if (isolated.length === 0) continue;
    const finalCtx = arabicReshaper.convertArabic("\u0645" + ch);
    if (finalCtx.length === 0) continue;
    const isoCp = isolated.charCodeAt(0);
    const finalCp = finalCtx.charCodeAt(finalCtx.length - 1);
    if (isoCp !== cp && isoCp !== finalCp) {
      _ISOLATED_TO_FINAL[isoCp] = finalCp;
    }
  }
}
_initMaps();

// ── Shaping pipeline ─────────────────────────────────────────────

/** Pre-process: convert end-letters to final form when not followed by Arabic. */
function _fixEndLetters(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const finalCp = _END_LETTER_TO_FINAL[cp];
    if (finalCp && i + 1 < text.length && !_isArabicCp(text.charCodeAt(i + 1))) {
      out += String.fromCharCode(finalCp);
    } else {
      out += text[i];
    }
  }
  return out;
}

/** Post-process: swap isolated→final for connecting letters after end-letters. */
function _fixIsolatedToFinal(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const finalCp = _ISOLATED_TO_FINAL[cp];
    if (finalCp) {
      const prevCp = i > 0 ? text.charCodeAt(i - 1) : -1;
      const nextCp = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (prevCp >= 0 && _PRES_END_LETTER.has(prevCp) && !_isArabicCp(nextCp)) {
        out += String.fromCharCode(finalCp);
        continue;
      }
    }
    out += text[i];
  }
  return out;
}

/** Cairo fallback: replace missing isolated forms with basic Arabic chars. */
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
 * Shape Arabic text into presentation forms suitable for PDF rendering.
 *
 * Pipeline: fixEndLetters → arabic-reshaper → fixIsolatedToFinal → fallbackCairo.
 *
 * Letters without Arabic pass through unchanged.
 */
export function shapeArabic(text: string): string {
  if (!hasArabic(text)) return text;
  return _fallbackCairo(_fixIsolatedToFinal(arabicReshaper.convertArabic(_fixEndLetters(text))));
}

/**
 * Apply only the Cairo isolated-form fallback to already-shaped text.
 * Used as a preProcessText handler in jsPDF to fix missing glyphs after
 * jsPDF's own processArabic has run.
 */
export function fallbackArabicPres(text: string): string {
  return _fallbackCairo(text);
}
