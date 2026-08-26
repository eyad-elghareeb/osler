/**
 * Osler PDF Engine
 * ─────────────────
 * A single, self-contained module that produces every PDF export Osler
 * offers (quiz results, dashboard performance reports, library articles,
 * and multi-chapter quiz booklets) from one shared design system.
 *
 * Design principles
 *   · Editorial premium cover — soft vignette, hairline double frame,
 *     corner registration ticks, a drawn brand mark, restrained gold accents.
 *   · Quiet running chrome — a slim header rule + tracked-caps title/section
 *     pill, a footer with real "NN / total" pagination and a brand line.
 *   · One spacing/type system: `typeScale` adapts to page size (A3 vs A5),
 *     `density` adapts to style mode (compact vs. spacious) — the two never
 *     get conflated, so every option in the export dialog visibly does
 *     something on every document type.
 *   · All on-page text is routed through a single drawing primitive that
 *     strips markdown, normalizes smart punctuation, and switches to Cairo
 *     for Arabic — no direct calls to the underlying library, so nothing
 *     can silently skip normalization.
 *   · Icons (check / cross / bullet) are drawn as small vector strokes, not
 *     Unicode glyphs — core PDF fonts don't reliably carry glyphs like ✓.
 *   · Real two-column flow: content actually fills the left column, then
 *     the right, then a new page — not a cosmetic narrower margin.
 *   · TOC hyperlinks are computed with a two-pass render (a silent measure
 *     pass discovers real page numbers, a second pass renders with them)
 *     rather than an assumed page count, so links are correct regardless of
 *     how long each chapter runs.
 *   · Native PDF outline (bookmarks) for Cover / Contents / each chapter /
 *     Answer Key, plus document metadata (title/author/creator).
 *
 * Typography: Poppins (headings, labels, UI chrome) + Lora (body serif) +
 * Cairo (Arabic). Falls back to core Helvetica/Times when a webfont hasn't
 * finished loading.
 */

import { jsPDF } from "jspdf";
import { registerPdfFonts } from "./pdf-fonts";
import { hasArabic, fallbackArabicPres, shapeArabicLetters, bidiReorder } from "@/lib/osler/arabic";
import { translate, type UiLang, type StringKey } from "@/lib/osler/i18n";

// ═══════════════════════════════════════════════════════════════
// § 1  DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════

type RGB = [number, number, number];

export const C = {
  INK: [17, 24, 39] as RGB, // primary heading ink
  NAVY: [12, 28, 48] as RGB, // brand navy — cover base
  NAVY_DEEP: [7, 17, 30] as RGB, // vignette edge
  NAVY_SOFT: [22, 46, 74] as RGB, // vignette center highlight
  COBALT: [27, 56, 88] as RGB,
  ROYAL: [32, 89, 156] as RGB,
  PALE_BLUE: [232, 240, 249] as RGB,

  GOLD: [176, 133, 45] as RGB, // refined foil gold
  GOLD_SOFT: [214, 184, 128] as RGB, // gold on dark backgrounds
  GOLD_DEEP: [140, 103, 30] as RGB,

  EMERALD: [15, 94, 62] as RGB,
  SAGE: [30, 128, 92] as RGB,
  PALE_GREEN: [230, 244, 238] as RGB,

  CRIMSON: [151, 45, 45] as RGB,
  PALE_ROSE: [250, 234, 234] as RGB,

  CHARCOAL: [30, 32, 38] as RGB,
  SLATE: [72, 82, 97] as RGB,
  MUTED: [121, 131, 147] as RGB,
  RULE: [223, 228, 236] as RGB,
  RULE_SOFT: [237, 240, 245] as RGB,
  PAPER: [249, 249, 247] as RGB,
  WHITE: [255, 255, 255] as RGB,
  LINK: [32, 89, 156] as RGB,

  SECTION: {
    cover: { bg: [255, 255, 255], fg: [255, 255, 255] },
    contents: { bg: [231, 233, 244], fg: [64, 68, 122] },
    questions: { bg: [230, 237, 246], fg: [37, 78, 124] },
    answers: { bg: [227, 242, 235], fg: [17, 100, 68] },
    report: { bg: [246, 238, 224], fg: [138, 100, 26] },
    article: { bg: [243, 233, 235], fg: [124, 62, 76] },
  } as Record<string, { bg: RGB; fg: RGB }>,
};

type SectionKey = keyof typeof C.SECTION;

// ═══════════════════════════════════════════════════════════════
// § 1a  DOCUMENT THEMES  —  per-export accent identity
// ═══════════════════════════════════════════════════════════════

/**
 * Each export family carries its own subtle cover/accent palette so a
 * printed stack is identifiable at a glance:
 *   · content — quiz booklets & packs (navy + gold, the classic Osler look)
 *   · session — session results & performance reports (indigo + champagne)
 *   · article — library article exports (wine + rose gold)
 */
export type PdfDocTheme = "content" | "session" | "article";

interface ThemePalette {
  base: RGB;
  baseDeep: RGB;
  baseSoft: RGB;
  accent: RGB;
  accentSoft: RGB;
  accentDeep: RGB;
  pulseRing: RGB;
  coverMeta: RGB;
  coverBody: RGB;
}

const DOC_THEMES: Record<PdfDocTheme, ThemePalette> = {
  content: {
    base: C.NAVY,
    baseDeep: C.NAVY_DEEP,
    baseSoft: C.NAVY_SOFT,
    accent: C.GOLD,
    accentSoft: C.GOLD_SOFT,
    accentDeep: C.GOLD_DEEP,
    pulseRing: [90, 118, 148],
    coverMeta: [160, 182, 208],
    coverBody: [206, 222, 240],
  },
  session: {
    base: [25, 25, 55],
    baseDeep: [14, 14, 34],
    baseSoft: [42, 42, 86],
    accent: [118, 106, 176],
    accentSoft: [186, 178, 220],
    accentDeep: [88, 78, 138],
    pulseRing: [112, 112, 164],
    coverMeta: [166, 166, 202],
    coverBody: [212, 210, 236],
  },
  article: {
    base: [44, 16, 26],
    baseDeep: [27, 9, 16],
    baseSoft: [72, 29, 44],
    accent: [172, 106, 94],
    accentSoft: [218, 164, 148],
    accentDeep: [134, 78, 68],
    pulseRing: [148, 102, 94],
    coverMeta: [204, 170, 162],
    coverBody: [234, 208, 200],
  },
};

// ═══════════════════════════════════════════════════════════════
// § 1b  I18N HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * The UI language to use for PDF template strings (QUESTION, EXPLANATION,
 * CHAPTER, etc.). Defaults to "en" if not specified. When set to "ar",
 * all chrome text is translated to Arabic and rendered RTL.
 */
export type PdfLang = UiLang;

/** A `t()` helper bound to a specific language. */
function makeT(lang: PdfLang) {
  return (key: StringKey, params?: Record<string, string | number>) =>
    translate(lang, key, params);
}

/** Style-mode → spacing density. Font sizes never shrink; whitespace does. */
type StyleMode = "standard" | "compact" | "mcqnotes";
const DENSITY: Record<StyleMode, number> = {
  standard: 0.95,
  compact: 0.72,
  mcqnotes: 0.55,
};

// ═══════════════════════════════════════════════════════════════
// § 2  SPACING GRID
// ═══════════════════════════════════════════════════════════════

/** 4pt base grid, scaled by density (style mode), never by type size. */
function sp(n: number, density = 1.0): number {
  return Math.round(n * 4 * density * 10) / 10;
}

function lh(sizePt: number, factor = 1.45): number {
  return sizePt * factor * 0.3528;
}

