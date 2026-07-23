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
    article: { bg: [234, 236, 240], fg: [63, 71, 87] },
  } as Record<string, { bg: RGB; fg: RGB }>,
};

type SectionKey = keyof typeof C.SECTION;

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
    .replace(/\u2713|\u2714/g, "[X]")
    .replace(/\u2717|\u2718/g, "[ ]")
    .replace(/\u25BA|\u25B6/g, ">")
    .replace(/\u2002|\u2003|\u00A0/g, " ")
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

function detectHtmlHeading(line: string): { level: number; text: string } | null {
  const m = line.match(/^<h([2-3])\b[^>]*>(.+?)<\/h[2-3]>/i);
  if (m) return { level: parseInt(m[1], 10), text: m[2].replace(/<[^>]+>/g, "") };
  return null;
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Cairo (the Arabic PDF font) has all initial/medial/final presentation forms
 * but is missing ISOLATED forms (42 codepoints in FE70-FEFC and FB50-FDFF).
 * This fallback replaces any missing presentation codepoint with its basic
 * Arabic equivalent so isolated letters render instead of appearing as tofu.
 */
const ARABIC_PRES_FALLBACK: Record<number, number> = {
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

function fallbackArabicPres(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const fallback = ARABIC_PRES_FALLBACK[cp];
    out += fallback ? String.fromCharCode(fallback) : text[i];
  }
  return out;
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "\u2026";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Small-caps tracking via inter-character spacing (no kerning API in core PDF text). */
function tracked(text: string): string {
  return text.split("").join(" ");
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

  headerLabel = "";
  section: SectionKey = "questions";

  colX = 0;
  col: 0 | 1 = 0;
  colTopY = 0;
  twoColEnabled = false;

  /** Chapter number → the physical page it starts on (for TOC + bookmarks). */
  chapterPages: number[] = [];

  constructor(cfg: PdfPageConfig, title: string, styleMode: StyleMode, fontSizeOpt?: "small" | "medium" | "large", fontTypeOpt?: "serif" | "sans") {
    this.L = computeLayout(cfg, styleMode, fontSizeOpt, fontTypeOpt);
    this.title = title;
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
    this.doc.setLineHeightFactor(1.15);
    this.y = this.L.mt;
    const registered = registerPdfFonts(this.doc);
    if (!registered && typeof console !== "undefined") {
      console.warn("[osler/pdf] Custom fonts were not ready in time — falling back to core PDF fonts.");
    }
    resolveFonts(this.doc, this.L.fontType);
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

    // Top hairline — the one saturated line on every content page.
    d.setFillColor(...C.GOLD);
    d.rect(0, 0, pw, 0.85, "F");

    // Document title, tracked small caps, left aligned.
    const baseline = hh * 0.58;
    d.setFont(F.Hm, hs("normal"));
    d.setFontSize(7.4 * typeScale);
    d.setTextColor(...C.INK);
    d.text(tracked(trunc(this.title, 52).toUpperCase()), ms, baseline);

    // Section pill, right aligned.
    if (this.headerLabel) {
      const label = tracked(this.headerLabel.toUpperCase());
      d.setFont(F.H, hs("bold"));
      d.setFontSize(6.4 * typeScale);
      const tw = d.getTextWidth(label);
      const padX = 3.2;
      const pillW = tw + padX * 2;
      const pillH = 5.6 * typeScale;
      const pillX = pw - ms - pillW;
      const pillY = baseline - pillH * 0.72;
      d.setFillColor(...tint.bg);
      d.roundedRect(pillX, pillY, pillW, pillH, pillH / 2, pillH / 2, "F");
      d.setTextColor(...tint.fg);
      d.text(label, pillX + pillW / 2, pillY + pillH * 0.68, { align: "center" });
    }

    // Header rule.
    d.setDrawColor(...C.RULE);
    d.setLineWidth(0.3);
    d.line(ms, hh, pw - ms, hh);

    // Two-column divider — drawn only on question-content pages (not
    // cover, TOC, answer key, or report sections) so early/section-break
    // pages never get a stray divider.
    if (this.twoColEnabled) {
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

    // Brand wordmark, bottom-left.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(6.2 * typeScale);
    d.setTextColor(...C.MUTED);
    d.text(tracked("OSLER"), ms, footerBaseline);

    // Short doc title, bottom-right (helps loose printed pages find their way home).
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(6.2 * typeScale);
    d.setTextColor(...C.MUTED);
    d.text(trunc(this.title, 34), pw - ms, footerBaseline, { align: "right" });

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
  newPage(opts: { skipOutgoing?: boolean; header?: { label: string; section: SectionKey } } = {}): void {
    if (!opts.skipOutgoing) this.drawChrome();
    this.doc.addPage();
    this.page++;
    this.col = 0;
    this.colX = this.L.ms;
    this.y = this.L.mt;
    this.colTopY = this.L.mt;
    if (opts.header) {
      this.headerLabel = opts.header.label;
      this.section = opts.header.section;
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
    } = {},
  ): number {
    const d = this.doc;
    const raw = stripMd(str);
    const isArabic = hasArabic(raw);

    let font: string;
    let style: string;
    if (isArabic) {
      font = "Cairo";
      style = opts.style === "bold" ? "bold" : "normal";
    } else {
      font = F[opts.font ?? "B"];
      style = opts.style ?? "normal";
    }

    const size = (opts.size ?? 9.5) * this.L.typeScale * this.L.fontSizeMultiplier;
    d.setFont(font, hs(style));
    d.setFontSize(size);
    d.setTextColor(...(opts.color ?? C.CHARCOAL));

    const maxW = opts.maxW ?? this.L.fw;
    const normalized = normalizeText(raw);
    const lines: string[] = d.splitTextToSize(normalized, maxW);
    if (isArabic) {
      d.setR2L(true);
      d.text(lines, x + maxW, y, { align: "right", isOutputVisual: true });
      d.setR2L(false);
    } else {
      d.text(lines, x, y, { align: opts.align ?? "left" });
    }
    return y + lines.length * lh(size, isArabic ? 1.3 : (opts.lineFactor ?? 1.45));
  }

  hRule(y: number, w: number, thick = 0.3, color: RGB = C.RULE, x?: number): number {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(thick);
    this.doc.line(x ?? this.L.ms, y, (x ?? this.L.ms) + w, y);
    return y + 3.6 * this.L.density;
  }

  doubleRule(y: number, w: number): number {
    const d = this.doc;
    d.setDrawColor(...C.GOLD);
    d.setLineWidth(1.6);
    d.line(this.L.ms, y, this.L.ms + w, y);
    d.setLineWidth(0.5);
    d.line(this.L.ms, y + 2.4, this.L.ms + w, y + 2.4);
    return y + 8 * this.L.density;
  }

  trackedLabel(text: string, x: number, y: number, size = 10, color: RGB = C.COBALT): number {
    const d = this.doc;
    d.setFont(F.H, hs("bold"));
    d.setFontSize(size * this.L.typeScale);
    d.setTextColor(...color);
    d.text(tracked(text), x, y);
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
    const bodyLines: string[] = d.splitTextToSize(normalizeText(rawBody), bodyMaxW);
    const bodyH = bodyLines.length * lh(bodySize, bodyHasArabic ? 1.3 : 1.45);
    const labelH = sp(4, density);
    const totalH = labelH + bodyH + sp(1.5, density);

    this.checkPage(totalH + 6);
    const boxY = this.y;

    d.setFillColor(...bg);
    d.setDrawColor(...border);
    d.setLineWidth(0.5);
    d.roundedRect(x, boxY, w, totalH, 1.2, 1.2, "FD");

    d.setFont(F.H, hs("bold"));
    d.setFontSize(6.6 * this.L.typeScale);
    d.setTextColor(...border);
    d.text(tracked(label), x + pad, boxY + sp(1.5, density));

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
    const boxY = this.y;
    d.setFillColor(...C.EMERALD);
    d.roundedRect(x, boxY, w, badgeH, 1.2, 1.2, "F");

    const iconCx = x + pad + 1.6;
    const iconCy = boxY + badgeH / 2;
    d.setFillColor(255, 255, 255);
    d.circle(iconCx, iconCy, 2.1, "F");
    drawCheck(d, iconCx, iconCy, 2.4, C.EMERALD);

    const label = `Correct Answer — ${letter}.  ${trunc(stripMd(optText), 78)}`;
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
    d.setFillColor(...C.NAVY);
    d.rect(0, 0, pw, ph, "F");

    // Simulated vertical vignette — soft light center, deep edges.
    const bands = 56;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const curve = Math.sin(Math.PI * t); // 0 at edges, 1 at center
      const color = lerp(C.NAVY_DEEP, C.NAVY_SOFT, curve * 0.55);
      const bandH = ph / bands;
      d.setFillColor(...color);
      d.rect(0, i * bandH, pw, bandH + 0.4, "F");
    }

    // Hairline double frame, inset from the edge.
    const inset = pw * 0.045;
    const inset2 = inset + 1.1;
    d.setDrawColor(...C.GOLD_DEEP);
    d.setLineWidth(0.35);
    d.rect(inset, inset, pw - inset * 2, ph - inset * 2, "S");
    d.setDrawColor(...C.GOLD_SOFT);
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
    d.setDrawColor(...C.GOLD_SOFT);
    d.setLineWidth(0.3);
    for (const [cx, cy, dx, dy] of corners) {
      d.line(cx, cy, cx - dx * tick, cy);
      d.line(cx, cy, cx, cy - dy * tick);
    }

    let cy = ph * 0.185;

    // Eyebrow.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(8.2);
    d.setTextColor(...C.GOLD_SOFT);
    d.text(tracked(cfg.eyebrow ?? "OSLER REPORT"), pw / 2, cy, { align: "center" });
    cy += 13;

    // Brand mark.
    drawPulseMark(d, pw / 2, cy, pw * 0.028, [90, 118, 148], C.GOLD_SOFT);
    cy += pw * 0.028 + 12;

    // Title.
    const titleSize = clamp(pw * 0.155, 26, 40);
    d.setFont(F.H, hs("bold"));
    d.setFontSize(titleSize);
    d.setTextColor(...C.WHITE);
    const titleLines: string[] = d.splitTextToSize(normalizeText(cfg.title || "Report"), pw * 0.76);
    d.text(titleLines, pw / 2, cy, { align: "center" });
    cy += titleLines.length * lh(titleSize, 1.08) + 6;

    // Subtitle.
    if (cfg.subtitle) {
      const subSize = clamp(pw * 0.058, 11, 16);
      d.setFont(F.Bi, hs("italic"));
      d.setFontSize(subSize);
      d.setTextColor(198, 214, 232);
      const subLines: string[] = d.splitTextToSize(normalizeText(cfg.subtitle), pw * 0.62);
      d.text(subLines, pw / 2, cy, { align: "center" });
      cy += subLines.length * lh(subSize) + 5;
    }

    // Divider.
    cy += 3;
    d.setDrawColor(...C.GOLD);
    d.setLineWidth(1.4);
    d.line(pw * 0.32, cy, pw * 0.68, cy);
    d.setLineWidth(0.4);
    d.line(pw * 0.32, cy + 2.2, pw * 0.68, cy + 2.2);
    cy += 12;

    // Metadata.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(9.5);
    d.setTextColor(160, 182, 208);
    const metaBits = [cfg.author, cfg.date].filter(Boolean) as string[];
    if (metaBits.length) {
      d.text(metaBits.join("   ·   "), pw / 2, cy, { align: "center" });
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
      if (chCount > 0) parts.push(`${chCount} ${chCount === 1 ? "CHAPTER" : "CHAPTERS"}`);
      if (totalQ > 0) parts.push(`${totalQ} ${totalQ === 1 ? "QUESTION" : "QUESTIONS"}`);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(9.5);
      const widths = parts.map((p) => d.getTextWidth(tracked(p)));
      const sepW = 8;
      const totalW = widths.reduce((a, b) => a + b, 0) + sepW * (parts.length - 1);
      let sx = pw / 2 - totalW / 2;
      for (let i = 0; i < parts.length; i++) {
        d.setTextColor(...C.GOLD_SOFT);
        d.text(tracked(parts[i]), sx, cy, { align: "left" });
        sx += widths[i];
        if (i < parts.length - 1) {
          d.setDrawColor(120, 140, 164);
          d.setLineWidth(0.3);
          d.line(sx + sepW / 2, cy - 3, sx + sepW / 2, cy - 3 + 4.2);
          sx += sepW;
        }
      }
      cy += 10;
    }

    // Feature checklist.
    const features = cfg.features ?? [];
    if (features.length) {
      cy += 3;
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(8.6);
      for (const f of features) {
        const fw = d.getTextWidth(f);
        const fx = pw / 2 - fw / 2;
        drawCheck(d, fx - 6, cy - 1.6, 3, C.GOLD_SOFT);
        d.setTextColor(206, 222, 240);
        d.text(f, fx, cy, { align: "left" });
        cy += 6.4;
      }
    }

    // Footer note, inside the frame.
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(7.4);
    d.setTextColor(96, 118, 144);
    d.text(cfg.footerNote ?? "Prepared by Osler", pw / 2, ph - inset - 7, { align: "center" });
  }

  // ── Table of contents ──

  drawTocEntry(chNum: number, title: string, qCount: number, desc: string, targetPage: number): void {
    const d = this.doc;
    const density = this.L.density;
    this.checkPage(sp(6, density) + (desc ? 8 : 0));

    const entryTop = this.y;
    d.setFont(F.H, hs("bold"));
    d.setFontSize(7.6 * this.L.typeScale);
    d.setTextColor(...C.GOLD);
    d.text(`CH ${String(chNum).padStart(2, "0")}`, this.L.ms, this.y);
    this.y += sp(2.6, density);

    d.setFont(F.Hm, hs("normal"));
    d.setFontSize(11 * this.L.typeScale);
    d.setTextColor(...C.CHARCOAL);
    d.text(trunc(title, 62), this.L.ms + 1.5, this.y);

    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7.6 * this.L.typeScale);
    d.setTextColor(...C.MUTED);
    d.text(`${qCount} Q`, this.L.ms + this.L.fw, this.y, { align: "right" });

    const linkH = desc ? 15 : 10;
    d.link(this.L.ms, entryTop - 5, this.L.fw, linkH, { pageNumber: targetPage });
    this.y += sp(3, density);

    if (desc) {
      d.setFont(F.Bi, hs("italic"));
      d.setFontSize(8.2 * this.L.typeScale);
      d.setTextColor(...C.MUTED);
      const lines: string[] = d.splitTextToSize(stripMd(desc), this.L.fw - 8);
      d.text(lines, this.L.ms + 4, this.y);
      this.y += lines.length * lh(8.2 * this.L.typeScale) + sp(1, density);
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
        d.setFont(F.H, hs("bold"));
        d.setFontSize(20 * this.L.typeScale);
        d.setTextColor(...C.INK);
        const lines: string[] = d.splitTextToSize(title, fw);
        d.text(lines, this.L.ms + fw / 2, this.y, { align: "center" });
        this.y += lines.length * lh(20 * this.L.typeScale, 1.2) + sp(1.5, density);
      }
      if (desc) {
        d.setFont(F.Bi, hs("italic"));
        d.setFontSize(9.5 * this.L.typeScale);
        d.setTextColor(...C.MUTED);
        const lines: string[] = d.splitTextToSize(stripMd(desc), fw - 10);
        d.text(lines, this.L.ms + fw / 2, this.y, { align: "center" });
        this.y += lines.length * lh(9.5 * this.L.typeScale) + sp(2.5, density);
      }
      this.y = this.hRule(this.y, fw * 0.28, 0.6, C.GOLD, this.L.ms + fw * 0.36);
      this.y += sp(1.5, density);
    } else {
      this.checkPage(34);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(7.6 * this.L.typeScale);
      d.setTextColor(...C.GOLD);
      d.text(tracked(`CHAPTER ${String(chNum).padStart(2, "0")}`), this.L.ms, this.y);
      this.y += sp(3, density);

      d.setFont(F.H, hs("bold"));
      d.setFontSize(16 * this.L.typeScale);
      d.setTextColor(...C.INK);
      d.text(title, this.L.ms, this.y);
      this.y += sp(3.5, density);

      if (desc) {
        d.setFont(F.Bi, hs("italic"));
        d.setFontSize(8.6 * this.L.typeScale);
        d.setTextColor(...C.MUTED);
        const lines: string[] = d.splitTextToSize(stripMd(desc), fw - 10);
        d.text(lines, this.L.ms, this.y);
        this.y += lines.length * lh(8.6 * this.L.typeScale) + sp(2.5, density);
      }
      this.y = this.hRule(this.y, fw, 1, C.GOLD);
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
        const cl = d.splitTextToSize(normalizeText(raw), cw - 15).length;
        h += cl * lh(8.6 * ts, isAr ? 1.3 : 1.45) + sp(0.4, density);
      }
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
      d.text(`Q${qNum}`, x, this.y);
      this.y += sp(1.5, density);
    } else {
      this.y = this.trackedLabel(`QUESTION ${qNum}`, x, this.y, 9.5, C.COBALT);
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
      });
      this.y += sp(1.5, density);
    }

    // ── Options ──
    if (!isWritten && q.choices.length > 0) {
      const showInline = answersMode === "inline";
      for (let i = 0; i < q.choices.length; i++) {
        const letter = LETTERS[i] ?? String(i + 1);
        const isCorrect = i === q.correct;
        const highlight = showInline && isCorrect;
        const choiceText = q.choices[i];
        const isChoiceArabic = hasArabic(stripMd(choiceText));

        if (isChoiceArabic) {
          d.setFont("Cairo", hs("bold"));
          d.setFontSize(8.4 * this.L.typeScale);
          d.setTextColor(...(highlight ? C.EMERALD : C.ROYAL));
          d.text(`${letter}`, x + cw - 3.2, this.y, { align: "right" });
          if (highlight) drawCheck(d, x + cw - 8.6, this.y - 1.4, 2.4, C.EMERALD);
          this.y = this.text(choiceText, x, this.y, {
            font: "B", size: 8.6,
            color: (highlight ? C.EMERALD : C.SLATE),
            maxW: cw - 18,
            align: "right",
          });
        } else {
          d.setFont(F.H, hs("bold"));
          d.setFontSize(8.4 * this.L.typeScale);
          d.setTextColor(...(highlight ? C.EMERALD : C.ROYAL));
          d.text(`${letter}`, x + 3.2, this.y);
          if (highlight) drawCheck(d, x + 8.6, this.y - 1.4, 2.4, C.EMERALD);
          this.y = this.text(choiceText, x + 13, this.y, {
            font: highlight ? "Bb" : "B",
            size: 8.6,
            color: (highlight ? C.EMERALD : C.SLATE),
            maxW: cw - 15,
          });
        }
        this.y += sp(0.4, density);
      }
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
        this.y = this.calloutBox("EXPLANATION", q.explanation, this.y, cw, x, C.PALE_GREEN, C.SAGE);
      }
    }

    if (isWritten && q.modelAnswer && showExpl) {
      this.y += sp(0.5, density);
      cw = opts.twoCol ? this.L.cw : this.L.fw; x = this.colX;
      this.y = this.calloutBox("MODEL ANSWER", q.modelAnswer, this.y, cw, x, C.PALE_BLUE, C.ROYAL);
    }

    if (isWritten && q.rubric?.length && showExpl) {
      this.y += sp(0.5, density);
      cw = opts.twoCol ? this.L.cw : this.L.fw; x = this.colX;
      this.y = this.calloutBox(
        "RUBRIC CRITERIA",
        q.rubric.map((r, ri) => `${ri + 1}. ${r}`).join("\n"),
        this.y,
        cw,
        x,
        [244, 242, 253],
        [118, 98, 178],
      );
    }

    if ((answersMode === "endchapter" || answersMode === "endbook") && !isWritten) {
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(7 * this.L.typeScale);
      d.setTextColor(...C.LINK);
      d.text("See Answer Key ->", x + cw, this.y, { align: "right" });
      this.y += sp(1.5, density);
    }

    this.y = this.hRule(this.y, cw, 0.25, C.RULE, x);
    this.y += sp(0.75, density);
  }

  // ── Answer key ──

  drawAnswerKeyBanner(title: string): void {
    const d = this.doc;
    const density = this.L.density;
    const fw = this.L.fw;
    const bannerH = sp(9, density);
    this.checkPage(bannerH + sp(3, density));

    d.setFillColor(...C.EMERALD);
    d.roundedRect(this.L.ms, this.y, fw, bannerH, 1.2, 1.2, "F");
    d.setFillColor(...C.GOLD);
    d.rect(this.L.ms, this.y, 1.6, bannerH, "F");

    d.setFont(F.H, hs("bold"));
    d.setFontSize(11 * this.L.typeScale);
    d.setTextColor(...C.WHITE);
    d.text(tracked(title), this.L.ms + 8, this.y + bannerH / 2 + 1.6);

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

    this.y = this.trackedLabel(`ANSWER ${qNum}`, x, this.y, 9.5, C.EMERALD);
    this.y = this.hRule(this.y, cw, 1.1, C.SAGE);
    this.y += sp(1, density);

    this.y = this.text(`"${trunc(stripMd(q.stem), 110)}"`, x, this.y, {
      font: "Bi",
      size: 8,
      color: C.MUTED,
      maxW: cw,
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
      this.y = this.text(q.explanation, x, this.y, { font: "B", size: 8.8, color: C.CHARCOAL, maxW: cw });
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
    d.text(tracked("YOUR SCORE"), cx, this.y + cardH * 0.22, { align: "center" });

    const scoreCol: RGB = score.pct >= 70 ? C.EMERALD : score.pct >= 50 ? C.GOLD_DEEP : C.CRIMSON;
    d.setFont(F.H, hs("bold"));
    d.setFontSize(25 * ts);
    d.setTextColor(...scoreCol);
    d.text(`${score.pct}%`, cx, this.y + cardH * 0.6, { align: "center" });

    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(6.6 * ts);
    d.setTextColor(...C.MUTED);
    d.text(`${score.correct} of ${score.total} correct`, cx, this.y + cardH * 0.85, { align: "center" });

    // Col 2 — percentile.
    cx = midX + colW / 2;
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(6.6 * ts);
    d.setTextColor(...C.MUTED);
    d.text(tracked("PERCENTILE"), cx, this.y + cardH * 0.22, { align: "center" });

    d.setFont(F.H, hs("bold"));
    d.setFontSize(25 * ts);
    d.setTextColor(...C.ROYAL);
    d.text(`${score.percentile}`, cx, this.y + cardH * 0.6, { align: "center" });
    const numW = d.getTextWidth(`${score.percentile}`);
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7.5 * ts);
    d.text("th", cx + numW / 2 + 2, this.y + cardH * 0.5);

    d.setFontSize(6.6 * ts);
    d.setTextColor(...C.MUTED);
    d.text(`Higher than ${score.percentile}%`, cx, this.y + cardH * 0.85, { align: "center" });

    // Col 3 — stats.
    const stats: [string, string][] = [
      ["Answered", `${score.answered}/${score.total}`],
      ["Incorrect", `${score.incorrect}`],
      ["Flagged", `${score.flagged}`],
      ["Total Time", score.totalTime],
      ["Avg / Q", score.avgTime],
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
    d.text("Score Distribution", x, this.y);
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
      ["Correct", C.ROYAL],
      ["Incorrect", C.CRIMSON],
      ["Unanswered", C.MUTED],
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
    d.text("Question Review", this.L.ms, this.y);
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
}

interface QuestionDrawOpts {
  answersMode: PdfExportOptions["answersMode"];
  showExplanations: boolean;
  styleMode: PdfExportOptions["styleMode"];
  twoCol: boolean;
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
  const doc = new PdfDoc(cfg.page, cfg.cover.title, cfg.styleMode, cfg.fontSize, cfg.fontType);
  const L = doc.L;
  const multiChapter = cfg.chapters.length > 1;
  const totalQ = cfg.chapters.reduce((a, ch) => a + ch.questions.length, 0);
  doc.setMeta({ title: cfg.cover.title, author: cfg.author, subject: "Quiz booklet" });

  const showToc = multiChapter && cfg.includeCover;

  if (cfg.includeCover) {
    doc.drawCover(cfg.cover, totalQ, cfg.chapters.length);
    doc.addBookmark("Cover");
    doc.newPage({
      skipOutgoing: true,
      header: showToc ? { label: "CONTENTS", section: "contents" } : { label: "QUESTIONS", section: "questions" },
    });
  } else {
    doc.setHeader("QUESTIONS", "questions");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = cfg.includeCover ? 2 : 1;

  if (showToc) {
    doc.addBookmark("Contents");

    doc.doc.setFont(F.H, hs("bold"));
    doc.doc.setFontSize(18 * L.typeScale);
    doc.doc.setTextColor(...C.INK);
    doc.doc.text("Table of Contents", L.ms, doc.y);
    doc.y += sp(4, L.density);
    doc.y = doc.doubleRule(doc.y, L.fw);
    doc.y += sp(1.5, L.density);

    cfg.chapters.forEach((ch, i) => {
      const targetPage = knownChapterPages ? knownChapterPages[i + 1] : doc.page;
      doc.drawTocEntry(i + 1, ch.title, ch.questions.length, ch.description ?? "", targetPage);
    });
    doc.newPage({ header: { label: "QUESTIONS", section: "questions" } });
  }

  let globalQ = 0;
  const allAnswers: Array<{ num: number; q: FullQuestion }> = [];
  const drawOpts: QuestionDrawOpts = {
    answersMode: cfg.answersMode,
    showExplanations: cfg.answersMode === "inline" ? cfg.showExplanations : false,
    styleMode: cfg.styleMode,
    twoCol: cfg.twoCol,
  };

  cfg.chapters.forEach((ch, ci) => {
    if (ci > 0) doc.newPage({ header: { label: "QUESTIONS", section: "questions" } });
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
      doc.newPage({ header: { label: "ANSWER KEY", section: "answers" } });
      doc.addBookmark("Answer Key", chapterItem);
      doc.drawAnswerKeyBanner(`CHAPTER ${ci + 1} — ANSWER KEY`);
      for (const entry of chapterAnswers) doc.drawAnswerBlock(entry.q, entry.num, cfg.showExplanations);
    }
  });

  if (cfg.answersMode === "endbook" && allAnswers.length > 0) {
    doc.newPage({ header: { label: "ANSWER KEY", section: "answers" } });
    doc.addBookmark("Answer Key");
    doc.drawAnswerKeyBanner("COMPLETE ANSWER KEY");
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
  const doc = new PdfDoc(opts.page, cfg.packTitle, opts.styleMode, opts.fontSize, opts.fontType);
  const L = doc.L;
  doc.setMeta({ title: opts.title || cfg.packTitle, author: opts.author, subject: "Quiz results" });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || cfg.packTitle,
        subtitle: opts.subtitle || `${cfg.mode === "timed" ? "Timed" : "Tutor"} Mode  ·  ${cfg.score.total} Questions`,
        eyebrow: "TEST RESULTS",
        author: opts.author,
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        features: [
          "Score analysis & percentile rank",
          opts.answersMode === "inline"
            ? "Inline answer key with explanations"
            : opts.answersMode === "endbook"
              ? "Complete answer key at the end"
              : opts.answersMode === "endchapter"
                ? "Per-chapter answer keys"
                : "Question review",
          "Performance statistics",
        ],
      },
      cfg.score.total,
      1,
    );
    doc.addBookmark("Cover");
    doc.newPage({ skipOutgoing: true, header: { label: "QUESTIONS", section: "questions" } });
  } else {
    doc.setHeader("QUESTIONS", "questions");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = opts.includeCover ? 2 : 1;
  doc.beginFlow(opts.twoCol);
  doc.addBookmark("Results");

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
    doc.drawQuestion(q, i + 1, drawOpts);
    if (opts.answersMode !== "inline" && opts.answersMode !== "none" && !q.isWritten) {
      allAnswers.push({ num: i + 1, q });
    }
  });

  if (allAnswers.length > 0 && opts.answersMode !== "inline" && opts.answersMode !== "none") {
    doc.newPage({ header: { label: "ANSWER KEY", section: "answers" } });
    doc.addBookmark("Answer Key");
    doc.drawAnswerKeyBanner("COMPLETE ANSWER KEY");
    for (const entry of allAnswers) doc.drawAnswerBlock(entry.q, entry.num, opts.showExplanations);
  }

  if (opts.showReview !== false) {
    doc.newPage({ header: { label: "REVIEW", section: "questions" } });
    doc.addBookmark("Question Review");

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
  const doc = new PdfDoc(opts.page, opts.title || "Performance Report", opts.styleMode, opts.fontSize, opts.fontType);
  const L = doc.L;
  doc.setMeta({ title: opts.title || `${cfg.username}'s Progress`, author: opts.author, subject: "Performance report" });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || `${cfg.username}'s Progress`,
        subtitle: opts.subtitle || "Comprehensive Performance Report",
        eyebrow: "PERFORMANCE REPORT",
        author: opts.author || cfg.username,
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        features: ["Overall accuracy & progress", "Pack-by-pack breakdown", "Study statistics"],
        footerNote: "Generated by Osler",
      },
      cfg.stats.attempted,
      cfg.stats.packs,
    );
    doc.addBookmark("Cover");
    doc.newPage({ skipOutgoing: true, header: { label: "PERFORMANCE", section: "report" } });
  } else {
    doc.setHeader("PERFORMANCE", "report");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = opts.includeCover ? 2 : 1;
  doc.addBookmark("Performance Summary");

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
    d.text("Pack Breakdown", L.ms, doc.y);
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
      d.text(trunc(pack.title, 44), L.ms + 27, rowY);
      if (pack.lastAttempt) {
        d.setFont(F.Hn, hs("normal"));
        d.setFontSize(6.6 * ts);
        d.setTextColor(...C.MUTED);
        d.text(new Date(pack.lastAttempt).toLocaleDateString(), L.ms + L.fw, rowY, { align: "right" });
      }

      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(6.6 * ts);
      d.setTextColor(...C.MUTED);
      d.text(`${pack.attempted} attempted  ·  ${pack.correct} correct  ·  ${acc}%`, L.ms + 27, rowY + 4.6);

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

  doc.drawChrome();
  doc.finalize(contentStartPage);
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 12  LIBRARY ARTICLE PDF  —  HTML-aware, serif body typography
// ═══════════════════════════════════════════════════════════════

export function generateArticlePdf(cfg: ArticlePdfConfig): jsPDF {
  const opts = cfg.opts;
  const doc = new PdfDoc(opts.page, cfg.title, opts.styleMode, opts.fontSize, opts.fontType);
  const L = doc.L;
  const density = L.density;
  const ts = L.typeScale;
  doc.setMeta({ title: cfg.title, author: opts.author || cfg.author, subject: "Library article" });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: cfg.title,
        subtitle: cfg.subtitle,
        eyebrow: "LIBRARY ARTICLE",
        author: opts.author || cfg.author,
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        features: ["Printed from the Osler Library"],
      },
      0,
      0,
    );
    doc.addBookmark("Cover");
    doc.newPage({ skipOutgoing: true });
  }
  const contentStartPage = opts.includeCover ? 2 : 1;

  doc.setHeader("ARTICLE", "article");
  doc.y = L.mt;
  doc.drawChrome();
  doc.addBookmark(cfg.title);

  const d = doc.doc;
  const x = L.ms;
  const fw = L.fw;

  d.setFont(F.H, hs("bold"));
  d.setFontSize(17 * ts);
  d.setTextColor(...C.INK);
  const titleLines: string[] = d.splitTextToSize(cfg.title, fw);
  d.text(titleLines, x, doc.y);
  doc.y += titleLines.length * lh(17 * ts) + sp(2, density);

  const metaParts: string[] = [];
  if (cfg.author) metaParts.push(cfg.author);
  metaParts.push(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));
  d.setFont(F.Hn, hs("normal"));
  d.setFontSize(7.6 * ts);
  d.setTextColor(...C.MUTED);
  d.text(metaParts.join("   ·   "), x, doc.y);
  doc.y += sp(2, density);

  doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
  doc.y += sp(2, density);

  // Pass 1 — extract structured elements (headings, paragraphs, lists, tables, blockquotes)
  // from the raw HTML for richer rendering that matches the print-button output.
  interface ArticleBlock {
    type: "h2" | "h3" | "h4" | "p" | "blockquote" | "code" | "list" | "table";
    text: string;
    rows?: string[][];
    items?: string[];
    isOrdered?: boolean;
  }

  const blocks: ArticleBlock[] = [];
  // Try to parse HTML structure first
  const htmlContent = cfg.content;
  let remaining = htmlContent.trim();

  // Simple HTML-aware block parser
  const tagRx = /<\/?(h[2-4]|p|blockquote|pre|ul|ol|li|table|thead|tbody|tr|th|td|br|div|strong|em|b|i|code|span|a|img|figure|figcaption)[^>]*>/gi;
  // Split by block-level tags
  const blockParts = remaining.split(/(<(?:h[2-4]|p|blockquote|pre|ul|ol|table)[^>]*>[\s\S]*?<\/(?:h[2-4]|p|blockquote|pre|ul|ol|table)>)/i);

  for (const part of blockParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // H2
    const h2m = trimmed.match(/^<h2\b[^>]*>(.+?)<\/h2>/i);
    if (h2m) {
      blocks.push({ type: "h2", text: stripHtml(h2m[1]).trim() });
      continue;
    }

    // H3
    const h3m = trimmed.match(/^<h3\b[^>]*>(.+?)<\/h3>/i);
    if (h3m) {
      blocks.push({ type: "h3", text: stripHtml(h3m[1]).trim() });
      continue;
    }

    // H4 (styled as h3 variant)
    const h4m = trimmed.match(/^<h4\b[^>]*>(.+?)<\/h4>/i);
    if (h4m) {
      blocks.push({ type: "h4", text: stripHtml(h4m[1]).trim() });
      continue;
    }

    // Blockquote
    const bqm = trimmed.match(/^<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
    if (bqm) {
      blocks.push({ type: "blockquote", text: stripHtml(bqm[1]).trim() });
      continue;
    }

    // Pre/Code block
    const cm = trimmed.match(/^<pre[^>]*>(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?<\/pre>/i);
    if (cm) {
      blocks.push({ type: "code", text: stripHtml(cm[1]).trim() });
      continue;
    }

    // Lists
    const ulm = trimmed.match(/^<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (ulm) {
      const items = ulm[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
      blocks.push({
        type: "list",
        text: "",
        items: items.map((li: string) => stripHtml(li).trim()),
        isOrdered: false,
      });
      continue;
    }
    const olm = trimmed.match(/^<ol[^>]*>([\s\S]*?)<\/ol>/i);
    if (olm) {
      const items = olm[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
      blocks.push({
        type: "list",
        text: "",
        items: items.map((li: string) => stripHtml(li).trim()),
        isOrdered: true,
      });
      continue;
    }

    // Table
    const tm = trimmed.match(/^<table[^>]*>([\s\S]*?)<\/table>/i);
    if (tm) {
      const rows: string[][] = [];
      const trs = tm[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const tr of trs) {
        const cells: string[] = [];
        const ths = tr.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
        const tds = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
        for (const cell of [...ths, ...tds]) {
          cells.push(stripHtml(cell).trim());
        }
        if (cells.length > 0) rows.push(cells);
      }
      blocks.push({ type: "table", text: "", rows });
      continue;
    }

    // Plain paragraph or div
    let cleanText = trimmed
      .replace(/^<p[^>]*>/i, "")
      .replace(/<\/p>$/i, "")
      .replace(/^<div[^>]*>/i, "")
      .replace(/<\/div>$/i, "")
      .replace(/<br\s*\/?>/gi, "\n");
    cleanText = stripHtml(cleanText).trim();
    if (cleanText) blocks.push({ type: "p", text: cleanText });
  }

  // Fallback: if HTML parser didn't produce blocks, split on double-newlines
  if (blocks.length === 0) {
    const paragraphs = stripHtml(cfg.content).split(/\n{2,}/).filter((p) => p.trim());
    for (const para of paragraphs) {
      const t = para.trim();
      if (!t) continue;
      if (/^##\s/.test(t)) {
        blocks.push({ type: "h2", text: t.replace(/^##\s+/, "") });
      } else if (/^###\s/.test(t)) {
        blocks.push({ type: "h3", text: t.replace(/^###\s+/, "") });
      } else {
        blocks.push({ type: "p", text: t });
      }
    }
  }

  // Render blocks — matches the print-button CSS hierarchy
  for (const block of blocks) {
    switch (block.type) {
      case "h2": {
        doc.checkPage(sp(6, density));
        doc.y += sp(2, density);
        d.setFont(F.H, hs("bold"));
        d.setFontSize(14 * ts);
        d.setTextColor(...C.INK);
        const hLines: string[] = d.splitTextToSize(block.text, fw);
        d.text(hLines, x, doc.y);
        doc.y += hLines.length * lh(14 * ts) + sp(0.5, density);
        doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
        doc.y += sp(1.5, density);
        break;
      }
      case "h3": {
        doc.checkPage(sp(4.5, density));
        doc.y += sp(1, density);
        d.setFont(F.H, hs("bold"));
        d.setFontSize(11.5 * ts);
        d.setTextColor(...C.COBALT);
        const hLines: string[] = d.splitTextToSize(block.text, fw);
        d.text(hLines, x, doc.y);
        doc.y += hLines.length * lh(11.5 * ts) + sp(1.2, density);
        break;
      }
      case "h4": {
        doc.checkPage(sp(3.5, density));
        doc.y += sp(0.5, density);
        d.setFont(F.Hm, hs("bold"));
        d.setFontSize(9.8 * ts);
        d.setTextColor(...C.SLATE);
        const hLines: string[] = d.splitTextToSize(block.text, fw);
        d.text(hLines, x, doc.y);
        doc.y += hLines.length * lh(9.8 * ts) + sp(0.8, density);
        break;
      }
      case "blockquote": {
        doc.checkPage(sp(5, density));
        doc.y += sp(0.5, density);
        // Draw blockquote bar
        d.setFillColor(...C.PALE_BLUE);
        d.rect(x, doc.y, 1.6, 0, "F");
        d.setDrawColor(...C.COBALT);
        d.setLineWidth(0.5);
        // Estimate height
        const bqFontSize = 8.8 * ts;
        d.setFont(F.Bi, hs("italic"));
        d.setFontSize(bqFontSize);
        const bqLines: string[] = d.splitTextToSize(block.text, fw - 6);
        const bqH = bqLines.length * lh(bqFontSize) + sp(2, density);
        d.setFillColor(...C.PALE_BLUE);
        d.setDrawColor(...C.COBALT);
        d.setLineWidth(0.5);
        d.rect(x, doc.y, fw, bqH, "FD");
        d.setFillColor(255, 255, 255);
        d.rect(x, doc.y, 1.6, bqH, "F");
        d.setDrawColor(...C.COBALT);
        d.line(x, doc.y, x, doc.y + bqH);
        d.setTextColor(...C.SLATE);
        d.text(bqLines, x + 4, doc.y + sp(1, density));
        doc.y += bqH + sp(2, density);
        break;
      }
      case "code": {
        doc.checkPage(sp(5, density));
        doc.y += sp(0.5, density);
        d.setFont(F.Hn, hs("normal"));
        d.setFontSize(7.8 * ts);
        d.setTextColor(...C.SLATE);
        const codeLines: string[] = d.splitTextToSize(block.text, fw - 8);
        const codeH = codeLines.length * lh(7.8 * ts, 1.3) + sp(2, density);
        d.setFillColor(...C.RULE_SOFT);
        d.setDrawColor(...C.RULE);
        d.setLineWidth(0.3);
        d.roundedRect(x, doc.y, fw, codeH, 1, 1, "FD");
        d.setTextColor(...C.CHARCOAL);
        d.text(codeLines, x + 4, doc.y + sp(1, density));
        doc.y += codeH + sp(2, density);
        break;
      }
      case "list": {
        doc.checkPage(sp(3, density));
        doc.y += sp(0.5, density);
        d.setFont(F.B, hs("normal"));
        d.setFontSize(9 * ts);
        d.setTextColor(...C.CHARCOAL);
        const items = block.items ?? [];
        for (let i = 0; i < items.length; i++) {
          const prefix = block.isOrdered ? `${i + 1}. ` : "  \u2022  ";
          const itemText = `${prefix}${items[i]}`;
          const lines: string[] = d.splitTextToSize(itemText, fw - 4);
          doc.checkPage(lines.length * lh(9 * ts));
          d.text(lines, x + 2, doc.y);
          doc.y += lines.length * lh(9 * ts) + sp(0.3, density);
        }
        doc.y += sp(1, density);
        break;
      }
      case "table": {
        doc.checkPage(sp(8, density));
        doc.y += sp(1, density);
        const rows = block.rows ?? [];
        if (rows.length > 0) {
          const colCount = Math.max(...rows.map((r) => r.length));
          const colW = fw / colCount;
          d.setFont(F.Hn, hs("normal"));
          d.setFontSize(7.6 * ts);
          for (let ri = 0; ri < rows.length; ri++) {
            const row = rows[ri];
            const isHeader = ri === 0;
            const cellH = 5.5 * ts;
            doc.checkPage(cellH + 2);
            for (let ci = 0; ci < colCount; ci++) {
              const cellX = x + ci * colW;
              const cellText = row[ci] ?? "";
              d.setFillColor(...(isHeader ? C.PALE_BLUE : C.WHITE));
              d.setDrawColor(...C.RULE);
              d.setLineWidth(0.2);
              d.rect(cellX, doc.y, colW, cellH, "FD");
              d.setFont(F.Hm, hs(isHeader ? "bold" : "normal"));
              d.setFontSize(isHeader ? 7.6 * ts : 7.2 * ts);
              d.setTextColor(...(isHeader ? C.COBALT : C.CHARCOAL));
              const cellDisplay = trunc(cellText, Math.floor(colW / (7.2 * ts * 0.35)));
              d.text(cellDisplay, cellX + 1.5, doc.y + 4);
            }
            doc.y += cellH;
          }
          doc.y += sp(1.5, density);
        }
        break;
      }
      case "p":
      default: {
        doc.checkPage(sp(3, density));
        doc.y = doc.text(block.text, x, doc.y, { font: "B", size: 9.4, color: C.CHARCOAL, maxW: fw });
        doc.y += sp(0.75, density);
        break;
      }
    }
  }

  doc.drawChrome();
  doc.finalize(contentStartPage);
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 13  DOWNLOAD HELPER
// ═══════════════════════════════════════════════════════════════

export function downloadPdf(doc: jsPDF, filename: string): void {
  const safeName = filename.replace(/[^a-zA-Z0-9\s\-_.]/g, "").trim() || "export";
  doc.save(`${safeName}.pdf`);
}