// ═══════════════════════════════════════════════════════════════
// § 3  TEXT UTILITIES  —  every string reaches the page through these
// ═══════════════════════════════════════════════════════════════

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function stripMd(text: string): string {
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
function normalizeText(text: string): string {
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
function stripHtml(text: string): string {
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
function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "\u2026";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** English ordinal suffix — 1st / 2nd / 3rd / 4th / 11th-13th → "th". */
function ordinalSuffix(n: number): string {
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
function tracked(text: string): string {
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
function tlabel(text: string): string {
  return hasArabic(text) ? text : tracked(text);
}

// ═══════════════════════════════════════════════════════════════
// § 4  FONT RESOLUTION
// ═══════════════════════════════════════════════════════════════

const F = {
  H: "helvetica", // heading bold
  Hn: "helvetica", // heading normal
  Hm: "helvetica", // heading medium
  Hl: "helvetica", // heading light
  B: "times", // body normal (serif)
  Bi: "times", // body italic
  Bb: "helvetica", // body emphasis (sans, used inline within serif body)
  // Arabic font variants — filled by resolveFonts() when Cairo weights are registered
  Ar: "Cairo", // arabic body normal (style: "bold" for bold)
  Arm: "Cairo", // arabic medium/emphasis (Cairo-Medium when available)
};

function resolveFonts(doc: jsPDF, fontType: "serif" | "sans" = "serif"): void {
  const fl = doc.getFontList();
  if (fl.Poppins) {
    F.H = "Poppins";
    F.Hn = "Poppins";
    F.Hm = fl["Poppins-Medium"] ? "Poppins-Medium" : "Poppins";
    F.Hl = fl["Poppins-Light"] ? "Poppins-Light" : "Poppins";
    F.Bb = fl["Poppins-Medium"] ? "Poppins-Medium" : "Poppins";
  }
  if (fontType === "sans") {
    F.B = fl.Poppins ? "Poppins" : "helvetica";
    F.Bi = fl.Poppins ? "Poppins" : "helvetica";
  } else {
    if (fl.Lora) {
      F.B = "Lora";
      F.Bi = "Lora";
    } else {
      F.B = "times";
      F.Bi = "times";
    }
  }
  // Cairo Arabic weight variants — maps to F.Ar / F.Arm
  if (fl.Cairo) {
    F.Ar = "Cairo";
    F.Arm = fl["Cairo-Medium"] ? "Cairo-Medium" : "Cairo";
  }
}

function hs(style: string): string {
  if (style === "bold") return "bold";
  if (style === "italic") return "italic";
  if (style === "bolditalic") return "bolditalic";
  return "normal";
}

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ═══════════════════════════════════════════════════════════════
// § 5  VECTOR ICONS  —  drawn strokes, never relying on Unicode glyphs
// ═══════════════════════════════════════════════════════════════

function drawCheck(doc: jsPDF, cx: number, cy: number, s: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(Math.max(0.35, s * 0.22));
  doc.setLineCap(1);
  doc.line(cx - s * 0.5, cy + s * 0.02, cx - s * 0.12, cy + s * 0.42);
  doc.line(cx - s * 0.12, cy + s * 0.42, cx + s * 0.55, cy - s * 0.42);
  doc.setLineCap(0);
}

function drawCross(doc: jsPDF, cx: number, cy: number, s: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(Math.max(0.35, s * 0.2));
  doc.setLineCap(1);
  doc.line(cx - s * 0.4, cy - s * 0.4, cx + s * 0.4, cy + s * 0.4);
  doc.line(cx - s * 0.4, cy + s * 0.4, cx + s * 0.4, cy - s * 0.4);
  doc.setLineCap(0);
}

/** A small drawn pulse/heartbeat line inside a hairline circle — Osler's mark. */
function drawPulseMark(doc: jsPDF, cx: number, cy: number, r: number, ring: RGB, line: RGB): void {
  doc.setDrawColor(...ring);
  doc.setLineWidth(Math.max(0.3, r * 0.045));
  doc.circle(cx, cy, r, "S");
  const w = r * 1.05;
  const pts: [number, number][] = [
    [cx - w, cy],
    [cx - w * 0.5, cy],
    [cx - w * 0.24, cy - r * 0.7],
    [cx + w * 0.02, cy + r * 0.7],
    [cx + w * 0.28, cy - r * 0.32],
    [cx + w * 0.5, cy],
    [cx + w, cy],
  ];
  doc.setDrawColor(...line);
  doc.setLineWidth(Math.max(0.35, r * 0.065));
  doc.setLineCap(1);
  doc.setLineJoin(1);
  for (let i = 0; i < pts.length - 1; i++) {
    doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }
  doc.setLineCap(0);
  doc.setLineJoin(0);
}

// ═══════════════════════════════════════════════════════════════
// § 6  PAGE LAYOUT
// ═══════════════════════════════════════════════════════════════

export interface PdfPageConfig {
  pageSize: "a4" | "a3" | "a5" | "letter";
  orientation: "portrait" | "landscape";
}

const PAGE_DIMS: Record<string, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  a5: [148, 210],
  letter: [216, 279],
};

interface Layout {
  pw: number;
  ph: number;
  ms: number; // side margin
  mt: number; // top margin (below header)
  mb: number; // bottom margin (above footer)
  gu: number; // column gutter
  hh: number; // header block height
  fh: number; // footer block height
  fw: number; // full content width
  cw: number; // single-column width in two-col mode
  typeScale: number; // page-size driven — affects font sizes
  density: number; // style-mode driven — affects spacing only
  fontSizeMultiplier: number;
  fontType: "serif" | "sans";
}

function computeLayout(cfg: PdfPageConfig, styleMode: StyleMode, fontSizeOpt?: "small" | "medium" | "large", fontTypeOpt?: "serif" | "sans"): Layout {
  let [pw, ph] = PAGE_DIMS[cfg.pageSize] ?? PAGE_DIMS.a4;
  if (cfg.orientation === "landscape") [pw, ph] = [ph, pw];
  const pageScale = pw / 210;
  const typeScale = clamp(pageScale, 0.82, 1.18);
  const density = DENSITY[styleMode] ?? 1.0;
  const pt2mm = (pt: number) => Math.max(3, +(pt * pageScale * 0.3528).toFixed(2));
  const ms = pt2mm(26);
  const mt = pt2mm(48);
  const mb = pt2mm(32);
  const gu = pt2mm(14);
  const hh = pt2mm(26);
  const fh = pt2mm(18);

  const fontSizeMultiplier = fontSizeOpt === "small" ? 0.85 : fontSizeOpt === "large" ? 1.15 : 1.0;
  const fontType = fontTypeOpt ?? "serif";

  return {
    pw,
    ph,
    ms,
    mt,
    mb,
    gu,
    hh,
    fh,
    fw: pw - 2 * ms,
    cw: (pw - 2 * ms - gu) / 2,
    typeScale,
    density,
    fontSizeMultiplier,
    fontType,
  };
}

// ═══════════════════════════════════════════════════════════════
// § 7  PDF DOCUMENT CLASS
// ═══════════════════════════════════════════════════════════════

class PdfDoc {
  doc: jsPDF;
  L: Layout;
  y = 0;
  page = 1;
  title: string;
  lang: PdfLang;
  t: (key: StringKey, params?: Record<string, string | number>) => string;

  headerLabel = "";
  section: SectionKey = "questions";

  /** Accent palette for this document family (see `PdfDocTheme`). */
  T: ThemePalette;

  colX = 0;
  col: 0 | 1 = 0;
  colTopY = 0;
  twoColEnabled = false;

  /** Chapter number → the physical page it starts on (for TOC + bookmarks). */
  chapterPages: number[] = [];

  /**
   * Pending "See Answer Key" link annotations. Each entry records the
   * position of a "See Answer Key" text on a question page plus the
   * question number it belongs to. When the matching answer block's page
   * is known, `resolveAnswerKeyLinks()` adds `doc.link()` annotations
   * pointing at that question's answer directly.
   */
  pendingAnswerKeyLinks: Array<{ page: number; x: number; y: number; w: number; h: number; chapterIdx: number; qNum: number }> = [];

  /** Question number → physical page its answer block was drawn on. */
  answerPages: Record<number, number> = {};

  constructor(cfg: PdfPageConfig, title: string, styleMode: StyleMode, fontSizeOpt?: "small" | "medium" | "large", fontTypeOpt?: "serif" | "sans", lang: PdfLang = "en", theme: PdfDocTheme = "content") {
    this.L = computeLayout(cfg, styleMode, fontSizeOpt, fontTypeOpt);
    this.title = title;
    this.lang = lang;
    this.t = makeT(lang);
    this.T = DOC_THEMES[theme] ?? DOC_THEMES.content;
    this.doc = new jsPDF({ orientation: cfg.orientation, unit: "mm", format: cfg.pageSize });
    (this.doc as any).internal.events.subscribe("preProcessText", (args: any) => {
      const t = args.text;
      if (typeof t === "string") {
        args.text = fallbackArabicPres(t);
      } else if (Array.isArray(t)) {
        for (let i = 0; i < t.length; i++) {
          if (Array.isArray(t[i])) {
            t[i][0] = fallbackArabicPres(t[i][0]);
          } else if (typeof t[i] === "string") {
            t[i] = fallbackArabicPres(t[i]);
          }
        }
      }
    });
    // jsPDF ships its own preProcessText hook (`processArabic`) that
    // re-shapes Arabic letters based on their neighbors in the string —
    // but by the time text reaches this hook, our doc.text wrapper below
    // has ALREADY shaped + bidi-reordered it into final visual order. On
    // a reordered string, "neighboring" characters are no longer logical
    // neighbors, so jsPDF's re-shaping can spuriously trigger things like
    // a LAM-ALEF ligature merge wherever a reordered lam happens to land
    // next to an alef — corrupting words such as "المزمن" into a garbled
    // "لامزمن"-looking result. That corruption is especially likely for
    // the handful of isolated-form letters our Cairo-fallback map (just
    // above / in arabic.ts) converts back to basic codepoints, since only
    // basic codepoints are recognized by jsPDF's re-shaper.
    // We already do correct, adjacency-aware shaping ourselves (see the
    // doc.text wrapper below), so we remove jsPDF's own hook for this
    // document instance. This doesn't affect `splitTextToSize`/width
    // measurement, which calls `processArabic` directly rather than via
    // this event.
    {
      const topics = (this.doc as any).internal.events.getTopics?.();
      const builtinProcessArabic = (this.doc as any).processArabic;
      if (topics?.preProcessText && builtinProcessArabic) {
        for (const token of Object.keys(topics.preProcessText)) {
          if (topics.preProcessText[token][0] === builtinProcessArabic) {
            delete topics.preProcessText[token];
          }
        }
      }
    }
    this.doc.setLineHeightFactor(1.15);
    this.y = this.L.mt;
    const registered = registerPdfFonts(this.doc);
    if (!registered && typeof console !== "undefined") {
      console.warn("[osler/pdf] Custom fonts were not ready in time — falling back to core PDF fonts.");
    }
    resolveFonts(this.doc, this.L.fontType);

    // Every d.text() call with Arabic text is bidi-reordered here, once,
    // for the whole document — instead of relying on jsPDF's own built-in
    // `__bidiEngine__` (via isInputVisual/isOutputVisual). That engine is a
    // simplified UAX#9 implementation that mis-reorders lines containing
    // multiple direction changes — e.g. a Latin acronym in parentheses
    // sitting mid-sentence in an Arabic paragraph ("... وبلغم (COPD) مريض
    // ...") — and can shuffle whole phrases rather than just the acronym.
    //
    // `bidi-js` (the same library PDFKit ships with) is a much more
    // complete implementation and already lived in ./arabic.ts, unused.
    // We now run its two-stage pipeline ourselves, per line, right before
    // the text reaches jsPDF:
    //   1. `shapeArabicLetters` — contextual letter shaping, logical order
    //   2. `bidiReorder`        — UAX#9 reordering into visual order
    // and then tell jsPDF the text is already in final visual order
    // (isInputVisual=true, isOutputVisual=true — a no-op for its own
    // engine) so it doesn't reorder it a second time.
    //
    // Shaping must run BEFORE reordering (not after, and not left to
    // jsPDF's own preProcessText hook here) because letter-joining forms
    // depend on *logical* adjacency; reordering first would compute joins
    // against the wrong neighbours. jsPDF's built-in `processArabic`
    // shaping hook still fires after this, but it only recognizes basic
    // Arabic-block codepoints (U+0600–U+06FF); since our text is already
    // in presentation-form codepoints by then, it's a safe no-op.
    {
      const doc = this.doc;
      const origText: any = doc.text.bind(doc);
      const toVisual = (line: string) => bidiReorder(shapeArabicLetters(line));
      doc.text = ((text: any, x: number, y: number, options?: any, ...rest: any[]) => {
        const isArr = Array.isArray(text);
        const containsArabic = isArr
          ? text.some((t: any) => (typeof t === "string" ? hasArabic(t) : Array.isArray(t) && typeof t[0] === "string" && hasArabic(t[0])))
          : typeof text === "string" && hasArabic(text);

        if (containsArabic) {
          text = isArr
            ? text.map((t: any) => {
                if (typeof t === "string") return toVisual(t);
                if (Array.isArray(t)) return [toVisual(t[0]), t[1], t[2]];
                return t;
              })
            : toVisual(text);
          options = { ...options, isInputVisual: true, isOutputVisual: true };
        }
        return origText(text, x, y, options, ...rest);
      }) as any;
    }
  }

  // ── Metadata ──

  setMeta(meta: { title: string; author?: string; subject?: string }): void {
    this.doc.setDocumentProperties({
      title: meta.title,
      author: meta.author || "Osler",
      creator: "Osler",
      subject: meta.subject ?? "Generated by Osler",
    });
  }

  /** Locale-aware long date for covers/meta lines — follows the doc language
   *  instead of hardcoding en-US (which printed English month names in AR
   *  documents). */
  formatToday(): string {
    return this.formatDate(Date.now());
  }

  formatDate(ts: number | Date): string {
    return new Date(ts).toLocaleDateString(this.lang === "ar" ? "ar" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // ── Bookmarks (native PDF outline) ──

  addBookmark(title: string, parent: unknown = null): unknown {
    try {
      return this.doc.outline.add(parent as never, title, { pageNumber: this.page });
    } catch {
      return null;
    }
  }

  // ── Page chrome ──

  setHeader(label: string, section: SectionKey): void {
    this.headerLabel = label;
    this.section = section;
  }

  drawChrome(): void {
    const d = this.doc;
    const { pw, ph, ms, hh, fh, typeScale } = this.L;
    const tint = C.SECTION[this.section];

    // Top hairline — the one saturated line on every content page (theme accent).
    d.setFillColor(...this.T.accent);
    d.rect(0, 0, pw, 0.85, "F");

    // Header band = space between the accent hairline and the header rule.
    // The pill floats exactly midway in that band; label & title baselines
    // are offset by half their cap height so both read optically centered.
    const bandCenter = (0.85 + hh) / 2;
    const capMm = (fontPx: number) => (fontPx * 0.3528 * 0.72) / 2;

    const titleAr = hasArabic(this.title);

    let pillW = 0;
    if (this.headerLabel) {
      const headerAr = hasArabic(this.headerLabel);
      const label = headerAr ? this.headerLabel : tracked(this.headerLabel.toUpperCase());
      d.setFont(headerAr ? "Cairo" : F.H, hs("bold"));
      d.setFontSize(6.4 * typeScale);
      const padX = 4.2;
      pillW = d.getTextWidth(label) + padX * 2;
      const pillH = 5.6 * typeScale;
      const pillX = titleAr ? ms : pw - ms - pillW;
      const pillY = bandCenter - pillH / 2;
      d.setFillColor(...tint.bg);
      d.roundedRect(pillX, pillY, pillW, pillH, pillH / 2, pillH / 2, "F");
      d.setTextColor(...tint.fg);
      d.text(label, pillX + pillW / 2, bandCenter + capMm(6.4 * typeScale), { align: "center" });
    }

    // Document title, tracked small caps — left for LTR docs, right for
    // Arabic ones. Truncated to the space that actually remains next to the
    // pill: tracked caps expand ~2×, which previously let long titles run
    // underneath it.
    const baseline = bandCenter + capMm(7.4 * typeScale);
    const maxTitleW = this.L.fw - (pillW ? pillW + 5 : 0);
    d.setFont(titleAr ? "Cairo" : F.Hm, hs("normal"));
    d.setFontSize(7.4 * typeScale);
    d.setTextColor(...C.INK);
    let titleRaw = trunc(this.title, 52);
    if (titleAr) {
      while (titleRaw.length > 2 && d.getTextWidth(`${titleRaw}\u2026`) > maxTitleW) {
        titleRaw = titleRaw.slice(0, -1);
      }
      d.text(d.getTextWidth(titleRaw) > maxTitleW ? `${titleRaw}\u2026` : titleRaw, ms + this.L.fw, baseline, { align: "right" });
    } else {
      const fitsTracked = (s: string) => d.getTextWidth(tracked(s.toUpperCase())) <= maxTitleW;
      if (!fitsTracked(titleRaw)) {
        while (titleRaw.length > 2 && !fitsTracked(`${titleRaw}\u2026`)) {
          titleRaw = titleRaw.slice(0, -1);
        }
        titleRaw = `${titleRaw}\u2026`;
      }
      d.text(tracked(titleRaw.toUpperCase()), ms, baseline);
    }

    // Header rule.
    d.setDrawColor(...C.RULE);
    d.setLineWidth(0.3);
    d.line(ms, hh, pw - ms, hh);

    // Two-column divider — drawn only while a two-column question flow is
    // actually active. Full-width sections (chapter openers, answer key,
    // review, report) must never get a stray divider through their content.
    if (this.twoColEnabled && this.section === "questions") {
      d.setDrawColor(...C.RULE_SOFT);
      d.setLineWidth(0.25);
      d.line(ms + this.L.cw + this.L.gu / 2, this.L.mt, ms + this.L.cw + this.L.gu / 2, ph - this.L.mb);
    }

    // Footer rule.
    const footerRuleY = ph - fh;
    d.setDrawColor(...C.RULE);
    d.setLineWidth(0.3);
    d.line(ms, footerRuleY, pw - ms, footerRuleY);

    const footerBaseline = ph - fh * 0.34;

    // Footer mirrors with the header: brand wordmark on the reading-start
    // corner, short doc title on the opposite edge.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(6.2 * typeScale);
    d.setTextColor(...C.MUTED);
    if (titleAr) {
      d.text(tracked("OSLER"), pw - ms, footerBaseline, { align: "right" });
    } else {
      d.text(tracked("OSLER"), ms, footerBaseline);
    }

    // Short doc title (helps loose printed pages find their way home).
    const shortTitle = trunc(this.title, 34);
    d.setFont(hasArabic(shortTitle) ? "Cairo" : F.Hl, hs("normal"));
    d.setFontSize(6.2 * typeScale);
    d.setTextColor(...C.MUTED);
    if (titleAr) {
      d.text(shortTitle, ms, footerBaseline);
    } else {
      d.text(shortTitle, pw - ms, footerBaseline, { align: "right" });
    }

    // Page-number slot is intentionally left blank — stamped in finalize()
    // once the true page count is known.
  }

  private drawFooterPageNumber(current: number, total: number): void {
    const d = this.doc;
    const { pw, fh, ph, typeScale } = this.L;
    const y = ph - fh * 0.34;
    const cur = String(current).padStart(2, "0");
    const rest = ` / ${String(total).padStart(2, "0")}`;

    d.setFont(F.H, hs("bold"));
    d.setFontSize(7 * typeScale);
    const w1 = d.getTextWidth(cur);
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7 * typeScale);
    const w2 = d.getTextWidth(rest);

    let x = pw / 2 - (w1 + w2) / 2;
    d.setFont(F.H, hs("bold"));
    d.setTextColor(...C.INK);
    d.text(cur, x, y);
    x += w1;
    d.setFont(F.Hn, hs("normal"));
    d.setTextColor(...C.MUTED);
    d.text(rest, x, y);
  }

  /** Loops every rendered content page and stamps accurate "NN / total" numbers. */
  finalize(contentStartPage: number): void {
    const totalPages = this.doc.getNumberOfPages();
    const totalNumbered = Math.max(1, totalPages - contentStartPage + 1);
    for (let p = contentStartPage; p <= totalPages; p++) {
      this.doc.setPage(p);
      this.drawFooterPageNumber(p - contentStartPage + 1, totalNumbered);
    }
    this.doc.setPage(totalPages);
  }

  /**
   * Finalizes the current page's chrome, creates a new page, optionally
   * switches the running header label/section, and draws chrome for the
   * new page. Passing `header` here (rather than calling `setHeader()`
   * mid-page) is what keeps section transitions — Contents → Questions,
   * Questions → Answer Key, etc. — from drawing two overlapping header
   * pills on the same page.
   */
  /**
   * Starts a fresh page and draws its chrome exactly once. The previous
   * "redraw chrome on page exit" pass double-printed every hairline/text
   * stroke and made flowing layout flags impossible to change cleanly at
   * section boundaries. `twoCol` explicitly sets the column-flow mode for
   * the new page; any non-question section always flows single-column.
   */
  newPage(opts: { header?: { label: string; section: SectionKey }; twoCol?: boolean } = {}): void {
    this.doc.addPage();
    this.page++;
    this.col = 0;
    this.colX = this.L.ms;
    this.y = this.L.mt;
    this.colTopY = this.L.mt;
    if (opts.twoCol !== undefined) this.twoColEnabled = opts.twoCol;
    if (opts.header) {
      this.headerLabel = opts.header.label;
      this.section = opts.header.section;
      if (opts.header.section !== "questions") this.twoColEnabled = false;
    }
    this.drawChrome();
  }

  /** Start (or restart) a flowing content region — plain single column, or real two-column. */
  beginFlow(twoCol: boolean): void {
    this.twoColEnabled = twoCol;
    this.col = 0;
    this.colX = this.L.ms;
    this.colTopY = this.y;
  }

  /**
   * Ensure `needed` mm of vertical room exists at the current position.
   * In two-column mode, an overflowing left column flips to the right
   * column at the same top instead of jumping straight to a new page.
   */
  checkPage(needed: number): void {
    if (this.y + needed <= this.L.ph - this.L.mb) return;
    if (this.twoColEnabled && this.col === 0) {
      this.col = 1;
      this.colX = this.L.ms + this.L.cw + this.L.gu;
      this.y = this.colTopY;
    } else {
      this.newPage();
    }
  }

  // ── Drawing primitives ──

  /** The single text-drawing entry point: markdown-strips, normalizes, and RTL-switches. */
  text(
    str: string,
    x: number,
    y: number,
    opts: {
      font?: "H" | "Hn" | "Hm" | "Hl" | "B" | "Bi" | "Bb";
      style?: "normal" | "bold" | "italic" | "bolditalic";
      size?: number;
      color?: RGB;
      align?: "left" | "center" | "right";
      maxW?: number;
      lineFactor?: number;
      /**
       * Flowing mode: chunk lines through `checkPage` so long stems /
       * paragraphs break at the column bottom instead of overrunning the
       * footer margin (the classic two-column overflow bug). Requires the
       * caller to have positioned `this.y` at `y`.
       */
      paginate?: boolean;
    } = {},
  ): number {
    const d = this.doc;
    const raw = stripMd(str);
    const isArabic = hasArabic(raw);

    let font: string;
    let style: string;
    if (isArabic) {
      const af = opts.font ?? "B";
      font = af === "Hm" || af === "Bb" ? F.Arm : F.Ar;
      style = af === "H" || opts.style === "bold" ? "bold" : "normal";
    } else {
      font = F[opts.font ?? "B"];
      style = opts.style ?? "normal";
    }

    const size = (opts.size ?? 9.5) * this.L.typeScale * this.L.fontSizeMultiplier;
    d.setFont(font, hs(style));
    d.setFontSize(size);
    d.setTextColor(...(opts.color ?? C.CHARCOAL));

    const maxW = opts.maxW ?? this.L.fw;
    // Pass raw (logical-order) text to d.text() — the doc.text wrapper
    // installed in the constructor shapes + bidi-reorders Arabic lines
    // (via arabic.ts's shapeArabicLetters + bidiReorder) before jsPDF
    // ever sees them, so no per-call bidi flags are needed here.
    const normalized = normalizeText(raw);
    const lines: string[] = d.splitTextToSize(normalized, maxW);
    const lineH = lh(size, isArabic ? 1.3 : (opts.lineFactor ?? 1.45));

    if (opts.paginate && lines.length > 1) {
      this.y = y;
      let cx = x;
      for (let i = 0; i < lines.length; ) {
        const fit = Math.max(1, Math.floor((this.L.ph - this.L.mb - this.y) / lineH));
        const chunk = lines.slice(i, i + fit);
        if (isArabic) d.text(chunk, cx + maxW, this.y, { align: "right" });
        else d.text(chunk, cx, this.y, { align: opts.align ?? "left" });
        i += chunk.length;
        this.y += chunk.length * lineH;
        if (i < lines.length) {
          this.checkPage(lineH * 2);
          cx = this.colX;
        }
      }
      return this.y;
    }

    if (isArabic) {
      d.text(lines, x + maxW, y, { align: "right" });
    } else {
      d.text(lines, x, y, { align: opts.align ?? "left" });
    }
    return y + lines.length * lineH;
  }

  hRule(y: number, w: number, thick = 0.3, color: RGB = C.RULE, x?: number): number {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(thick);
    this.doc.line(x ?? this.L.ms, y, (x ?? this.L.ms) + w, y);
    return y + 3.6 * this.L.density;
  }

  doubleRule(y: number, w: number): number {
    const d = this.doc;
    d.setDrawColor(...this.T.accent);
    d.setLineWidth(1.6);
    d.line(this.L.ms, y, this.L.ms + w, y);
    d.setLineWidth(0.5);
    d.line(this.L.ms, y + 2.4, this.L.ms + w, y + 2.4);
    return y + 8 * this.L.density;
  }

  trackedLabel(text: string, x: number, y: number, size = 10, color: RGB = C.COBALT, maxW?: number): number {
    const d = this.doc;
    const isAr = hasArabic(text);
    d.setFont(isAr ? "Cairo" : F.H, hs("bold"));
    d.setFontSize(size * this.L.typeScale);
    d.setTextColor(...color);
    if (isAr) {
      d.text(text, x + (maxW ?? this.L.fw), y, { align: "right" });
    } else {
      d.text(tracked(text), x, y);
    }
    return y + lh(size * this.L.typeScale, 1.2);
  }

  /** Rounded callout panel (explanation / model answer / rubric). */
  calloutBox(label: string, body: string, y: number, w: number, x: number, bg: RGB, border: RGB): number {
    const d = this.doc;
    const density = this.L.density;
    const pad = sp(3, density);
    const bodySize = 8.6 * this.L.typeScale;
    const bodyMaxW = w - pad * 2;

    const rawBody = stripMd(body);
    const bodyHasArabic = hasArabic(rawBody);
    d.setFont(bodyHasArabic ? "Cairo" : F.Bi, hs(bodyHasArabic ? "normal" : "italic"));
    d.setFontSize(bodySize);
    // jsPDF's getStringUnitWidth applies processArabic internally,
    // so splitTextToSize measures shaped widths even from raw text.
    const bodyLines: string[] = d.splitTextToSize(normalizeText(rawBody), bodyMaxW);
    const bodyH = bodyLines.length * lh(bodySize, bodyHasArabic ? 1.3 : 1.45);
    const labelH = sp(4, density);
    const totalH = labelH + bodyH + sp(1.5, density);

    this.checkPage(totalH + 6);
    // checkPage may have flipped to the other column — the box must draw
    // there, not at the caller's now-stale x.
    x = this.colX;
    const boxY = this.y;

    d.setFillColor(...bg);
    d.setDrawColor(...border);
    d.setLineWidth(0.5);
    d.roundedRect(x, boxY, w, totalH, 1.2, 1.2, "FD");

    const labelAr = hasArabic(label);
    d.setFont(labelAr ? "Cairo" : F.H, hs("bold"));
    d.setFontSize(6.6 * this.L.typeScale);
    d.setTextColor(...border);
    if (labelAr) {
      d.text(label, x + w - pad, boxY + sp(1.5, density), { align: "right" });
    } else {
      d.text(tracked(label), x + pad, boxY + sp(1.5, density));
    }

    this.text(body, x + pad, boxY + labelH + sp(0.5, density), {
      font: "Bi",
      size: bodySize / this.L.typeScale,
      color: C.SLATE,
      maxW: bodyMaxW,
    });

    return boxY + totalH + sp(1.5, density);
  }

  /** Correct-answer badge — vector check icon, never a Unicode glyph. */
  correctBadge(letter: string, optText: string, y: number, w: number, x: number): number {
    const d = this.doc;
    const density = this.L.density;
    const pad = sp(2.5, density);
    const badgeH = sp(4.5, density);

    this.checkPage(badgeH + 4);
    // checkPage may have flipped to the other column — the badge must draw
    // there, not at the caller's now-stale x.
    x = this.colX;
    const boxY = this.y;
    d.setFillColor(...C.EMERALD);
    d.roundedRect(x, boxY, w, badgeH, 1.2, 1.2, "F");

    const iconCx = x + pad + 1.6;
    const iconCy = boxY + badgeH / 2;
    d.setFillColor(255, 255, 255);
    d.circle(iconCx, iconCy, 2.1, "F");
    drawCheck(d, iconCx, iconCy, 2.4, C.EMERALD);

    const label = `${this.t("pdf.tpl.correctAnswer")} — ${letter}.  ${trunc(stripMd(optText), 78)}`;
    this.text(label, iconCx + 5, boxY + badgeH / 2 + 1.4, {
      font: "H",
      style: "bold",
      size: 8.4,
      color: C.WHITE,
      maxW: w - (iconCx + 10),
    });

    return boxY + badgeH + sp(1.5, density);
  }

  // ── Cover page ──

  drawCover(cfg: CoverConfig, totalQ: number, chCount: number): void {
    const d = this.doc;
    const { pw, ph } = this.L;

    // Base fill.
    d.setFillColor(...this.T.base);
    d.rect(0, 0, pw, ph, "F");

    // Simulated vertical vignette — soft light center, deep edges.
    const bands = 56;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const curve = Math.sin(Math.PI * t); // 0 at edges, 1 at center
      const color = lerp(this.T.baseDeep, this.T.baseSoft, curve * 0.55);
      const bandH = ph / bands;
      d.setFillColor(...color);
      d.rect(0, i * bandH, pw, bandH + 0.4, "F");
    }

    // Hairline double frame, inset from the edge.
    const inset = pw * 0.045;
    const inset2 = inset + 1.1;
    d.setDrawColor(...this.T.accentDeep);
    d.setLineWidth(0.35);
    d.rect(inset, inset, pw - inset * 2, ph - inset * 2, "S");
    d.setDrawColor(...this.T.accentSoft);
    d.setLineWidth(0.25);
    d.rect(inset2, inset2, pw - inset2 * 2, ph - inset2 * 2, "S");

    // Corner registration ticks, just outside the frame.
    const tick = 4.2;
    const corners: [number, number, number, number][] = [
      [inset, inset, 1, 1],
      [pw - inset, inset, -1, 1],
      [inset, ph - inset, 1, -1],
      [pw - inset, ph - inset, -1, -1],
    ];
    d.setDrawColor(...this.T.accentSoft);
    d.setLineWidth(0.3);
    for (const [cx, cy, dx, dy] of corners) {
      d.line(cx, cy, cx - dx * tick, cy);
      d.line(cx, cy, cx, cy - dy * tick);
    }

    let cy = ph * 0.185;

    // Eyebrow.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(8.2);
    d.setTextColor(...this.T.accentSoft);
    const eyebrow = cfg.eyebrow ?? this.t("pdf.tpl.oslerReport");
    d.text(tlabel(eyebrow), pw / 2, cy, { align: "center" });
    cy += 13;

    // Brand mark.
    drawPulseMark(d, pw / 2, cy, pw * 0.028, this.T.pulseRing, this.T.accentSoft);
    cy += pw * 0.028 + 12;

    // Title.
    const titleSize = clamp(pw * 0.155, 26, 40);
    const titleIsAr = hasArabic(cfg.title || "");
    d.setFont(titleIsAr ? "Cairo" : F.H, hs("bold"));
    d.setFontSize(titleSize);
    d.setTextColor(...C.WHITE);
    const titleLines: string[] = d.splitTextToSize(normalizeText(cfg.title || this.t("pdf.tpl.report")), pw * 0.76);
    d.text(titleLines, pw / 2, cy, { align: "center" });
    cy += titleLines.length * lh(titleSize, titleIsAr ? 1.25 : 1.08) + 6;

    // Subtitle.
    if (cfg.subtitle) {
      const subSize = clamp(pw * 0.058, 11, 16);
      const subIsAr = hasArabic(cfg.subtitle);
      d.setFont(subIsAr ? "Cairo" : F.Bi, hs(subIsAr ? "normal" : "italic"));
      d.setFontSize(subSize);
      d.setTextColor(...this.T.coverBody);
      const subLines: string[] = d.splitTextToSize(normalizeText(cfg.subtitle), pw * 0.62);
      d.text(subLines, pw / 2, cy, { align: "center" });
      cy += subLines.length * lh(subSize, subIsAr ? 1.25 : 1.45) + 5;
    }

    // Divider.
    cy += 3;
    d.setDrawColor(...this.T.accent);
    d.setLineWidth(1.4);
    d.line(pw * 0.32, cy, pw * 0.68, cy);
    d.setLineWidth(0.4);
    d.line(pw * 0.32, cy + 2.2, pw * 0.68, cy + 2.2);
    cy += 12;

    // Metadata.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(9.5);
    d.setTextColor(...this.T.coverMeta);
    const metaBits = [cfg.author, cfg.date].filter(Boolean) as string[];
    if (metaBits.length) {
      const metaStr = metaBits.join("   ·   ");
      d.text(tlabel(metaStr), pw / 2, cy, { align: "center" });
      cy += 8;
    }
    if (cfg.description) {
      d.setFontSize(8.6);
      const descLines: string[] = d.splitTextToSize(normalizeText(cfg.description), pw * 0.58);
      d.text(descLines, pw / 2, cy, { align: "center" });
      cy += descLines.length * lh(8.6) + 4;
    }

    // Stat strip — thin hairline separated inline stats.
    if (totalQ > 0 || chCount > 0) {
      cy += 4;
      const parts: string[] = [];
      if (chCount > 0) parts.push(`${chCount} ${chCount === 1 ? this.t("pdf.tpl.chapterSingular") : this.t("pdf.tpl.chapters")}`);
      if (totalQ > 0) parts.push(`${totalQ} ${totalQ === 1 ? this.t("pdf.tpl.questionSingular") : this.t("pdf.tpl.questionsPlural")}`);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(9.5);
      const labeledParts = parts.map((p) => ({ text: tlabel(p), w: d.getTextWidth(tlabel(p)) }));
      const sepW = 8;
      const totalW = labeledParts.reduce((a, b) => a + b.w, 0) + sepW * (parts.length - 1);
      let sx = pw / 2 - totalW / 2;
      for (let i = 0; i < labeledParts.length; i++) {
        d.setTextColor(...this.T.accentSoft);
        d.text(labeledParts[i].text, sx, cy, { align: "left" });
        sx += labeledParts[i].w;
        if (i < parts.length - 1) {
          d.setDrawColor(...this.T.pulseRing);
          d.setLineWidth(0.3);
          d.line(sx + sepW / 2, cy - 3, sx + sepW / 2, cy - 3 + 4.2);
          sx += sepW;
        }
      }
      cy += 10;
    }

    // Feature checklist — capped so a very long title/subtitle stack can
    // never run the list into the pinned footer note.
    const features = cfg.features ?? [];
    const featureFloor = ph - inset - 24;
    if (features.length) {
      cy += 3;
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(8.6);
      for (const f of features) {
        if (cy >= featureFloor) break;
        const ft = tlabel(f);
        const fw = d.getTextWidth(ft);
        const fx = pw / 2 - fw / 2;
        drawCheck(d, fx - 6, cy - 1.6, 3, this.T.accentSoft);
        d.setTextColor(...this.T.coverBody);
        d.text(ft, fx, cy, { align: "left" });
        cy += 6.4;
      }
    }

    // Footer note, inside the frame.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(7.4);
    d.setTextColor(96, 118, 144);
    d.text(tlabel(cfg.footerNote ?? this.t("pdf.tpl.preparedByOsler")), pw / 2, ph - inset - 7, { align: "center" });
  }

  // ── Table of contents ──

  drawTocEntry(chNum: number, title: string, qCount: number, desc: string, targetPage: number): void {
    const d = this.doc;
    const density = this.L.density;
    this.checkPage(sp(6, density) + (desc ? 8 : 0));

    const entryTop = this.y;
    d.setFont(F.H, hs("bold"));
    d.setFontSize(7.6 * this.L.typeScale);
    d.setTextColor(...this.T.accent);
    d.text(tlabel(`${this.t("pdf.tpl.ch")} ${String(chNum).padStart(2, "0")}`), this.L.ms, this.y);
    this.y += sp(2.6, density);

    d.setFont(F.Hm, hs("normal"));
    d.setFontSize(11 * this.L.typeScale);
    d.setTextColor(...C.CHARCOAL);
    const tocTitleIsAr = hasArabic(title);
    if (tocTitleIsAr) {
      d.setFont("Cairo", hs("normal"));
      d.text(trunc(title, 62), this.L.ms + this.L.fw - 1.5, this.y, { align: "right" });
    } else {
      d.text(trunc(title, 62), this.L.ms + 1.5, this.y);
    }

    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7.6 * this.L.typeScale);
    d.setTextColor(...C.MUTED);
    const qLabel = `${qCount} ${this.t("pdf.tpl.q")}`;
    const qLabelAr = hasArabic(qLabel);
    if (qLabelAr) {
      d.setFont("Cairo", hs("normal"));
    }
    d.text(qLabel, this.L.ms + this.L.fw, this.y, { align: "right" });

    const linkH = desc ? 15 : 10;
    d.link(this.L.ms, entryTop - 5, this.L.fw, linkH, { pageNumber: targetPage });
    this.y += sp(3, density);

    if (desc) {
      const descIsAr = hasArabic(desc);
      d.setFont(descIsAr ? "Cairo" : F.Bi, hs(descIsAr ? "normal" : "italic"));
      d.setFontSize(8.2 * this.L.typeScale);
      d.setTextColor(...C.MUTED);
      const lines: string[] = d.splitTextToSize(stripMd(desc), this.L.fw - 8);
      if (descIsAr) d.text(lines, this.L.ms + this.L.fw - 4, this.y, { align: "right" });
      else d.text(lines, this.L.ms + 4, this.y);
      this.y += lines.length * lh(8.2 * this.L.typeScale, descIsAr ? 1.3 : 1.45) + sp(1, density);
    }

    this.y = this.hRule(this.y, this.L.fw, 0.25);
    this.y += sp(0.5, density);
  }

  // ── Chapter header ──

  drawChapterHeader(chNum: number, title: string, desc: string, isSingle: boolean): void {
    const d = this.doc;
    const fw = this.L.fw;
    const density = this.L.density;
    this.chapterPages[chNum] = this.page;

    if (isSingle) {
      this.checkPage(30);
      if (title) {
        const titleIsAr = hasArabic(title);
        d.setFont(titleIsAr ? "Cairo" : F.H, hs("bold"));
        d.setFontSize(20 * this.L.typeScale);
        d.setTextColor(...C.INK);
        const lines: string[] = d.splitTextToSize(title, fw);
        // Both scripts center — a lone chapter opener reads as a title page.
        d.text(lines, this.L.ms + fw / 2, this.y, { align: "center" });
        this.y += lines.length * lh(20 * this.L.typeScale, 1.2) + sp(1.5, density);
      }
      if (desc) {
        const descIsAr = hasArabic(desc);
        d.setFont(descIsAr ? "Cairo" : F.Bi, hs(descIsAr ? "normal" : "italic"));
        d.setFontSize(9.5 * this.L.typeScale);
        d.setTextColor(...C.MUTED);
        const lines: string[] = d.splitTextToSize(stripMd(desc), fw - 10);
        d.text(lines, this.L.ms + fw / 2, this.y, { align: "center" });
        this.y += lines.length * lh(9.5 * this.L.typeScale) + sp(2.5, density);
      }
      this.y = this.hRule(this.y, fw * 0.28, 0.6, this.T.accent, this.L.ms + fw * 0.36);
      this.y += sp(1.5, density);
    } else {
      this.checkPage(34);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(7.6 * this.L.typeScale);
      d.setTextColor(...this.T.accent);
      d.text(tlabel(`${this.t("pdf.tpl.chapter")} ${String(chNum).padStart(2, "0")}`), this.L.ms, this.y);
      this.y += sp(3, density);

      d.setFont(F.H, hs("bold"));
      d.setFontSize(16 * this.L.typeScale);
      d.setTextColor(...C.INK);
      const titleIsAr = hasArabic(title);
      if (titleIsAr) {
        d.setFont("Cairo", hs("bold"));
        const lines: string[] = d.splitTextToSize(title, fw);
        d.text(lines, this.L.ms + fw, this.y, { align: "right" });
        this.y += lines.length * lh(16 * this.L.typeScale, 1.3);
      } else {
        d.text(title, this.L.ms, this.y);
        this.y += sp(3.5, density);
      }

      if (desc) {
        const descIsAr = hasArabic(desc);
        d.setFont(descIsAr ? "Cairo" : F.Bi, hs(descIsAr ? "normal" : "italic"));
        d.setFontSize(8.6 * this.L.typeScale);
        d.setTextColor(...C.MUTED);
        const lines: string[] = d.splitTextToSize(stripMd(desc), fw - 10);
        if (descIsAr) d.text(lines, this.L.ms + fw - 5, this.y, { align: "right" });
        else d.text(lines, this.L.ms, this.y);
        this.y += lines.length * lh(8.6 * this.L.typeScale, descIsAr ? 1.3 : 1.45) + sp(2.5, density);
      }
      this.y = this.hRule(this.y, fw, 1, this.T.accent);
      this.y += sp(2.5, density);
    }
  }

  // ── Question rendering ──

  estimateQuestionH(q: FullQuestion, opts: QuestionDrawOpts): number {
    const d = this.doc;
    const density = this.L.density;
    const ts = this.L.typeScale;
    const cw = opts.twoCol ? this.L.cw : this.L.fw;
    const am = opts.answersMode ?? "inline";
    const style = opts.styleMode ?? "standard";
    const showExpl = opts.showExplanations ?? true;
    const written = q.isWritten ?? false;

    const saveFont = d.getFont();
    const saveSize = d.getFontSize();

    let h = 0;

    // ── Header row ──
    if (style === "mcqnotes") {
      h += sp(1.5, density);
    } else {
      h += lh(9.5 * ts, 1.2) + sp(0.5, density) + 4 + sp(1.5, density);
    }

    // ── Stem ──
    if (q.stem) {
      const sSize = style === "mcqnotes" ? 8.4 : 9.5;
      const raw = stripMd(q.stem);
      const isAr = hasArabic(raw);
      d.setFont(isAr ? "Cairo" : F[style === "mcqnotes" ? "Hm" : "B"], hs("normal"));
      d.setFontSize(sSize * ts);
      const stemLines = d.splitTextToSize(normalizeText(raw), cw - 2).length;
      h += stemLines * lh(sSize * ts, isAr ? 1.3 : 1.45) + sp(1.5, density);
    }

    // ── Choices ──
    if (!written && q.choices.length > 0) {
      for (const c of q.choices) {
        const raw = stripMd(c);
        const isAr = hasArabic(raw);
        d.setFont(isAr ? "Cairo" : F.B, hs("normal"));
        d.setFontSize(8.6 * ts);
        const cl = d.splitTextToSize(normalizeText(raw), cw - (isAr ? 13 : 15)).length;
        h += cl * lh(8.6 * ts, isAr ? 1.3 : 1.45) + sp(0.4, density);
      }
    }

    // ── Session status line (your answer vs. correct answer) ──
    if ((opts.revealed ?? false) && !written && q.correct >= 0 && q.correct < q.choices.length) {
      h += sp(1.6, density) + lh(7 * ts, 1.25);
    }

    // ── Inline answer + explanation ──
    if (am === "inline" && !written) {
      if (showExpl && q.correct >= 0 && q.correct < q.choices.length) {
        h += sp(0.5, density) + sp(4.5, density) + sp(1.5, density);
      }
      if (showExpl && q.explanation) {
        h += sp(0.5, density);
        const pad = sp(3, density);
        const xRaw = stripMd(q.explanation);
        const xAr = hasArabic(xRaw);
        d.setFont(xAr ? "Cairo" : F.Bi, hs(xAr ? "normal" : "italic"));
        d.setFontSize(8.6 * ts);
        const bl = d.splitTextToSize(normalizeText(xRaw), cw - pad * 2).length;
        h += sp(4, density) + bl * lh(8.6 * ts, xAr ? 1.3 : 1.45) + sp(1.5, density) + sp(1.5, density);
      }
    }

    if (written && q.modelAnswer && showExpl) {
      h += sp(0.5, density);
      const pad = sp(3, density);
      const mRaw = stripMd(q.modelAnswer);
      const mAr = hasArabic(mRaw);
      d.setFont(mAr ? "Cairo" : F.Bi, hs(mAr ? "normal" : "italic"));
      d.setFontSize(8.6 * ts);
        const bl = d.splitTextToSize(normalizeText(mRaw), cw - pad * 2).length;
      h += sp(4, density) + bl * lh(8.6 * ts, mAr ? 1.3 : 1.45) + sp(1.5, density) + sp(1.5, density);
    }

    // "See Answer Key" pointer line + trailing hairline — previously
    // omitted, which made checkPage break columns a few mm too early.
    if ((am === "endchapter" || am === "endbook") && !written) {
      h += sp(1.5, density) + 3;
    }
    h += sp(0.75, density);

    d.setFont(saveFont.fontName, saveFont.fontStyle);
    d.setFontSize(saveSize);
    return h;
  }

  drawQuestion(q: FullQuestion, qNum: number, opts: QuestionDrawOpts): void {
    const d = this.doc;
    const density = this.L.density;
    const answersMode = opts.answersMode ?? "inline";
    const showExpl = opts.showExplanations ?? true;
    const style = opts.styleMode ?? "standard";
    const isWritten = q.isWritten ?? false;

    this.checkPage(this.estimateQuestionH(q, opts) + 8);
    // Derive column state AFTER checkPage — it may have switched columns
    let cw = opts.twoCol ? this.L.cw : this.L.fw;
    let x = this.colX;

    // ── Header row ──
    if (style === "mcqnotes") {
      d.setFont(F.Hm, hs("normal"));
      d.setFontSize(7 * this.L.typeScale);
      d.setTextColor(...C.MUTED);
      const qLabel = `${this.t("pdf.tpl.q")}${qNum}`;
      const mcqAr = hasArabic(qLabel);
      if (mcqAr) {
        d.setFont("Cairo", hs("normal"));
        d.text(qLabel, x + cw, this.y, { align: "right" });
      } else {
        d.text(qLabel, x, this.y);
      }
      this.y += sp(1.5, density);
    } else {
      this.y = this.trackedLabel(`${this.t("pdf.tpl.question")} ${qNum}`, x, this.y, 9.5, C.COBALT, cw);
      this.y += sp(0.5, density);
      this.y = this.hRule(this.y, cw, 1.1, C.ROYAL, x);
      this.y += sp(1.5, density);
    }

    // ── Stem ──
    if (q.stem) {
      const stemFont: "B" | "Hm" = style === "mcqnotes" ? "Hm" : "B";
      const stemSize = style === "mcqnotes" ? 8.4 : 9.5;
      this.y = this.text(q.stem, x, this.y, {
        font: stemFont,
        size: stemSize,
        color: C.CHARCOAL,
        maxW: cw - 2,
        paginate: true,
      });
      this.y += sp(1.5, density);
    }

    // ── Options ──
    if (!isWritten && q.choices.length > 0) {
      const showInline = answersMode === "inline";
      const revealedQ = opts.revealed ?? false;
      for (let i = 0; i < q.choices.length; i++) {
        // The stem may have paginated across a column/page break — re-derive
        // the drawing column before every choice.
        cw = opts.twoCol ? this.L.cw : this.L.fw;
        x = this.colX;
        const letter = LETTERS[i] ?? String(i + 1);
        const isCorrect = i === q.correct;
        // Tutor-style marking: correct choice always emerald; in session
        // reports a wrong pick is additionally crossed out in crimson.
        const markCorrect = isCorrect && (showInline || revealedQ);
        const markWrong = revealedQ && opts.userAnswer === i && !isCorrect;
        const highlight = markCorrect || markWrong;
        const markColor: RGB = markWrong ? C.CRIMSON : C.EMERALD;
        const choiceText = q.choices[i];
        const isChoiceArabic = hasArabic(stripMd(choiceText));

        if (isChoiceArabic) {
          d.setFont("Cairo", hs("bold"));
          d.setFontSize(8.4 * this.L.typeScale);
          d.setTextColor(...(highlight ? markColor : C.ROYAL));
          d.text(`${letter}`, x + cw - 3.2, this.y, { align: "right" });
          if (markCorrect) drawCheck(d, x + cw - 8.6, this.y - 1.4, 2.4, C.EMERALD);
          else if (markWrong) drawCross(d, x + cw - 8.6, this.y - 1.4, 2.4, C.CRIMSON);
          this.y = this.text(choiceText, x, this.y, {
            font: "B", size: 8.6,
            color: (highlight ? markColor : C.SLATE),
            // Mirrors the LTR letter column: text right edge lands beside
            // the check/letter zone instead of 15mm short of it.
            maxW: cw - 13,
            align: "right",
            paginate: true,
          });
        } else {
          d.setFont(F.H, hs("bold"));
          d.setFontSize(8.4 * this.L.typeScale);
          d.setTextColor(...(highlight ? markColor : C.ROYAL));
          d.text(`${letter}`, x + 3.2, this.y);
          if (markCorrect) drawCheck(d, x + 8.6, this.y - 1.4, 2.4, C.EMERALD);
          else if (markWrong) drawCross(d, x + 8.6, this.y - 1.4, 2.4, C.CRIMSON);
          this.y = this.text(choiceText, x + 13, this.y, {
            font: highlight ? "Bb" : "B",
            size: 8.6,
            color: (highlight ? markColor : C.SLATE),
            maxW: cw - 15,
            paginate: true,
          });
        }
        this.y += sp(0.4, density);
      }
    }

    // ── Session report — the user's chosen answer next to the key ──
    if ((opts.revealed ?? false) && !isWritten && q.correct >= 0 && q.correct < q.choices.length) {
      this.y += sp(1.2, density);
      cw = opts.twoCol ? this.L.cw : this.L.fw;
      x = this.colX;
      const stSize = 7 * this.L.typeScale;
      const ua = opts.userAnswer;
      if (ua === undefined || ua === null) {
        const lbl = this.t("pdf.tpl.notAnswered");
        const lblAr = hasArabic(lbl);
        d.setFont(lblAr ? "Cairo" : F.Hm, hs("normal"));
        d.setFontSize(stSize);
        d.setTextColor(...C.MUTED);
        if (lblAr) d.text(lbl, x + cw, this.y, { align: "right" });
        else d.text(tlabel(lbl), x, this.y);
      } else {
        const ok = ua === q.correct;
        const color: RGB = ok ? C.EMERALD : C.CRIMSON;
        const label = ok
          ? `${this.t("pdf.tpl.yourAnswer")}: ${LETTERS[ua] ?? String(ua + 1)}`
          : `${this.t("pdf.tpl.yourAnswer")}: ${LETTERS[ua] ?? String(ua + 1)}   ·   ${this.t("pdf.tpl.correctAnswer")}: ${LETTERS[q.correct]}`;
        const labelAr = hasArabic(label);
        if (ok) drawCheck(d, labelAr ? x + cw - 1.6 : x + 1.6, this.y - 1.1, 2.4, C.EMERALD);
        else drawCross(d, labelAr ? x + cw - 1.6 : x + 1.6, this.y - 1.1, 2.4, C.CRIMSON);
        d.setFont(labelAr ? "Cairo" : F.H, hs("bold"));
        d.setFontSize(stSize);
        d.setTextColor(...color);
        if (labelAr) d.text(label, x + cw - 4.6, this.y, { align: "right" });
        else d.text(tlabel(label), x + 4.6, this.y);
      }
      this.y += lh(stSize, 1.25) + sp(0.4, density);
    }

    // ── Inline answer + explanation ──
    if (answersMode === "inline" && !isWritten) {
      if (showExpl && q.correct >= 0 && q.correct < q.choices.length) {
        this.y += sp(0.5, density);
        cw = opts.twoCol ? this.L.cw : this.L.fw; x = this.colX;
        this.y = this.correctBadge(LETTERS[q.correct], q.choices[q.correct], this.y, cw, x);
      }
      if (showExpl && q.explanation) {
        this.y += sp(0.5, density);
        cw = opts.twoCol ? this.L.cw : this.L.fw; x = this.colX;
        this.y = this.calloutBox(this.t("pdf.tpl.explanation"), q.explanation, this.y, cw, x, C.PALE_GREEN, C.SAGE);
      }
    }

    if (isWritten && q.modelAnswer && showExpl) {
      this.y += sp(0.5, density);
      cw = opts.twoCol ? this.L.cw : this.L.fw; x = this.colX;
      this.y = this.calloutBox(this.t("pdf.tpl.modelAnswer"), q.modelAnswer, this.y, cw, x, C.PALE_BLUE, C.ROYAL);
    }

    if (isWritten && q.rubric?.length && showExpl) {
      this.y += sp(0.5, density);
      cw = opts.twoCol ? this.L.cw : this.L.fw; x = this.colX;
      this.y = this.calloutBox(
        this.t("pdf.tpl.rubricCriteria"),
        q.rubric.map((r, ri) => `${ri + 1}. ${r}`).join("\n"),
        this.y,
        cw,
        x,
        [244, 242, 253],
        [118, 98, 178],
      );
    }

    if ((answersMode === "endchapter" || answersMode === "endbook") && !isWritten) {
      // Choices may have paginated across a column break — re-derive here so
      // both the link rect and the text land in the active column.
      cw = opts.twoCol ? this.L.cw : this.L.fw;
      x = this.colX;
      const seeAnswerText = this.t("pdf.tpl.seeAnswerKey");
      const arrow = this.lang === "ar" ? " ←" : " ->";
      const fullText = seeAnswerText + arrow;
      const seeAnswerAr = hasArabic(seeAnswerText);
      d.setFont(seeAnswerAr ? "Cairo" : F.Hn, hs("normal"));
      d.setFontSize(7 * this.L.typeScale);
      d.setTextColor(...C.LINK);
      const textW = d.getTextWidth(fullText);
      // Record the position of this "See Answer Key" text plus its question
      // number, so a hyperlink to THAT question's answer block can be added
      // once its page is known. The text is right-aligned at (x + cw), so
      // the clickable rect spans from (x + cw - textW) to (x + cw).
      this.pendingAnswerKeyLinks.push({
        page: this.page,
        x: x + cw - textW - 1,
        y: this.y - 3.5,
        w: textW + 2,
        h: 5,
        chapterIdx: opts.chapterIdx ?? -1,
        qNum,
      });
      d.text(fullText, x + cw, this.y, { align: "right" });
      this.y += sp(1.5, density);
    }

    this.y = this.hRule(this.y, cw, 0.25, C.RULE, x);
    this.y += sp(0.75, density);
  }

  // ── Answer key ──

  /**
   * Resolve all pending "See Answer Key" links for the given chapter
   * (or all chapters if chapterIdx is -1) to point at the current page.
   * Must be called AFTER the answer key banner has been drawn on the
   * target page, so that `this.page` is the answer key's page number.
   */
  resolveAnswerKeyLinks(chapterIdx: number): void {
    const fallbackPage = this.page;
    const d = this.doc;
    for (const link of this.pendingAnswerKeyLinks) {
      if (chapterIdx === -1 || link.chapterIdx === chapterIdx) {
        // Each question links straight to ITS answer block; fall back to the
        // key's first page only when the block wasn't drawn (edge cases).
        const targetPage = this.answerPages[link.qNum] ?? fallbackPage;
        d.setPage(link.page);
        d.link(link.x, link.y, link.w, link.h, { pageNumber: targetPage });
        d.setPage(fallbackPage);
      }
    }
    // Remove resolved links
    this.pendingAnswerKeyLinks = this.pendingAnswerKeyLinks.filter(
      (l) => !(chapterIdx === -1 || l.chapterIdx === chapterIdx),
    );
  }

  drawAnswerKeyBanner(title: string): void {
    const d = this.doc;
    const density = this.L.density;
    const fw = this.L.fw;
    const bannerH = sp(9, density);
    this.checkPage(bannerH + sp(3, density));

    d.setFillColor(...C.EMERALD);
    d.roundedRect(this.L.ms, this.y, fw, bannerH, 1.2, 1.2, "F");

    const titleAr = hasArabic(title);
    // Accent edge sits on the reading-start side of the banner.
    d.setFillColor(...this.T.accent);
    d.rect(titleAr ? this.L.ms + fw - 1.6 : this.L.ms, this.y, 1.6, bannerH, "F");

    d.setFont(titleAr ? "Cairo" : F.H, hs("bold"));
    d.setFontSize(11 * this.L.typeScale);
    d.setTextColor(...C.WHITE);
    if (titleAr) {
      d.text(title, this.L.ms + fw - 8, this.y + bannerH / 2 + 1.6, { align: "right" });
    } else {
      d.text(tracked(title), this.L.ms + 8, this.y + bannerH / 2 + 1.6);
    }

    this.y += bannerH + sp(2.5, density);
    this.colTopY = this.y;
  }

  drawAnswerBlock(q: FullQuestion, qNum: number, showExpl: boolean): void {
    const d = this.doc;
    const density = this.L.density;

    this.checkPage(sp(11, density));
    // Must read column state AFTER checkPage — it may have switched columns
    let cw = this.twoColEnabled ? this.L.cw : this.L.fw;
    let x = this.colX;

    // Remember where THIS question's answer landed so its "See Answer Key"
    // link can target it directly.
    this.answerPages[qNum] = this.page;

    this.y = this.trackedLabel(`${this.t("pdf.tpl.answers")} ${qNum}`, x, this.y, 9.5, C.EMERALD, cw);
    this.y = this.hRule(this.y, cw, 1.1, C.SAGE);
    this.y += sp(1, density);

    this.y = this.text(`"${trunc(stripMd(q.stem), 110)}"`, x, this.y, {
      font: "Bi",
      size: 8,
      color: C.MUTED,
      maxW: cw,
      paginate: true,
    });
    this.y += sp(1.5, density);

    if (q.correct >= 0 && q.correct < q.choices.length) {
      cw = this.twoColEnabled ? this.L.cw : this.L.fw;
      x = this.colX;
      this.y = this.correctBadge(LETTERS[q.correct], q.choices[q.correct], this.y, cw, x);
    }

    if (q.explanation && showExpl) {
      cw = this.twoColEnabled ? this.L.cw : this.L.fw;
      x = this.colX;
      this.y += sp(0.5, density);
      this.y = this.text(q.explanation, x, this.y, { font: "B", size: 8.8, color: C.CHARCOAL, maxW: cw, paginate: true });
      this.y += sp(1, density);
    }

    cw = this.twoColEnabled ? this.L.cw : this.L.fw;
    x = this.colX;
    this.y = this.hRule(this.y, cw, 0.3, [190, 218, 200]);
    this.y += sp(1.5, density);
  }

  // ── Score summary ──

  drawScoreSummary(score: ScoreSummaryData): void {
    const d = this.doc;
    const density = this.L.density;
    const fw = this.L.fw;
    const x = this.L.ms;
    const ts = this.L.typeScale;

    this.checkPage(sp(15, density));
    const cardH = sp(12.5, density);
    d.setFillColor(...C.PAPER);
    d.setDrawColor(...C.RULE);
    d.setLineWidth(0.35);
    d.roundedRect(x, this.y, fw, cardH, 1.6, 1.6, "FD");

    const colW = fw / 3;
    const midX = x + colW;
    const rightX = x + 2 * colW;

    d.setDrawColor(...C.RULE);
    d.setLineWidth(0.25);
    d.line(midX, this.y + 4, midX, this.y + cardH - 4);
    d.line(rightX, this.y + 4, rightX, this.y + cardH - 4);

    // Col 1 — score.
    let cx = x + colW / 2;
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(6.6 * ts);
    d.setTextColor(...C.MUTED);
    d.text(tlabel(this.t("pdf.tpl.yourScore")), cx, this.y + cardH * 0.22, { align: "center" });

    const scoreCol: RGB = score.pct >= 70 ? C.EMERALD : score.pct >= 50 ? this.T.accentDeep : C.CRIMSON;
    d.setFont(F.H, hs("bold"));
    d.setFontSize(25 * ts);
    d.setTextColor(...scoreCol);
    d.text(`${score.pct}%`, cx, this.y + cardH * 0.6, { align: "center" });

    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(6.6 * ts);
    d.setTextColor(...C.MUTED);
    d.text(tlabel(`${score.correct} ${this.t("pdf.tpl.of")} ${score.total} ${this.t("pdf.tpl.correctCount")}`), cx, this.y + cardH * 0.85, { align: "center" });

    // Col 2 — percentile.
    cx = midX + colW / 2;
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(6.6 * ts);
    d.setTextColor(...C.MUTED);
    d.text(tlabel(this.t("pdf.tpl.percentile")), cx, this.y + cardH * 0.22, { align: "center" });

    d.setFont(F.H, hs("bold"));
    d.setFontSize(25 * ts);
    d.setTextColor(...C.ROYAL);
    d.text(`${score.percentile}`, cx, this.y + cardH * 0.6, { align: "center" });
    const numW = d.getTextWidth(`${score.percentile}`);
    // English ordinals decline (1st/2nd/3rd/4th); Arabic omits the marker.
    const ordinal = this.lang === "ar" ? "" : ordinalSuffix(score.percentile);
    if (ordinal) {
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(7.5 * ts);
      d.text(ordinal, cx + numW / 2 + 2, this.y + cardH * 0.5);
    }

    d.setFontSize(6.6 * ts);
    d.setTextColor(...C.MUTED);
    d.text(tlabel(this.t("pdf.tpl.higherThan", { n: score.percentile })), cx, this.y + cardH * 0.85, { align: "center" });

    // Col 3 — stats.
    const stats: [string, string][] = [
      [this.t("pdf.tpl.answered"), `${score.answered}/${score.total}`],
      [this.t("pdf.tpl.incorrect"), `${score.incorrect}`],
      [this.t("pdf.tpl.flagged"), `${score.flagged}`],
      [this.t("pdf.tpl.totalTime"), score.totalTime],
      [this.t("pdf.tpl.avgPerQ"), score.avgTime],
    ];
    let sy = this.y + cardH * 0.18;
    const rowH = cardH * 0.16;
    for (const [label, value] of stats) {
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(6.2 * ts);
      d.setTextColor(...C.MUTED);
      d.text(label, rightX + 6, sy);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(6.6 * ts);
      d.setTextColor(...C.INK);
      d.text(value, rightX + colW - 6, sy, { align: "right" });
      sy += rowH;
    }

    this.y += cardH + sp(3, density);

    // Distribution bar.
    this.checkPage(sp(5, density));
    d.setFont(F.H, hs("bold"));
    d.setFontSize(8.6 * ts);
    d.setTextColor(...C.INK);
    d.text(tlabel(this.t("pdf.tpl.scoreDistribution")), x, this.y);
    this.y += sp(2.5, density);

    const barH = 3.2;
    const tot = score.total || 1;
    const correctW = (score.correct / tot) * fw;
    const incorrectW = (score.incorrect / tot) * fw;

    d.setFillColor(...C.RULE_SOFT);
    d.roundedRect(x, this.y, fw, barH, 1.2, 1.2, "F");
    if (correctW > 0) {
      d.setFillColor(...C.ROYAL);
      d.roundedRect(x, this.y, correctW, barH, 1.2, 1.2, "F");
    }
    if (incorrectW > 0) {
      d.setFillColor(...C.CRIMSON);
      d.rect(x + correctW, this.y, incorrectW, barH, "F");
    }
    this.y += barH + sp(2, density);

    d.setFontSize(6.2 * ts);
    const legends: [string, RGB][] = [
      [this.t("pdf.tpl.correctCount"), C.ROYAL],
      [this.t("pdf.tpl.incorrect"), C.CRIMSON],
      [this.t("pdf.tpl.unanswered"), C.MUTED],
    ];
    let lx = x;
    for (const [label, col] of legends) {
      d.setFillColor(...col);
      d.circle(lx + 1.4, this.y - 0.8, 1.2, "F");
      d.setTextColor(...C.MUTED);
      d.text(label, lx + 4, this.y);
      lx += d.getTextWidth(label) + 10;
    }
    this.y += sp(3, density);
  }

  // ── Question review list ──

  drawQuestionReview(items: QuestionReviewItem[]): void {
    const d = this.doc;
    const density = this.L.density;
    const ts = this.L.typeScale;

    this.checkPage(sp(6, density));
    d.setFont(F.H, hs("bold"));
    d.setFontSize(10.5 * ts);
    d.setTextColor(...C.INK);
    d.text(tlabel(this.t("pdf.tpl.questionReview")), this.L.ms, this.y);
    this.y += sp(3.5, density);

    for (const q of items) {
      this.checkPage(sp(3, density));
      const rowH = sp(2.2, density);
      const badgeR = 2.6;
      const badgeCx = this.L.ms + badgeR;
      const badgeCy = this.y - 1.4;

      if (q.unanswered) {
        d.setFillColor(...C.RULE_SOFT);
        d.circle(badgeCx, badgeCy, badgeR, "F");
        d.setFont(F.H, hs("bold"));
        d.setFontSize(6.2 * ts);
        d.setTextColor(...C.MUTED);
        d.text(String(q.num), badgeCx, badgeCy + 1, { align: "center" });
      } else if (q.correct) {
        d.setFillColor(...C.PALE_BLUE);
        d.circle(badgeCx, badgeCy, badgeR, "F");
        drawCheck(d, badgeCx, badgeCy, badgeR * 0.95, C.ROYAL);
      } else {
        d.setFillColor(...C.PALE_ROSE);
        d.circle(badgeCx, badgeCy, badgeR, "F");
        drawCross(d, badgeCx, badgeCy, badgeR * 0.95, C.CRIMSON);
      }

      this.y = this.text(q.stem, this.L.ms + 10, this.y, {
        font: "B",
        size: 7.6,
        color: C.CHARCOAL,
        maxW: this.L.fw - 14,
        paginate: true,
      });
      this.y += rowH;
    }
    this.y += sp(1.5, density);
  }
}

// ═══════════════════════════════════════════════════════════════
// § 8  PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════

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

interface QuestionDrawOpts {
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

// ═══════════════════════════════════════════════════════════════
// § 9  QUIZ COMPILATION  —  multi-chapter booklet, two-pass TOC
// ═══════════════════════════════════════════════════════════════

interface CompilationResult {
  doc: jsPDF;
  chapterPages: number[];
}

function renderCompilation(cfg: PdfExportConfig, knownChapterPages: number[] | null): CompilationResult {
  const lang = cfg.lang ?? "en";
  const doc = new PdfDoc(cfg.page, cfg.cover.title, cfg.styleMode, cfg.fontSize, cfg.fontType, lang, "content");
  const L = doc.L;
  const t = doc.t;
  const multiChapter = cfg.chapters.length > 1;
  const totalQ = cfg.chapters.reduce((a, ch) => a + ch.questions.length, 0);
  doc.setMeta({ title: cfg.cover.title, author: cfg.author, subject: t("pdf.meta.quizBooklet") });

  const showToc = multiChapter && cfg.includeCover;

  if (cfg.includeCover) {
    doc.drawCover(cfg.cover, totalQ, cfg.chapters.length);
    doc.addBookmark(t("pdf.tpl.cover"));
    doc.newPage({
      header: showToc ? { label: t("pdf.tpl.contents").toUpperCase(), section: "contents" } : { label: t("pdf.tpl.questions"), section: "questions" },
    });
  } else {
    doc.setHeader(t("pdf.tpl.questions"), "questions");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = cfg.includeCover ? 2 : 1;

  if (showToc) {
    doc.addBookmark(t("pdf.tpl.contents"));

    doc.doc.setFont(F.H, hs("bold"));
    doc.doc.setFontSize(18 * L.typeScale);
    doc.doc.setTextColor(...C.INK);
    const tocTitle = t("pdf.tpl.tableOfContents");
    const tocTitleIsAr = hasArabic(tocTitle);
    if (tocTitleIsAr) {
      doc.doc.setFont("Cairo", hs("bold"));
      doc.doc.text(tocTitle, L.ms + L.fw, doc.y, { align: "right" });
    } else {
      doc.doc.text(tocTitle, L.ms, doc.y);
    }
    doc.y += sp(4, L.density);
    doc.y = doc.doubleRule(doc.y, L.fw);
    doc.y += sp(1.5, L.density);

    cfg.chapters.forEach((ch, i) => {
      const targetPage = knownChapterPages ? knownChapterPages[i + 1] : doc.page;
      doc.drawTocEntry(i + 1, ch.title, ch.questions.length, ch.description ?? "", targetPage);
    });
    doc.newPage({ header: { label: t("pdf.tpl.questions"), section: "questions" } });
  }

  let globalQ = 0;
  const allAnswers: Array<{ num: number; q: FullQuestion }> = [];

  cfg.chapters.forEach((ch, ci) => {
    const drawOpts: QuestionDrawOpts = {
      answersMode: cfg.answersMode,
      showExplanations: cfg.answersMode === "inline" ? cfg.showExplanations : false,
      styleMode: cfg.styleMode,
      twoCol: cfg.twoCol,
      chapterIdx: ci,
    };
    if (ci > 0) {
      // Chapter openers are full-width — suspend the column flow so the
      // fresh page's chrome doesn't draw the divider through the title.
      doc.twoColEnabled = false;
      doc.newPage({ header: { label: t("pdf.tpl.questions"), section: "questions" } });
    }
    const chapterItem = doc.addBookmark(`${String(ci + 1).padStart(2, "0")}. ${ch.title}`);
    doc.drawChapterHeader(ci + 1, ch.title, ch.description ?? "", !multiChapter);
    doc.beginFlow(cfg.twoCol);

    for (const q of ch.questions) {
      globalQ++;
      doc.drawQuestion(q, globalQ, drawOpts);
      if (cfg.answersMode !== "inline" && cfg.answersMode !== "none" && !q.isWritten) {
        allAnswers.push({ num: globalQ, q });
      }
    }

    if (cfg.answersMode === "endchapter" && allAnswers.length > 0) {
      const chapterAnswers = allAnswers.splice(0);
      doc.newPage({ header: { label: t("pdf.tpl.answerKey").toUpperCase(), section: "answers" } });
      doc.addBookmark(t("pdf.tpl.answerKey"), chapterItem);
      doc.drawAnswerKeyBanner(t("pdf.tpl.chapterAnswerKey", { n: ci + 1 }));
      // Resolve all pending "See Answer Key" links for this chapter.
      doc.resolveAnswerKeyLinks(ci);
      for (const entry of chapterAnswers) doc.drawAnswerBlock(entry.q, entry.num, cfg.showExplanations);
    }
  });

  if (cfg.answersMode === "endbook" && allAnswers.length > 0) {
    doc.newPage({ header: { label: t("pdf.tpl.answerKey").toUpperCase(), section: "answers" } });
    doc.addBookmark(t("pdf.tpl.answerKey"));
    doc.drawAnswerKeyBanner(t("pdf.tpl.completeAnswerKey"));
    // Resolve ALL pending links (endbook mode — all chapters point here).
    doc.resolveAnswerKeyLinks(-1);
    for (const entry of allAnswers) doc.drawAnswerBlock(entry.q, entry.num, cfg.showExplanations);
  }

  doc.finalize(contentStartPage);
  return { doc: doc.doc, chapterPages: doc.chapterPages };
}

/**
 * Multi-chapter quiz booklet — cover, hyperlinked & bookmarked table of
 * contents, per-chapter questions, and answer keys. Uses a silent measure
 * pass to learn real chapter page numbers before rendering final TOC links,
 * so links stay correct no matter how long each chapter runs.
 */
export function generateQuizCompilationPdf(cfg: PdfExportConfig): jsPDF {
  const multiChapter = cfg.chapters.length > 1;
  let chapterPages: number[] | null = null;
  if (multiChapter && cfg.includeCover) {
    chapterPages = renderCompilation(cfg, null).chapterPages;
  }
  return renderCompilation(cfg, chapterPages).doc;
}

// ═══════════════════════════════════════════════════════════════
// § 10  RESULTS PDF  —  single attempt, real two-column flow
// ═══════════════════════════════════════════════════════════════

export function generateResultsPdf(cfg: ResultsPdfConfig): jsPDF {
  const opts = cfg.opts;
  const lang = opts.lang ?? "en";
  const doc = new PdfDoc(opts.page, cfg.packTitle, opts.styleMode, opts.fontSize, opts.fontType, lang, "session");
  const L = doc.L;
  const t = doc.t;
  doc.setMeta({ title: opts.title || cfg.packTitle, author: opts.author, subject: t("pdf.meta.quizResults") });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || cfg.packTitle,
        subtitle: opts.subtitle || `${cfg.mode === "timed" ? t("pdf.tpl.timedMode") : t("pdf.tpl.tutorMode")}  ·  ${t("pdf.tpl.questionsCount", { n: cfg.score.total })}`,
        eyebrow: t("pdf.tpl.testResults"),
        author: opts.author,
        date: doc.formatToday(),
        features: [
          t("pdf.tpl.feature.scoreAnalysis"),
          opts.answersMode === "inline"
            ? t("pdf.tpl.feature.inlineAnswers")
            : opts.answersMode === "endbook"
              ? t("pdf.tpl.feature.endbookAnswers")
              : opts.answersMode === "endchapter"
                ? t("pdf.tpl.feature.endchapterAnswers")
                : t("pdf.tpl.feature.questionReview"),
          t("pdf.tpl.feature.performanceStats"),
        ],
      },
      cfg.score.total,
      1,
    );
    doc.addBookmark(t("pdf.tpl.cover"));
    doc.newPage({ header: { label: t("pdf.tpl.questions"), section: "questions" } });
  } else {
    doc.setHeader(t("pdf.tpl.questions"), "questions");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = opts.includeCover ? 2 : 1;
  doc.beginFlow(opts.twoCol);
  doc.addBookmark(t("pdf.tpl.results"));

  if (opts.showScoreSummary !== false) doc.drawScoreSummary(cfg.score);
  doc.colTopY = doc.y;

  const allAnswers: Array<{ num: number; q: FullQuestion }> = [];
  const includeExplanationsInline = opts.answersMode === "inline";
  const drawOpts: QuestionDrawOpts = {
    answersMode: opts.answersMode,
    showExplanations: includeExplanationsInline ? opts.showExplanations : false,
    styleMode: opts.styleMode,
    twoCol: opts.twoCol,
  };

  cfg.questions.forEach((q, i) => {
    doc.drawQuestion(q, i + 1, { ...drawOpts, userAnswer: cfg.userAnswers[i], revealed: !!cfg.revealed[i] });
    if (opts.answersMode !== "inline" && opts.answersMode !== "none" && !q.isWritten) {
      allAnswers.push({ num: i + 1, q });
    }
  });

  if (allAnswers.length > 0 && opts.answersMode !== "inline" && opts.answersMode !== "none") {
    doc.newPage({ header: { label: t("pdf.tpl.answerKey").toUpperCase(), section: "answers" } });
    doc.addBookmark(t("pdf.tpl.answerKey"));
    doc.drawAnswerKeyBanner(t("pdf.tpl.completeAnswerKey"));
    doc.resolveAnswerKeyLinks(-1);
    for (const entry of allAnswers) doc.drawAnswerBlock(entry.q, entry.num, opts.showExplanations);
  }

  if (opts.showReview !== false) {
    // Review rows are full-width — force single-column flow for this section.
    doc.newPage({ header: { label: t("pdf.tpl.questionReview").toUpperCase(), section: "questions" }, twoCol: false });
    doc.addBookmark(t("pdf.tpl.questionReview"));

    const reviewItems: QuestionReviewItem[] = cfg.questions.map((q, i) => {
      const ans = cfg.userAnswers[i];
      const isSubmitted = !!cfg.revealed[i];
      const isMCQ = q.correct >= 0;
      const isCorrect = isMCQ ? isSubmitted && ans === q.correct : false;
      return { num: i + 1, stem: q.stem, correct: isCorrect, unanswered: !isSubmitted };
    });
    doc.drawQuestionReview(reviewItems);
  }

  doc.finalize(contentStartPage);
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 11  DASHBOARD PERFORMANCE REPORT
// ═══════════════════════════════════════════════════════════════

export function generateDashboardPdf(cfg: DashboardPdfConfig): jsPDF {
  const opts = cfg.opts;
  const lang = opts.lang ?? "en";
  const doc = new PdfDoc(opts.page, opts.title || makeT(lang)("pdf.tpl.defaultReportTitle"), opts.styleMode, opts.fontSize, opts.fontType, lang, "session");
  const L = doc.L;
  const t = doc.t;
  doc.setMeta({ title: opts.title || t("pdf.tpl.userProgress", { name: cfg.username }), author: opts.author || cfg.username, subject: t("pdf.meta.performanceReport") });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || t("pdf.tpl.userProgress", { name: cfg.username }),
        subtitle: opts.subtitle || t("pdf.tpl.report"),
        eyebrow: t("pdf.tpl.oslerReport"),
        author: opts.author || cfg.username,
        date: doc.formatToday(),
        features: [t("pdf.tpl.feature.overallAccuracy"), t("pdf.tpl.feature.packBreakdownFeature"), t("pdf.tpl.feature.studyStats")],
        footerNote: t("pdf.tpl.preparedByOsler"),
      },
      cfg.stats.attempted,
      cfg.stats.packs,
    );
    doc.addBookmark(t("pdf.tpl.cover"));
    doc.newPage({ header: { label: t("pdf.tpl.report"), section: "report" } });
  } else {
    doc.setHeader(t("pdf.tpl.report"), "report");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = opts.includeCover ? 2 : 1;
  doc.addBookmark(t("pdf.tpl.report"));

  doc.drawScoreSummary({
    pct: cfg.stats.accuracy,
    correct: cfg.stats.correct,
    total: cfg.stats.attempted,
    answered: cfg.stats.attempted,
    incorrect: cfg.stats.attempted - cfg.stats.correct,
    flagged: 0,
    percentile: Math.min(99, Math.max(1, Math.round(cfg.stats.accuracy * 0.9 + 5))),
    totalTime: "—",
    avgTime: "—",
  });

  if (cfg.recentPacks.length > 0) {
    const d = doc.doc;
    const density = L.density;
    const ts = L.typeScale;
    doc.checkPage(sp(5, density));
    d.setFont(F.H, hs("bold"));
    d.setFontSize(10 * ts);
    d.setTextColor(...C.INK);
    d.text(tlabel(t("pdf.tpl.packBreakdown")), L.ms, doc.y);
    doc.y += sp(3.5, density);

    for (const pack of cfg.recentPacks) {
      doc.checkPage(sp(6, density));
      const rowY = doc.y;
      const acc = pack.attempted > 0 ? Math.round((pack.correct / pack.attempted) * 100) : 0;

      d.setFillColor(...C.PALE_BLUE);
      d.roundedRect(L.ms, rowY - 3, 22, 6.4, 1, 1, "F");
      d.setFont(F.H, hs("bold"));
      d.setFontSize(5.6 * ts);
      d.setTextColor(...C.ROYAL);
      d.text(tracked(pack.engine.toUpperCase()), L.ms + 11, rowY + 0.4, { align: "center" });

      d.setFont(F.H, hs("bold"));
      d.setFontSize(8.6 * ts);
      d.setTextColor(...C.INK);
      const titleStr = trunc(pack.title, 44);
      const titleAr = hasArabic(titleStr);
      d.setFont(titleAr ? "Cairo" : F.H, hs("bold"));
      if (titleAr) {
        d.text(titleStr, L.ms + L.fw - 27, rowY, { align: "right" });
      } else {
        d.text(titleStr, L.ms + 27, rowY);
      }
      if (pack.lastAttempt) {
        d.setFont(F.Hn, hs("normal"));
        d.setFontSize(6.6 * ts);
        d.setTextColor(...C.MUTED);
        d.text(doc.formatDate(pack.lastAttempt), L.ms + L.fw, rowY, { align: "right" });
      }

      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(6.6 * ts);
      d.setTextColor(...C.MUTED);
      d.text(tlabel(`${pack.attempted} ${t("pdf.tpl.attempted")}  ·  ${pack.correct} ${t("pdf.tpl.correct")}  ·  ${acc}%`), L.ms + 27, rowY + 4.6);

      const barY = rowY + 7.4;
      const barW = L.fw - 27;
      d.setFillColor(...C.RULE_SOFT);
      d.roundedRect(L.ms + 27, barY, barW, 2.2, 1, 1, "F");
      if (pack.attempted > 0) {
        d.setFillColor(...C.ROYAL);
        d.roundedRect(L.ms + 27, barY, (pack.correct / pack.attempted) * barW, 2.2, 1, 1, "F");
      }

      doc.y = barY + sp(3.5, density);
      doc.y = doc.hRule(doc.y, L.fw, 0.2);
      doc.y += sp(0.5, density);
    }
  }

  doc.finalize(contentStartPage);
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 12  LIBRARY ARTICLE PDF  —  DOM-based renderer mirroring print output
// ═══════════════════════════════════════════════════════════════

/** Inline formatting run parsed from article HTML. */
interface ArticleRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

type ArticleBlock =
  | { type: "h"; level: 2 | 3 | 4; runs: ArticleRun[] }
  | { type: "p"; runs: ArticleRun[] }
  | { type: "list"; ordered: boolean; items: Array<{ runs: ArticleRun[]; depth: number }> }
  | { type: "quote"; text: string }
  | { type: "code"; lines: string[] }
  | { type: "image"; src: string; alt: string }
  | { type: "table"; rows: string[][]; header: boolean }
  | { type: "hr" };

function mergeRuns(runs: ArticleRun[]): ArticleRun[] {
  const out: ArticleRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.code === !!r.code) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/**
 * Parse rendered article HTML into typed blocks using the browser's own
 * parser — headings, rich-text paragraphs, nested lists, quotes, code,
 * tables, images, hr and mermaid placeholders — so the PDF matches what
 * the reader (and the print view) actually shows.
 */
function parseArticleBlocks(html: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];

  // Non-DOM fallback: flat paragraph split (structure only).
  if (typeof DOMParser === "undefined") {
    for (const para of stripHtml(html).split(/\n{2,}/)) {
      const s = para.trim();
      if (!s) continue;
      if (/^###\s/.test(s)) blocks.push({ type: "h", level: 3, runs: [{ text: s.replace(/^###\s+/, "") }] });
      else if (/^##\s/.test(s)) blocks.push({ type: "h", level: 2, runs: [{ text: s.replace(/^##\s+/, "") }] });
      else blocks.push({ type: "p", runs: [{ text: stripMd(s) }] });
    }
    return blocks;
  }

  const dom = new DOMParser().parseFromString(html, "text/html");

  const collectRuns = (node: Node, inh: ArticleRun, out: ArticleRun[], imgs: string[], alts: string[]): void => {
    if (node.nodeType === 3) {
      out.push({ ...inh, text: (node.textContent ?? "").replace(/\s+/g, " ") });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      out.push({ ...inh, text: "\n" });
      return;
    }
    if (tag === "img") {
      const src = el.getAttribute("src");
      if (src) {
        imgs.push(src);
        alts.push(el.getAttribute("alt") ?? "");
      }
      return;
    }
    const nxt: ArticleRun = {
      ...inh,
      bold: inh.bold || tag === "strong" || tag === "b",
      italic: inh.italic || tag === "em" || tag === "i",
      code: inh.code || tag === "code",
    };
    el.childNodes.forEach((c) => collectRuns(c, nxt, out, imgs, alts));
  };

  const collectInline = (el: Element, forceItalic = false) => {
    const runs: ArticleRun[] = [];
    const imgs: string[] = [];
    const alts: string[] = [];
    el.childNodes.forEach((c) => collectRuns(c, { text: "" }, runs, imgs, alts));
    const merged = mergeRuns(forceItalic ? runs.map((r) => ({ ...r, italic: true })) : runs);
    imgs.forEach((src, i) => blocks.push({ type: "image", src, alt: alts[i] ?? "" }));
    return merged;
  };

  const pushHeading = (el: Element, level: 2 | 3 | 4): void => {
    const runs = collectInline(el);
    if (runs.some((r) => r.text.trim())) blocks.push({ type: "h", level, runs });
  };

  const pushParagraph = (el: Element, forceItalic = false): void => {
    const runs = collectInline(el, forceItalic);
    if (runs.some((r) => r.text.trim())) blocks.push({ type: "p", runs });
  };

  const emitList = (listEl: Element, ordered: boolean, depth: number): void => {
    const items: Array<{ runs: ArticleRun[]; depth: number }> = [];
    const nested: Array<[Element, boolean]> = [];
    const imgs: string[] = [];
    const alts: string[] = [];
    for (const li of Array.from(listEl.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      const runs: ArticleRun[] = [];
      for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === 1) {
          const ct = (child as Element).tagName.toLowerCase();
          if (ct === "ul" || ct === "ol") {
            nested.push([child as Element, ct === "ol"]);
            continue;
          }
        }
        collectRuns(child, { text: "" }, runs, imgs, alts);
      }
      const merged = mergeRuns(runs);
      if (merged.some((r) => r.text.trim())) items.push({ runs: merged, depth });
    }
    if (items.length) blocks.push({ type: "list", ordered, items });
    imgs.forEach((src, i) => blocks.push({ type: "image", src, alt: alts[i] ?? "" }));
    for (const [el, o] of nested) emitList(el, o, depth + 1);
  };

  const hasBlockDescendant = (el: Element): boolean =>
    !!el.querySelector("p,h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,hr,figure,.osler-mermaid");

  const walk = (el: Element): void => {
    switch (el.tagName.toLowerCase()) {
      case "h2":
        pushHeading(el, 2);
        return;
      case "h3":
        pushHeading(el, 3);
        return;
      case "h4":
      case "h5":
      case "h6":
        pushHeading(el, 4);
        return;
      case "p":
        pushParagraph(el);
        return;
      case "ul":
        emitList(el, false, 0);
        return;
      case "ol":
        emitList(el, true, 0);
        return;
      case "blockquote":
        blocks.push({ type: "quote", text: (el.textContent ?? "").replace(/\s+/g, " ").trim() });
        return;
      case "pre":
        blocks.push({ type: "code", lines: (el.textContent ?? "").replace(/\n{3,}/g, "\n\n").split("\n") });
        return;
      case "table": {
        const rows: string[][] = [];
        let header = false;
        for (const tr of Array.from(el.querySelectorAll("tr"))) {
          const cells = Array.from(tr.querySelectorAll("th,td")).map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
          if (cells.length) rows.push(cells);
          if (tr.querySelector("th")) header = true;
        }
        if (rows.length) blocks.push({ type: "table", rows, header });
        return;
      }
      case "hr":
        blocks.push({ type: "hr" });
        return;
      case "figure": {
        const img = el.querySelector("img");
        const src = img?.getAttribute("src");
        if (src) blocks.push({ type: "image", src, alt: img?.getAttribute("alt") ?? "" });
        const cap = el.querySelector("figcaption");
        if (cap) pushParagraph(cap, true);
        return;
      }
      case "details": {
        const sum = el.querySelector("summary");
        if (sum) pushParagraph(sum);
        el.childNodes.forEach((c) => {
          if (c.nodeType === 1 && (c as Element).tagName.toLowerCase() !== "summary") walk(c as Element);
        });
        return;
      }
      case "div": {
        if (el.classList.contains("osler-mermaid")) {
          const encoded = el.getAttribute("data-diagram");
          if (encoded) {
            try {
              blocks.push({ type: "code", lines: decodeURIComponent(encoded).split("\n") });
            } catch {
              // undecodable diagram source — skip
            }
          }
          return;
        }
        if (hasBlockDescendant(el)) {
          el.childNodes.forEach((c) => {
            if (c.nodeType === 1) walk(c as Element);
          });
        } else {
          pushParagraph(el);
        }
        return;
      }
      case "script":
      case "style":
      case "button":
      case "video":
      case "audio":
      case "source":
        return;
      default: {
        if (hasBlockDescendant(el)) {
          el.childNodes.forEach((c) => {
            if (c.nodeType === 1) walk(c as Element);
          });
        } else {
          pushParagraph(el);
        }
      }
    }
  };

  dom.body.childNodes.forEach((c) => {
    if (c.nodeType === 1) walk(c as Element);
    else if ((c.textContent ?? "").trim()) blocks.push({ type: "p", runs: [{ text: (c.textContent ?? "").replace(/\s+/g, " ") }] });
  });
  return blocks;
}

/** Rasterize an article image into a PNG data URL jsPDF can embed. */
async function fetchImageDataUrl(src: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\/(png|jpeg|jpg|webp|gif)/.test(blob.type)) return null;
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0);
    const data = canvas.toDataURL("image/png");
    const dims = { data, w: bmp.width, h: bmp.height };
    bmp.close();
    return dims;
  } catch {
    return null;
  }
}

/**
 * Draw mixed bold/italic/code runs with greedy word-wrap, flowing through
 * `checkPage` so long paragraphs survive column/page breaks. Arabic
 * paragraphs fall back to the RTL-aware `text()` primitive — word-by-word
 * Latin-style placement would scramble visual RTL order.
 */
function renderRichParagraph(
  doc: PdfDoc,
  runs: ArticleRun[],
  xIn: number,
  maxW: number,
  sizePt: number,
  color: RGB,
  styleOpts?: { barColor?: RGB; italicAll?: boolean },
): void {
  const d = doc.doc;
  const px = sizePt * doc.L.typeScale * doc.L.fontSizeMultiplier;
  const lineH = lh(px, 1.5);
  const plain = runs.map((r) => r.text).join("");

  if (hasArabic(plain)) {
    doc.y = doc.text(plain, xIn, doc.y, {
      font: styleOpts?.italicAll ? "Bi" : "B",
      size: sizePt,
      color,
      maxW,
      paginate: true,
    });
    return;
  }

  // Word space advance is measured once in the base body font — per-run
  // measurement made gaps visibly uneven between regular and bold words.
  d.setFont(F.B, "normal");
  const spaceW = Math.max(d.getTextWidth(" "), px * 0.09);

  type Tok = { t: string; font: string; style: string; color: RGB; w: number };
  const toks: Tok[] = [];
  for (const raw of runs) {
    const r: ArticleRun = { ...raw, italic: raw.italic || !!styleOpts?.italicAll };
    // Lora ships without a bold weight — bold emphasis uses the sans
    // medium face (the established inline-emphasis style); bold+italic
    // falls back to the registered Poppins bolditalic.
    let font: string;
    let styl: string;
    if (r.code) {
      font = F.Hn;
      styl = "normal";
    } else if (r.bold && r.italic) {
      font = "Poppins";
      styl = "bolditalic";
    } else if (r.bold) {
      font = F.Bb;
      styl = "normal";
    } else if (r.italic) {
      font = F.Bi;
      styl = "italic";
    } else {
      font = F.B;
      styl = "normal";
    }
    const rc: RGB = r.code ? C.COBALT : color;
    r.text.split("\n").forEach((seg, idx) => {
      if (idx > 0) toks.push({ t: "\n", font, style: styl, color: rc, w: 0 });
      for (const wd of seg.split(/(\s+)/)) {
        if (!wd) continue;
        const isSpace = wd.trim() === "";
        if (isSpace) {
          toks.push({ t: " ", font, style: styl, color: rc, w: spaceW });
        } else {
          d.setFont(font, styl);
          toks.push({ t: wd, font, style: styl, color: rc, w: d.getTextWidth(wd) });
        }
      }
    });
  }

  const off = xIn - doc.colX;
  let line: Tok[] = [];
  let lineW = 0;
  const flushLine = () => {
    while (line.length && line[line.length - 1].t.trim() === "") line.pop();
    if (!line.length) return;
    doc.checkPage(lineH);
    if (styleOpts?.barColor) {
      d.setFillColor(...styleOpts.barColor);
      d.rect(doc.colX + off - 3.4, doc.y - px * 0.28, 1.4, lineH, "F");
    }
    let tx = doc.colX + off;
    for (const tok of line) {
      d.setFont(tok.font, tok.style);
      d.setTextColor(...tok.color);
      d.text(tok.t, tx, doc.y);
      tx += tok.w;
    }
    doc.y += lineH;
    line = [];
    lineW = 0;
  };

  for (const tok of toks) {
    if (tok.t === "\n") {
      flushLine();
    } else if (tok.t.trim() === "") {
      if (line.length && lineW + tok.w <= maxW) {
        line.push(tok);
        lineW += tok.w;
      }
    } else {
      if (lineW + tok.w > maxW && line.some((tk) => tk.t.trim() !== "")) flushLine();
      line.push(tok);
      lineW += tok.w;
    }
  }
  flushLine();
}


export async function generateArticlePdf(cfg: ArticlePdfConfig): Promise<jsPDF> {
  const opts = cfg.opts;
  const lang = opts.lang ?? "en";
  const doc = new PdfDoc(opts.page, cfg.title, opts.styleMode, opts.fontSize, opts.fontType, lang, "article");
  const L = doc.L;
  const density = L.density;
  const ts = L.typeScale;
  const t = doc.t;
  doc.setMeta({ title: cfg.title, author: opts.author || cfg.author, subject: t("pdf.meta.libraryArticle") });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: cfg.title,
        subtitle: cfg.subtitle,
        eyebrow: t("pdf.tpl.libraryArticle"),
        author: opts.author || cfg.author,
        date: doc.formatToday(),
        features: [t("pdf.tpl.feature.printedFromLibrary")],
      },
      0,
      0,
    );
    doc.addBookmark(t("pdf.tpl.cover"));
    doc.newPage();
  }
  const contentStartPage = opts.includeCover ? 2 : 1;

  // setHeader BEFORE the first drawChrome — calling both here and inside
  // newPage drew the header/footer twice on page 1 (double-printed text).
  doc.setHeader(t("pdf.tpl.article"), "article");
  doc.y = L.mt;
  doc.drawChrome();
  doc.addBookmark(cfg.title);

  const d = doc.doc;
  const x = L.ms;
  const fw = L.fw;

  {
    const titleIsAr = hasArabic(cfg.title);
    d.setFont(titleIsAr ? "Cairo" : F.H, hs("bold"));
    d.setFontSize(17 * ts);
    d.setTextColor(...C.INK);
    const titleLines: string[] = d.splitTextToSize(cfg.title, fw);
    if (titleIsAr) d.text(titleLines, x + fw, doc.y, { align: "right" });
    else d.text(titleLines, x, doc.y);
    doc.y += titleLines.length * lh(17 * ts, titleIsAr ? 1.3 : 1.45) + sp(2, density);
  }

  const metaParts: string[] = [];
  if (cfg.author) metaParts.push(cfg.author);
  metaParts.push(doc.formatToday());
  d.setFont(F.Hn, hs("normal"));
  d.setFontSize(7.6 * ts);
  d.setTextColor(...C.MUTED);
  d.text(tlabel(metaParts.join("   ·   ")), x, doc.y);
  doc.y += sp(2, density);

  doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
  doc.y += sp(2, density);

  const blocks = parseArticleBlocks(cfg.content);

  // Render blocks — DOM-derived structure mirrors the print view.
  for (const block of blocks) {
    switch (block.type) {
      case "h": {
        const style = { 2: { size: 14, font: F.H, color: C.INK, rule: true }, 3: { size: 11.5, font: F.H, color: C.COBALT, rule: false }, 4: { size: 9.8, font: F.Hm, color: C.SLATE, rule: false } }[block.level];
        doc.checkPage(sp(style.size * 0.55, density));
        doc.y += sp(1.5, density);
        const hText = normalizeText(block.runs.map((r) => r.text).join("").trim());
        const hIsAr = hasArabic(hText);
        d.setFont(hIsAr ? "Cairo" : style.font, hs("bold"));
        d.setFontSize(style.size * ts);
        d.setTextColor(...style.color);
        const hLines: string[] = d.splitTextToSize(hText, fw);
        if (hIsAr) d.text(hLines, x + fw, doc.y, { align: "right" });
        else d.text(hLines, x, doc.y);
        doc.y += hLines.length * lh(style.size * ts, hIsAr ? 1.3 : 1.45);
        if (style.rule) {
          doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
          doc.y += sp(1, density);
        } else {
          doc.y += sp(1.2, density);
        }
        break;
      }
      case "p": {
        doc.checkPage(sp(3, density));
        renderRichParagraph(doc, block.runs, x, fw, 9.4, C.CHARCOAL);
        doc.y += sp(1.2, density);
        break;
      }
      case "list": {
        doc.checkPage(sp(4, density));
        doc.y += sp(0.5, density);
        block.items.forEach((item, i) => {
          const itemIsAr = item.runs.some((r) => hasArabic(r.text));
          const indent = 4 + item.depth * 4;
          const marker = block.ordered ? `${i + 1}.` : "\u2022";
          d.setFont(itemIsAr ? "Cairo" : F.Hm, hs("normal"));
          d.setFontSize(8.4 * ts);
          d.setTextColor(...C.COBALT);
          const markerW = d.getTextWidth(marker) + 2;
          // Reserve room for at least two body lines so a marker is never
          // stranded at a column/page bottom.
          doc.checkPage(lh(9.4 * ts, 1.5) * 2);
          if (itemIsAr) {
            d.text(marker, x + fw - indent, doc.y, { align: "right" });
            renderRichParagraph(doc, item.runs, x, fw - indent - markerW, 9.4, C.CHARCOAL);
          } else {
            d.text(marker, x + indent, doc.y);
            renderRichParagraph(doc, item.runs, x + indent + markerW, fw - indent - markerW - 2, 9.4, C.CHARCOAL);
          }
          doc.y += sp(0.35, density);
        });
        doc.y += sp(1.2, density);
        break;
      }
      case "quote": {
        doc.checkPage(sp(5, density));
        doc.y += sp(0.5, density);
        renderRichParagraph(doc, [{ text: stripMd(block.text) }], x + 5, fw - 7, 8.8, C.SLATE, {
          barColor: C.COBALT,
          italicAll: !hasArabic(block.text),
        });
        doc.y += sp(1.5, density);
        break;
      }
      case "code": {
        const codeLineH = lh(7.8 * ts, 1.35);
        let li = 0;
        while (li < block.lines.length) {
          doc.checkPage(codeLineH * 2 + 4);
          const avail = L.ph - L.mb - doc.y - 5;
          const fit = Math.max(1, Math.floor((avail - 3) / codeLineH));
          const chunk = block.lines.slice(li, li + fit).map(normalizeText);
          const panelH = chunk.length * codeLineH + 3;
          d.setFillColor(...C.RULE_SOFT);
          d.setDrawColor(...C.RULE);
          d.setLineWidth(0.3);
          d.roundedRect(x, doc.y, fw, panelH, 1, 1, "FD");
          d.setFillColor(...C.COBALT);
          d.rect(x, doc.y, 1.2, panelH, "F");
          d.setFont(F.Hn, hs("normal"));
          d.setFontSize(7.8 * ts);
          d.setTextColor(...C.CHARCOAL);
          d.text(chunk, x + 5, doc.y + 2.8);
          doc.y += panelH + sp(0.5, density);
          li += chunk.length;
        }
        doc.y += sp(1.5, density);
        break;
      }
      case "image": {
        const img = await fetchImageDataUrl(block.src);
        if (!img || img.w === 0 || img.h === 0) break;
        const sc = Math.min((fw - 10) / img.w, (L.ph * 0.45) / img.h, 1);
        const drawW = img.w * sc;
        const drawH = img.h * sc;
        doc.checkPage(drawH + 10);
        d.setFillColor(255, 255, 255);
        d.setDrawColor(...C.RULE);
        d.setLineWidth(0.3);
        d.rect(doc.colX + (fw - drawW) / 2, doc.y, drawW, drawH, "FD");
        try {
          d.addImage(img.data, "PNG", doc.colX + (fw - drawW) / 2 + 0.3, doc.y + 0.3, drawW - 0.6, drawH - 0.6);
        } catch {
          // corrupt/unsupported bitmap — leave the framed placeholder empty
        }
        doc.y += drawH + 1.5;
        if (block.alt) {
          const altIsAr = hasArabic(block.alt);
          d.setFont(altIsAr ? "Cairo" : F.Bi, hs("italic"));
          d.setFontSize(7.6 * ts);
          d.setTextColor(...C.MUTED);
          const capLines: string[] = d.splitTextToSize(normalizeText(stripMd(block.alt)), fw - 20);
          if (altIsAr) d.text(capLines, x + fw, doc.y, { align: "right" });
          else d.text(capLines, x + fw / 2, doc.y, { align: "center" });
          doc.y += capLines.length * lh(7.6 * ts);
        }
        doc.y += sp(1.5, density);
        break;
      }
      case "table": {
        doc.checkPage(sp(8, density));
        doc.y += sp(1, density);
        const rows = block.rows;
        if (rows.length > 0) {
          const colCount = Math.max(...rows.map((r) => r.length));
          const colW = fw / colCount;
          // Pre-measure every cell so each row is as tall as its tallest
          // wrapped line — fixed-height rows truncated real content.
          const measured = rows.map((row) =>
            row.map((cellText) => {
              const cellIsAr = hasArabic(cellText);
              d.setFont(cellIsAr ? "Cairo" : F.Hm, hs("normal"));
              return {
                text: cellText,
                isAr: cellIsAr,
                lines: d.splitTextToSize(normalizeText(cellText), colW - 3) as string[],
              };
            }),
          );
          const rowHeight = (row: typeof measured[number]) =>
            Math.max(5.5 * ts, Math.min(Math.max(...row.map((c) => c.lines.length)), 4) * 3.6 * ts + 2);
          const headerRow = block.header ? measured[0] : null;
          for (let ri = 0; ri < rows.length; ri++) {
            const row = measured[ri];
            const cellH = rowHeight(row);
            // A page/column break mid-table loses the column labels —
            // detect the jump and re-draw the header row first.
            const beforePage = doc.page;
            const beforeCol = doc.col;
            const beforeY = doc.y;
            doc.checkPage(cellH + 2);
            if ((doc.page !== beforePage || doc.col !== beforeCol || doc.y < beforeY - 1) && headerRow && ri !== 0) {
              drawTableRow(doc, headerRow, true, x, colW, colCount, rowHeight(headerRow));
              doc.y += rowHeight(headerRow);
            }
            drawTableRow(doc, row, !!headerRow && ri === 0, x, colW, colCount, cellH);
            doc.y += cellH;
          }
          doc.y += sp(1.5, density);
        }
        break;
      }
      case "hr": {
        doc.checkPage(sp(3, density));
        doc.y += sp(1, density);
        doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
        doc.y += sp(1, density);
        break;
      }
    }
  }

  doc.finalize(contentStartPage);
  return doc.doc;
}

/** One table row for the article renderer — cells pre-measured by the caller. */
function drawTableRow(
  doc: PdfDoc,
  row: Array<{ text: string; isAr: boolean; lines: string[] }>,
  isHeader: boolean,
  x: number,
  colW: number,
  colCount: number,
  cellH: number,
): void {
  const d = doc.doc;
  const ts = doc.L.typeScale;
  for (let ci = 0; ci < colCount; ci++) {
    const cellX = x + ci * colW;
    const cell = row[ci] ?? { text: "", isAr: false, lines: [] as string[] };
    d.setFillColor(...(isHeader ? C.PALE_BLUE : C.WHITE));
    d.setDrawColor(...C.RULE);
    d.setLineWidth(0.2);
    d.rect(cellX, doc.y, colW, cellH, "FD");
    d.setFont(cell.isAr ? "Cairo" : F.Hm, hs(isHeader ? "bold" : "normal"));
    d.setFontSize(isHeader ? 7.6 * ts : 7.2 * ts);
    d.setTextColor(...(isHeader ? C.COBALT : C.CHARCOAL));
    const shown = cell.lines.slice(0, 4);
    if (cell.isAr) {
      d.text(shown, cellX + colW - 1.5, doc.y + 3.4, { align: "right" });
    } else {
      d.text(shown, cellX + 1.5, doc.y + 3.4);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// § 13  DOWNLOAD HELPER
// ═══════════════════════════════════════════════════════════════

/** Sanitize a filename while preserving non-Latin scripts (Arabic titles
 *  previously collapsed to "export.pdf"). Strips filesystem-hostile
 *  characters only; falls back to "export" when nothing printable remains. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "export";
}

export function downloadPdf(doc: jsPDF, filename: string): void {
  doc.save(`${safeFilename(filename)}.pdf`);
}
