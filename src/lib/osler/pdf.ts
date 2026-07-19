/**
 * Osler PDF Generator — matched to QuizTool premium ReportLab design.
 *
 * Design principles (mirrored from QuizTool pdf_generator.py §1–§16):
 *   · No side-stripe borders — full hairline outline or bg tint only
 *   · ALL-CAPS labels with charSpace tracking
 *   · Type hierarchy ≥1.25× ratio per step
 *   · 4pt spacing grid: 4 | 8 | 12 | 16 | 24 | 36 | 48
 *   · Color 60/30/10: navy dominates, cobalt/emerald carry structure, gold is accent
 *   · Frame-based two-column layout
 *   · Hyperlinked TOC with PDF page anchors
 *   · KeepTogether orphan prevention for question blocks
 *
 * Typography: Poppins (headings/labels) + Times (body) + Courier (mono)
 * When Poppins unavailable, falls back to Helvetica.
 * When Arabic detected, uses Cairo (loaded separately).
 */

import { jsPDF } from "jspdf";
import { convertArabic } from "arabic-reshaper";
import { registerPdfFonts } from "@/lib/osler/pdf-fonts";

// ═══════════════════════════════════════════════════════════════
// § 1  COLOR PALETTE  —  60 / 30 / 10 strategy
//     Exact values from QuizTool pdf_generator.py §2
// ═══════════════════════════════════════════════════════════════

export const C = {
  NAVY:       [11, 30, 51]    as RGB,
  COBALT:     [26, 58, 92]    as RGB,
  ROYAL:      [30, 95, 168]   as RGB,
  PALE_BLUE:  [235, 243, 250] as RGB,

  GOLD:       [201, 146, 10]  as RGB,
  GOLD_MID:   [232, 169, 18]  as RGB,

  EMERALD:    [10, 92, 54]    as RGB,
  SAGE:       [24, 133, 90]   as RGB,
  PALE_GREEN: [230, 245, 237] as RGB,
  MINT_RULE:  [168, 216, 188] as RGB,

  CHARCOAL:   [26, 26, 46]    as RGB,
  SLATE:      [58, 69, 84]    as RGB,
  MUTED:      [107, 122, 141] as RGB,
  RULE_GRAY:  [208, 216, 228] as RGB,
  PALE_GRAY:  [244, 246, 249] as RGB,

  LINK:       [21, 101, 192]  as RGB,
  WHITE:      [255, 255, 255] as RGB,

  COVER_DARK:   [13, 39, 68]  as RGB,
  COVER_MID:    [15, 48, 96]  as RGB,
  COVER_LIGHT:  [19, 45, 80]  as RGB,
  COVER_PILLAR: [20, 48, 78]  as RGB,
  COVER_GRID:   [24, 48, 74]  as RGB,
  COVER_WELL:   [28, 61, 96]  as RGB,
  COVER_FOOTER: [6, 14, 24]   as RGB,
  COVER_CIRC: [[14, 46, 80], [22, 58, 100], [30, 72, 120]] as [RGB, RGB, RGB],

  HEADER_FG: {
    questions: [168, 196, 220] as RGB,
    answers:   [168, 216, 190] as RGB,
    contents:  [140, 174, 206] as RGB,
  },
};

type RGB = [number, number, number];

// ═══════════════════════════════════════════════════════════════
// § 2  SPACING GRID  —  4pt base  +  line-height helper
// ═══════════════════════════════════════════════════════════════

function sp(n: number, scale = 1.0): number {
  return Math.round(n * 4 * scale * 10) / 10;
}

function lh(sizePt: number, factor = 1.47): number {
  return sizePt * factor * 0.3528;
}

// ═══════════════════════════════════════════════════════════════
// § 3  HELPERS
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
    .replace(/\u2713/g, "[X]")
    .replace(/\u2717/g, "[ ]")
    .replace(/\u25BA/g, ">")
    .replace(/\u25B6/g, ">")
    .replace(/\u2002|\u2003|\u00A0/g, " ")
    .trim();
}

/** Strip HTML tags, preserving paragraph/heading breaks. */
function stripHtml(text: string): string {
  if (!text) return "";
  let s = text
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

/** Detect HTML heading tags in a line. */
function detectHtmlHeading(line: string): { level: number; text: string } | null {
  const m = line.match(/^<h([2-3])\b[^>]*>(.+?)<\/h[2-3]>/i);
  if (m) return { level: parseInt(m[1]), text: m[2].replace(/<[^>]+>/g, "") };
  return null;
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "\u2026";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ═══════════════════════════════════════════════════════════════
// § 4  FONT RESOLUTION
// ═══════════════════════════════════════════════════════════════

const F = {
  H:   "helvetica",  // heading bold
  Hn:  "helvetica",  // heading normal
  Hl:  "helvetica",  // heading light
  Hli: "helvetica",  // heading light italic
  Hm:  "helvetica",  // heading medium
  B:   "times",      // body normal
  Bb:  "times",      // body bold
  Bi:  "times",      // body italic
  Bbi: "times",      // body bold italic
  M:   "courier",    // mono normal
  Mb:  "courier",    // mono bold
};

function resolveFonts(doc: jsPDF): void {
  const fl = doc.getFontList();
  if (fl.Poppins) {
    F.H   = "Poppins";
    F.Hn  = "Poppins";
    F.Hl  = fl["Poppins-Light"] ? "Poppins-Light" : "Poppins";
    F.Hli = fl["Poppins-Light"] ? "Poppins-Light" : "Poppins";
    F.Hm  = fl["Poppins-Medium"] ? "Poppins-Medium" : "Poppins";
  }
}

function hs(style: string): string {
  if (style === "bold") return "bold";
  if (style === "italic") return "italic";
  if (style === "bolditalic") return "bolditalic";
  return "normal";
}

// ═══════════════════════════════════════════════════════════════
// § 5  PAGE LAYOUT
// ═══════════════════════════════════════════════════════════════

export interface PdfPageConfig {
  pageSize: "a4" | "a3" | "a5" | "letter";
  orientation: "portrait" | "landscape";
}

const PAGE_DIMS: Record<string, [number, number]> = {
  a4: [210, 297], a3: [297, 420], a5: [148, 210], letter: [216, 279],
};

interface Layout {
  pw: number; ph: number;
  ms: number; mt: number; mb: number; gu: number; bh: number;
  fw: number; cw: number;
  fs: number; scale: number;
}

function computeLayout(cfg: PdfPageConfig, compact = false): Layout {
  let [pw, ph] = PAGE_DIMS[cfg.pageSize] ?? PAGE_DIMS.a4;
  if (cfg.orientation === "landscape") [pw, ph] = [ph, pw];
  const scale = pw / 210;
  const pt2mm = (pt: number) => Math.max(4, +(pt * scale * 0.3528).toFixed(1));
  const ms = pt2mm(28);
  const mt = pt2mm(52);
  const mb = pt2mm(36);
  const gu = pt2mm(16);
  const bh = pt2mm(28);
  let fs = clamp(scale, 0.80, 1.22);
  if (compact) fs *= 0.88;
  return {
    pw, ph, ms, mt, mb, gu, bh,
    fw: pw - 2 * ms,
    cw: (pw - 2 * ms - gu) / 2,
    fs, scale,
  };
}

// ═══════════════════════════════════════════════════════════════
// § 6  PDF DOCUMENT CLASS
// ═══════════════════════════════════════════════════════════════

class PdfDoc {
  doc: jsPDF;
  L: Layout;
  y = 0;
  page = 1;
  title: string;
  headerLabel = "";
  headerBg: RGB = C.COBALT;
  headerFg: RGB = C.HEADER_FG.questions;
  colX = 0;
  /** Track which page each chapter starts on (for TOC hyperlinks). */
  chapterPages: number[] = [];

  constructor(cfg: PdfPageConfig, title: string, compact = false) {
    this.L = computeLayout(cfg, compact);
    this.title = title;
    this.doc = new jsPDF({
      orientation: cfg.orientation,
      unit: "mm",
      format: cfg.pageSize,
    });
    this.doc.setLineHeightFactor(1.15);
    this.y = this.L.mt;
    registerPdfFonts(this.doc);
    resolveFonts(this.doc);
  }

  // ── Page chrome ──

  setHeader(label: string, bg: RGB, fg: RGB) {
    this.headerLabel = label;
    this.headerBg = bg;
    this.headerFg = fg;
  }

  drawChrome() {
    const d = this.doc;
    const { pw, ph, ms, bh } = this.L;

    d.setFillColor(...this.headerBg);
    d.rect(0, 0, pw, bh, "F");

    d.setFillColor(...C.GOLD);
    d.rect(0, 0, pw, 3.5, "F");

    d.setFont(F.H, hs("bold"));
    d.setFontSize(7);
    d.setTextColor(...C.WHITE);
    d.text(trunc(this.title, 55).replace(/[\u2013\u2014]/g, "-"), ms, bh * 0.6);

    if (this.headerLabel) {
      const spaced = this.headerLabel.split("").join(" ");
      d.setFont(F.Hl, hs("normal"));
      d.setFontSize(7);
      d.setTextColor(...this.headerFg);
      const w = d.getTextWidth(spaced);
      d.text(spaced, pw - ms - w, bh * 0.6);
    }

    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7);
    d.setTextColor(...C.MUTED);
    d.text(`— ${this.page} —`, pw / 2, ph - 14, { align: "center" });

    d.setDrawColor(...C.RULE_GRAY);
    d.setLineWidth(0.35);
    d.line(ms, ph - 24, pw - ms, ph - 24);
  }

  newPage(skipPre = false): void {
    if (!skipPre) this.drawChrome();
    this.doc.addPage();
    this.page++;
    this.colX = this.L.ms;
    this.y = this.L.mt;
    this.drawChrome();
  }

  checkPage(needed: number): void {
    if (this.y + needed > this.L.ph - this.L.mb) this.newPage();
  }

  /** Keep a block together: if estimated height doesn't fit, start new page. */
  keepTogether(estimatedH: number): void {
    const available = this.L.ph - this.L.mb - this.y;
    if (estimatedH > available) this.newPage();
  }

  // ── Drawing primitives ──

  text(
    str: string,
    x: number,
    y: number,
    opts: {
      font?: "helvetica" | "times" | "courier" | "Cairo" | "Poppins";
      style?: "normal" | "bold" | "italic" | "bolditalic";
      size?: number;
      color?: RGB;
      align?: "left" | "center" | "right";
      maxW?: number;
    } = {}
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
      font = opts.font ?? F.B;
      style = opts.style ?? "normal";
    }

    const size = opts.size ?? 9.5;
    d.setFont(font, hs(style));
    d.setFontSize(size);
    d.setTextColor(...(opts.color ?? C.CHARCOAL));

    const maxW = opts.maxW ?? this.L.fw;
    const text = isArabic ? convertArabic(normalizeText(raw)) : normalizeText(raw);
    const lines: string[] = d.splitTextToSize(text, maxW);
    d.text(lines, x, y, { align: opts.align ?? "left" });
    return y + lines.length * lh(size);
  }

  hRule(y: number, w: number, thick = 0.35, color: RGB = C.RULE_GRAY): number {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(thick);
    this.doc.line(this.L.ms, y, this.L.ms + w, y);
    return y + 4;
  }

  doubleRule(y: number, w: number): number {
    const d = this.doc;
    d.setDrawColor(...C.GOLD);
    d.setLineWidth(2.0);
    d.line(this.L.ms, y + 4, this.L.ms + w, y + 4);
    d.setLineWidth(0.7);
    d.line(this.L.ms, y + 1, this.L.ms + w, y + 1);
    return y + 8;
  }

  trackedLabel(
    text: string, y: number,
    size = 10.5, color: RGB = C.COBALT,
    fontName?: string,
  ): number {
    const d = this.doc;
    const tracked = text.split("").join(" ");
    d.setFont(fontName ?? F.H, hs("bold"));
    d.setFontSize(size);
    d.setTextColor(...color);
    d.text(tracked, this.L.ms, y);
    return y + lh(size) * 1.2;
  }

  calloutBox(
    label: string, body: string, y: number, w: number,
    bg: RGB, border: RGB, fs = 1.0,
  ): number {
    const d = this.doc;
    const pad = sp(3, fs);
    const x = this.L.ms;

    d.setFont(F.Bi, hs("italic"));
    d.setFontSize(8.5 * fs);
    const bodyLines: string[] = d.splitTextToSize(stripMd(body), w - pad * 2);
    const bodyH = bodyLines.length * lh(8.5 * fs);
    const totalH = sp(1.5, fs) + bodyH + sp(2, fs);

    this.checkPage(totalH + 6);
    const boxY = y;

    d.setFillColor(...bg);
    d.setDrawColor(...border);
    d.setLineWidth(0.55);
    d.roundedRect(x, boxY, w, totalH, 1, 1, "FD");

    d.setFont(F.H, hs("bold"));
    d.setFontSize(7 * fs);
    d.setTextColor(...border);
    d.text(label, x + pad / 2, boxY + sp(1, fs));

    d.setFont(F.Bi, hs("italic"));
    d.setFontSize(8.5 * fs);
    d.setTextColor(...C.SLATE);
    d.text(bodyLines, x + pad / 2, boxY + sp(1, fs) + sp(1.5, fs));

    return boxY + totalH + 3;
  }

  correctBadge(letter: string, optText: string, y: number, w: number, fs = 1.0): number {
    const d = this.doc;
    const pad = sp(3, fs);
    const x = this.L.ms;
    const badgeH = sp(2, fs) + sp(1.5, fs);

    this.checkPage(badgeH + 4);
    d.setFillColor(...C.EMERALD);
    d.roundedRect(x, y, w, badgeH, 1, 1, "F");

    d.setFont(F.H, hs("bold"));
    d.setFontSize(9 * fs);
    d.setTextColor(...C.WHITE);
    d.text(`${"\u2713"}  Correct Answer: ${letter}. ${trunc(stripMd(optText), 80)}`, x + pad / 2, y + badgeH / 2 + 1.5);

    return y + badgeH + 3;
  }

  // ── Cover page ──

  drawCover(cfg: CoverConfig, totalQ: number, chCount: number, fs = 1.0): void {
    const d = this.doc;
    const { pw, ph } = this.L;

    // Full NAVY background
    d.setFillColor(...C.NAVY);
    d.rect(0, 0, pw, ph, "F");

    // Upper cobalt block (top 26%)
    d.setFillColor(...C.COVER_DARK);
    d.rect(0, ph * 0.74, pw, ph * 0.26, "F");

    // Diagonal band 1
    d.setFillColor(...C.COVER_MID);
    d.triangle(0, ph * 0.87, pw * 0.62, ph * 0.87, pw * 0.46, ph);

    // Diagonal band 2
    d.setFillColor(...C.COVER_LIGHT);
    d.triangle(pw * 0.70, ph, pw, ph, pw * 0.85, ph * 0.74);

    // GOLD bottom edge accent
    d.setFillColor(...C.GOLD);
    d.rect(0, ph - 5, pw, 5, "F");

    // Gold separator below cobalt block
    d.setDrawColor(...C.GOLD);
    d.setLineWidth(0.8);
    d.line(pw * 0.06, ph * 0.74 - 2, pw * 0.94, ph * 0.74 - 2);

    // Right pillar
    d.setFillColor(...C.COVER_PILLAR);
    d.rect(pw * 0.965, 0, pw * 0.035, ph, "F");
    d.setFillColor(...C.GOLD);
    // Gold chip at golden-ratio height
    d.rect(pw * 0.965, ph * 0.382, pw * 0.009, ph * 0.236, "F");

    // Footer band (bottom 9%)
    d.setFillColor(...C.COVER_FOOTER);
    d.rect(0, 0, pw, ph * 0.09, "F");
    d.setFillColor(...C.GOLD);
    d.rect(0, ph * 0.09, pw, 2, "F");

    // Footer grid
    d.setDrawColor(...C.COVER_GRID);
    d.setLineWidth(0.35);
    const step = Math.max(20, Math.round(pw / 28));
    for (let x = 0; x < pw * 0.96; x += step) d.line(x, 0, x, ph * 0.089);
    d.line(0, ph * 0.035, pw * 0.96, ph * 0.035);
    d.line(0, ph * 0.065, pw * 0.96, ph * 0.065);

    // Content well
    d.setDrawColor(...C.COVER_WELL);
    d.setLineWidth(0.6);
    d.roundedRect(pw * 0.05, ph * 0.10, pw * 0.87, ph * 0.58, 3, 3, "S");

    // Decorative circles
    C.COVER_CIRC.forEach((shade, i) => {
      d.setFillColor(...shade);
      d.circle(pw * 0.10 + i * (13 * pw / 595), ph * 0.70, (5 - i * 0.5) * (pw / 595), "F");
    });

    // ── Text content ──
    let cy = ph * 0.28;

    // Eyebrow
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(8 * fs);
    d.setTextColor(106, 144, 184);
    d.text(cfg.eyebrow ?? "O S L E R   R E P O R T", pw / 2, cy, { align: "center" });
    cy += sp(8, fs);

    // Hero title — Poppins-Bold 44pt (extreme scale)
    const titleSize = 44 * fs;
    d.setFont(F.H, hs("bold"));
    d.setFontSize(titleSize);
    d.setTextColor(...C.WHITE);
    const titleLines: string[] = d.splitTextToSize(cfg.title ?? "Report", pw * 0.75);
    d.text(titleLines, pw / 2, cy, { align: "center" });
    cy += titleLines.length * lh(titleSize, 1.1) + sp(3, fs);

    // Subtitle — Lora-Italic (or Times-Italic fallback)
    if (cfg.subtitle) {
      const subSize = 17 * fs;
      d.setFont(F.Bi, hs("italic"));
      d.setFontSize(subSize);
      d.setTextColor(192, 216, 240);
      const subLines: string[] = d.splitTextToSize(cfg.subtitle, pw * 0.65);
      d.text(subLines, pw / 2, cy, { align: "center" });
      cy += subLines.length * lh(subSize) + sp(2, fs);
    }

    // Double-rule
    cy += sp(1, fs);
    d.setDrawColor(...C.GOLD);
    d.setLineWidth(2.4);
    d.line(pw * 0.25, cy, pw * 0.75, cy);
    d.setLineWidth(0.7);
    d.line(pw * 0.25, cy + 3, pw * 0.75, cy + 3);
    cy += sp(5, fs);

    // Metadata
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(10 * fs);
    d.setTextColor(140, 174, 206);
    if (cfg.author) { d.text(cfg.author, pw / 2, cy, { align: "center" }); cy += sp(3, fs); }
    if (cfg.date) { d.text(cfg.date, pw / 2, cy, { align: "center" }); cy += sp(3, fs); }
    if (cfg.description) {
      d.setFontSize(9 * fs);
      const descLines: string[] = d.splitTextToSize(cfg.description, pw * 0.6);
      d.text(descLines, pw / 2, cy, { align: "center" });
      cy += descLines.length * lh(9 * fs) + sp(2, fs);
    }

    // Stats
    const qWord = totalQ === 1 ? "question" : "questions";
    const chWord = chCount === 1 ? "chapter" : "chapters";
    d.setFontSize(10 * fs);
    d.text(`${chCount} ${chWord}  —  ${totalQ} ${qWord}`, pw / 2, cy, { align: "center" });
    cy += sp(6, fs);

    // Feature lines
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(9 * fs);
    d.setTextColor(200, 223, 240);
    const features = cfg.features ?? ["Generated by Osler"];
    for (const f of features) {
      d.text(f, pw / 2, cy, { align: "center" });
      cy += sp(3, fs);
    }

    // Footer note
    d.setFont(F.Hl, hs("normal"));
    d.setFontSize(7.5 * fs);
    d.setTextColor(69, 96, 128);
    d.text(
      cfg.footerNote ?? "Tap any TOC entry or question number to navigate.",
      pw / 2, ph * 0.12, { align: "center" },
    );
  }

  // ── TOC (with page-number hyperlinks) ──

  drawTocEntry(
    chNum: number, title: string, qCount: number, desc: string,
    targetPage: number, fs = 1.0,
  ): void {
    const d = this.doc;
    this.checkPage(20);

    // CH number
    const chLabelY = this.y;
    d.setFont(F.H, hs("bold"));
    d.setFontSize(8 * fs);
    d.setTextColor(...C.GOLD);
    d.text(`CH ${String(chNum).padStart(2, "0")}`, this.L.ms, this.y);
    this.y += sp(2.5, fs);

    // Title + count
    const titleY = this.y;
    const entryTop = chLabelY;
    d.setFont(F.Hm, hs("normal"));
    d.setFontSize(11 * fs);
    d.setTextColor(...C.CHARCOAL);
    const titleW = d.getTextWidth(title);
    d.text(title, this.L.ms + 2, this.y);
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(8 * fs);
    d.setTextColor(...C.MUTED);
    d.text(`${qCount} Q`, this.L.ms + this.L.fw, this.y, { align: "right" });

    // Create hyperlink to target page
    const linkH = desc ? 14 : 10;
    d.link(this.L.ms, chLabelY - 6, this.L.fw, linkH, { pageNumber: targetPage });

    this.y += sp(3, fs);

    // Desc
    if (desc) {
      d.setFont(F.Bi, hs("italic"));
      d.setFontSize(8.5 * fs);
      d.setTextColor(...C.MUTED);
      const lines: string[] = d.splitTextToSize(stripMd(desc), this.L.fw - 10);
      d.text(lines, this.L.ms + 6, this.y);
      this.y += lines.length * lh(8.5 * fs) + sp(1, fs);
    }

    this.y = this.hRule(this.y, this.L.fw, 0.3);
    this.y += sp(1, fs);
  }

  // ── Chapter header ──

  drawChapterHeader(chNum: number, title: string, desc: string, isSingle: boolean, fs = 1.0): void {
    const d = this.doc;
    const fw = this.L.fw;

    // Record which page this chapter starts on (for TOC hyperlinks)
    this.chapterPages[chNum] = this.page;

    if (isSingle) {
      this.checkPage(30);
      if (title) {
        d.setFont(F.H, hs("bold"));
        d.setFontSize(22 * fs);
        d.setTextColor(...C.CHARCOAL);
        const lines: string[] = d.splitTextToSize(title, fw);
        d.text(lines, this.L.ms + fw / 2, this.y, { align: "center" });
        this.y += lines.length * lh(22 * fs, 1.25) + sp(2, fs);
      }
      if (desc) {
        d.setFont(F.Bi, hs("italic"));
        d.setFontSize(10 * fs);
        d.setTextColor(...C.MUTED);
        const lines: string[] = d.splitTextToSize(stripMd(desc), fw - 10);
        d.text(lines, this.L.ms + fw / 2, this.y, { align: "center" });
        this.y += lines.length * lh(10 * fs) + sp(3, fs);
      }
    } else {
      this.checkPage(36);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(8 * fs);
      d.setTextColor(...C.GOLD);
      d.text(`CHAPTER  ${String(chNum).padStart(2, "0")}`, this.L.ms, this.y);
      this.y += sp(3, fs);

      d.setFont(F.H, hs("bold"));
      d.setFontSize(18 * fs);
      d.setTextColor(...C.CHARCOAL);
      d.text(title, this.L.ms, this.y);
      this.y += sp(4, fs);

      if (desc) {
        d.setFont(F.Bi, hs("italic"));
        d.setFontSize(9 * fs);
        d.setTextColor(...C.MUTED);
        const lines: string[] = d.splitTextToSize(stripMd(desc), fw - 10);
        d.text(lines, this.L.ms, this.y);
        this.y += lines.length * lh(9 * fs) + sp(3, fs);
      }

      this.y = this.hRule(this.y, fw, 1.5, C.GOLD);
      this.y += sp(3, fs);
    }
  }

  // ── Question rendering ──

  /** Estimate question height so KeepTogether can prevent orphans. */
  estimateQuestionH(q: FullQuestion, opts: QuestionDrawOpts, fs = 1.0): number {
    let h = 50; // base: header + stem
    if (!q.isWritten && q.choices.length > 0) {
      h += q.choices.length * 14 * fs; // options
    }
    if (opts.answersMode === "inline" && !q.isWritten && opts.showExplanations) {
      h += 24 * fs; // badge
      if (q.explanation) h += 28 * fs; // callout
    }
    if (q.isWritten && q.modelAnswer && opts.showExplanations) {
      h += 28 * fs;
    }
    return h;
  }

  drawQuestion(q: FullQuestion, qNum: number, opts: QuestionDrawOpts, fs = 1.0): void {
    const d = this.doc;
    const cw = opts.twoCol ? this.L.cw : this.L.fw;
    const x = this.colX;
    const answersMode = opts.answersMode ?? "inline";
    const showExpl = opts.showExplanations ?? true;
    const style = opts.styleMode ?? "standard";
    const isWritten = q.isWritten ?? false;

    // KeepTogether: prevent orphaned headers
    this.keepTogether(this.estimateQuestionH(q, opts, fs) + 10);

    // Header — standard/styled/detailed
    if (style === "styled") {
      d.setFont(F.H, hs("bold"));
      d.setFontSize(8 * fs);
      d.setTextColor(...C.GOLD);
      d.text("Q U E S T I O N  " + qNum, x, this.y);
      this.y += sp(2, fs);
      this.y = this.hRule(this.y, cw, 0.8, C.GOLD);
      this.y += sp(2, fs);
    } else if (style === "detailed") {
      d.setFont(F.H, hs("bold"));
      d.setFontSize(8 * fs);
      d.setTextColor(...C.COBALT);
      d.text("QUESTION " + qNum, x, this.y);
      const metaParts: string[] = [];
      if (q.difficulty) metaParts.push(q.difficulty.toUpperCase());
      if (q.tags?.length) metaParts.push(q.tags.slice(0, 3).join(" | "));
      if (metaParts.length) {
        d.setFont(F.Hn, hs("normal"));
        d.setFontSize(7 * fs);
        d.setTextColor(...C.MUTED);
        d.text(metaParts.join("  |  "), x + cw, this.y, { align: "right" });
      }
      this.y += sp(2, fs);
      this.y = this.hRule(this.y, cw, 0.5, C.COBALT);
      this.y += sp(2, fs);
    } else {
      this.y = this.trackedLabel(`QUESTION ${qNum}`, this.y, 10.5 * fs, C.COBALT, undefined);
      this.y += sp(1, fs);
      this.y = this.hRule(this.y, cw, 1.5, C.ROYAL);
      this.y += sp(2, fs);
    }

    // Stem — Poppins-/Lora-body justified
    if (q.stem) {
      this.y = this.text(q.stem, x, this.y, {
        font: "times", size: 9.5 * fs, color: C.CHARCOAL, maxW: cw - 4,
      });
      this.y += sp(2, fs);
    }

    // Options
    if (!isWritten && q.choices.length > 0) {
      const showInline = answersMode === "inline";
      for (let i = 0; i < q.choices.length; i++) {
        const letter = LETTERS[i] ?? String(i + 1);
        const isCorrect = i === q.correct;

        if (style === "styled") {
          const col = isCorrect && showInline ? C.EMERALD : C.ROYAL;
          d.setFont(F.H, hs("bold"));
          d.setFontSize(9 * fs);
          d.setTextColor(...col);
          d.text(`${letter})`, x + 4, this.y);
          d.setFont(F.B, hs("normal"));
          d.setFontSize(9 * fs);
          d.setTextColor(...C.SLATE);
          const optLines: string[] = d.splitTextToSize(stripMd(q.choices[i]), cw - 14);
          d.text(optLines, x + 12, this.y);
          this.y += optLines.length * lh(9 * fs) + sp(0.5, fs);
        } else if (showInline && isCorrect) {
          d.setFont(F.H, hs("bold"));
          d.setFontSize(9 * fs);
          d.setTextColor(...C.EMERALD);
          d.text(`✓ ${letter})`, x + 4, this.y);
          d.setFont(F.Bb, hs("bold"));
          d.setFontSize(9 * fs);
          d.setTextColor(...C.EMERALD);
          const optLines: string[] = d.splitTextToSize(stripMd(q.choices[i]), cw - 16);
          d.text(optLines, x + 14, this.y);
          this.y += optLines.length * lh(9 * fs) + sp(0.5, fs);
        } else {
          d.setFont(F.H, hs("bold"));
          d.setFontSize(9 * fs);
          d.setTextColor(...C.ROYAL);
          d.text(`${letter})`, x + 4, this.y);
          d.setFont(F.B, hs("normal"));
          d.setFontSize(9 * fs);
          d.setTextColor(...C.SLATE);
          const optLines: string[] = d.splitTextToSize(stripMd(q.choices[i]), cw - 14);
          d.text(optLines, x + 12, this.y);
          this.y += optLines.length * lh(9 * fs) + sp(0.5, fs);
        }
      }
    }

    // Inline answer + explanation
    if (answersMode === "inline" && !isWritten) {
      if (showExpl && q.correct >= 0 && q.correct < q.choices.length) {
        this.y += sp(1, fs);
        this.y = this.correctBadge(LETTERS[q.correct], q.choices[q.correct], this.y, cw, fs);
      }
      if (showExpl && q.explanation) {
        this.y += sp(1, fs);
        this.y = this.calloutBox("EXPLANATION", q.explanation, this.y, cw, C.PALE_GREEN, C.SAGE, fs);
      }
    }

    // Model answer for written
    if (isWritten && q.modelAnswer && showExpl) {
      this.y += sp(1, fs);
      this.y = this.calloutBox("MODEL ANSWER", q.modelAnswer, this.y, cw, C.PALE_BLUE, C.ROYAL, fs);
    }

    // Rubric criteria for written (detailed mode)
    if (isWritten && style === "detailed" && q.rubric?.length && showExpl) {
      this.y += sp(1, fs);
      this.y = this.calloutBox(
        "RUBRIC CRITERIA",
        q.rubric.map((r, ri) => `${ri + 1}. ${r}`).join("\n"),
        this.y, cw, [245, 243, 255], [120, 100, 180], fs,
      );
    }

    // "See Answer" link for endchapter/endbook
    if ((answersMode === "endchapter" || answersMode === "endbook") && !isWritten) {
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(7.5 * fs);
      d.setTextColor(...C.LINK);
      d.text(`See Answer >`, x + cw, this.y, { align: "right" });
      this.y += sp(2, fs);
    }

    // Separator
    const sepCol = style === "styled" ? C.GOLD : C.RULE_GRAY;
    const sepThick = style === "styled" ? 0.5 : 0.35;
    this.y = this.hRule(this.y, cw, sepThick, sepCol);
    this.y += sp(2, fs);
  }

  /** MCQ Notes ultra-compact mode: Q + answer + explanation. */
  drawMcqnotesQuestion(q: FullQuestion, qNum: number, opts: QuestionDrawOpts, fs = 1.0): void {
    const d = this.doc;
    const cw = opts.twoCol ? this.L.cw : this.L.fw;
    const x = this.colX;
    const showExpl = opts.showExplanations ?? true;

    this.keepTogether(30);

    // Question — compact bold
    if (q.stem) {
      d.setFont(F.Bb, hs("bold"));
      d.setFontSize(8.5 * fs);
      d.setTextColor(...C.CHARCOAL);
      const lines: string[] = d.splitTextToSize(stripMd(q.stem), cw - 4);
      d.text(lines, x, this.y);
      this.y += lines.length * lh(8.5 * fs, 1.4) + sp(1, fs);
    }

    // Answer
    if (q.correct >= 0 && q.correct < q.choices.length) {
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(8 * fs);
      d.setTextColor(...C.EMERALD);
      d.text(`✓ ${LETTERS[q.correct]}. ${stripMd(q.choices[q.correct])}`, x + sp(3, fs), this.y);
      this.y += sp(2, fs);
    }

    // Explanation — compact italic
    if (q.explanation && showExpl) {
      d.setFont(F.Bi, hs("italic"));
      d.setFontSize(7.5 * fs);
      d.setTextColor(...C.MUTED);
      const lines: string[] = d.splitTextToSize(stripMd(q.explanation), cw - sp(5, fs));
      d.text(lines, x + sp(5, fs), this.y);
      this.y += lines.length * lh(7.5 * fs, 1.4) + sp(1, fs);
    }

    // Light separator
    this.y = this.hRule(this.y, cw, 0.25, C.RULE_GRAY);
    this.y += sp(1, fs);
  }

  /** Written question with model answer, rubric. */
  drawWrittenQuestion(q: FullQuestion, qNum: number, opts: QuestionDrawOpts, fs = 1.0): void {
    // Delegate to drawQuestion which already handles isWritten
    const writtenQ = { ...q, isWritten: true };
    this.drawQuestion(writtenQ, qNum, opts, fs);
  }

  // ── Answer key ──

  drawAnswerKeyBanner(title: string, fs = 1.0): void {
    const d = this.doc;
    const fw = this.L.fw;
    const bannerH = Math.max(30, 42 * this.L.scale);

    this.checkPage(bannerH + sp(4, fs));

    d.setFillColor(...C.EMERALD);
    d.roundedRect(this.L.ms, this.y, fw, bannerH - 4, 1, 1, "F");

    d.setFillColor(...C.GOLD);
    d.rect(this.L.ms, this.y - 1, fw, 4, "F");

    d.setDrawColor(...C.GOLD);
    d.setLineWidth(0.8);
    d.line(this.L.ms, this.y - 1, this.L.ms + fw, this.y - 1);

    const spaced = title.split("").join(" ");
    d.setFont(F.H, hs("bold"));
    d.setFontSize(11);
    d.setTextColor(...C.WHITE);
    d.text(spaced, this.L.ms + 12, this.y + bannerH / 2 - 2);

    this.y += bannerH + sp(2, fs);
  }

  drawAnswerBlock(q: FullQuestion, qNum: number, showExpl: boolean, fs = 1.0): void {
    const d = this.doc;
    const fw = this.L.fw;
    const x = this.L.ms;

    this.checkPage(40);

    this.y = this.trackedLabel(`ANSWER ${qNum}`, this.y, 10.5 * fs, C.EMERALD);

    this.y = this.hRule(this.y, fw, 1.5, C.SAGE);
    this.y += sp(1, fs);

    d.setFont(F.Bi, hs("italic"));
    d.setFontSize(8 * fs);
    d.setTextColor(...C.MUTED);
    d.text(`"${trunc(stripMd(q.stem), 80)}"`, x, this.y);
    this.y += sp(3, fs);

    if (q.correct >= 0 && q.correct < q.choices.length) {
      this.y = this.correctBadge(LETTERS[q.correct], q.choices[q.correct], this.y, fw, fs);
    }

    if (q.explanation && showExpl) {
      this.y += sp(1, fs);
      this.y = this.text(q.explanation, x + 2, this.y, {
        font: "times", size: 9.5 * fs, color: C.CHARCOAL, maxW: fw - 8,
      });
      this.y += sp(2, fs);
    }

    this.y = this.hRule(this.y, fw, 0.4, C.MINT_RULE);
    this.y += sp(3, fs);
  }

  // ── Score summary ──

  drawScoreSummary(score: ScoreSummaryData, fs = 1.0): void {
    const d = this.doc;
    const fw = this.L.fw;
    const x = this.L.ms;

    this.checkPage(60);

    const cardH = 50;
    d.setFillColor(...C.PALE_GRAY);
    d.setDrawColor(...C.RULE_GRAY);
    d.setLineWidth(0.4);
    d.roundedRect(x, this.y, fw, cardH, 2, 2, "FD");

    const colW = fw / 3;
    const midX = x + colW;
    const rightX = x + 2 * colW;

    d.setDrawColor(...C.RULE_GRAY);
    d.setLineWidth(0.3);
    d.line(midX, this.y + 4, midX, this.y + cardH - 4);
    d.line(rightX, this.y + 4, rightX, this.y + cardH - 4);

    // Col 1: Score
    let cx = x + colW / 2;
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7);
    d.setTextColor(...C.MUTED);
    d.text("YOUR SCORE", cx, this.y + 10, { align: "center" });

    const scoreCol: RGB = score.pct >= 70 ? C.EMERALD : score.pct >= 50 ? C.GOLD : [180, 50, 50];
    d.setFont(F.H, hs("bold"));
    d.setFontSize(28);
    d.setTextColor(...scoreCol);
    d.text(`${score.pct}%`, cx, this.y + 26, { align: "center" });

    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7);
    d.setTextColor(...C.MUTED);
    d.text(`${score.correct} of ${score.total} correct`, cx, this.y + 35, { align: "center" });

    // Col 2: Percentile
    cx = midX + colW / 2;
    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7);
    d.setTextColor(...C.MUTED);
    d.text("PERCENTILE RANK", cx, this.y + 10, { align: "center" });

    d.setFont(F.H, hs("bold"));
    d.setFontSize(28);
    d.setTextColor(...C.ROYAL);
    d.text(`${score.percentile}`, cx, this.y + 26, { align: "center" });

    d.setFont(F.Hn, hs("normal"));
    d.setFontSize(7);
    d.setTextColor(...C.MUTED);
    d.text("th", cx + 14, this.y + 22);
    d.text(`Higher than ${score.percentile}%`, cx, this.y + 35, { align: "center" });

    // Col 3: Stats
    cx = rightX + colW / 2;
    const stats: [string, string][] = [
      ["Answered", `${score.answered}/${score.total}`],
      ["Incorrect", `${score.incorrect}`],
      ["Flagged", `${score.flagged}`],
      ["Total Time", score.totalTime],
      ["Avg / Q", score.avgTime],
    ];
    let sy = this.y + 8;
    for (const [label, value] of stats) {
      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(6.5);
      d.setTextColor(...C.MUTED);
      d.text(label, rightX + 6, sy);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(7);
      d.setTextColor(...C.CHARCOAL);
      d.text(value, rightX + colW - 6, sy, { align: "right" });
      sy += 7;
    }

    this.y += cardH + sp(3, fs);

    // Distribution bar
    this.checkPage(20);
    d.setFont(F.H, hs("bold"));
    d.setFontSize(9);
    d.setTextColor(...C.CHARCOAL);
    d.text("Score Distribution", x, this.y);
    this.y += sp(3, fs);

    const barH = 4;
    const tot = score.total || 1;
    const correctW = (score.correct / tot) * fw;
    const incorrectW = (score.incorrect / tot) * fw;

    d.setFillColor(...C.PALE_GRAY);
    d.roundedRect(x, this.y, fw, barH, 1.5, 1.5, "F");

    if (correctW > 0) {
      d.setFillColor(...C.ROYAL);
      d.roundedRect(x, this.y, correctW, barH, 1.5, 1.5, "F");
    }
    if (incorrectW > 0) {
      d.setFillColor(180, 50, 50);
      d.rect(x + correctW, this.y, incorrectW, barH, "F");
    }

    this.y += barH + sp(2, fs);

    d.setFontSize(6.5);
    const legends: [string, RGB][] = [["Correct", C.ROYAL], ["Incorrect", [180, 50, 50]], ["Unanswered", C.MUTED]];
    let lx = x;
    for (const [label, col] of legends) {
      d.setFillColor(...col);
      d.circle(lx + 2, this.y - 1, 1.5, "F");
      d.setTextColor(...C.MUTED);
      d.text(label, lx + 5, this.y);
      lx += d.getTextWidth(label) + 12;
    }
    this.y += sp(4, fs);
  }

  // ── Question review list ──

  drawQuestionReview(questions: QuestionReviewItem[], fs = 1.0): void {
    const d = this.doc;

    this.checkPage(16);
    d.setFont(F.H, hs("bold"));
    d.setFontSize(11);
    d.setTextColor(...C.CHARCOAL);
    d.text("Question Review", this.L.ms, this.y);
    this.y += sp(4, fs);

    for (const q of questions) {
      this.checkPage(12);

      const rowH = 9;
      const isCorrect = q.correct;
      const isUnanswered = q.unanswered;

      const badgeBg: RGB = isCorrect ? [235, 243, 250] : isUnanswered ? [240, 243, 246] : [252, 235, 235];
      const badgeFg: RGB = isCorrect ? C.ROYAL : isUnanswered ? C.MUTED : [180, 50, 50];
      d.setFillColor(...badgeBg);
      d.circle(this.L.ms + 4, this.y - 2, 3.5, "F");

      d.setFont(F.H, hs("bold"));
      d.setFontSize(6.5);
      d.setTextColor(...badgeFg);
      const badgeText = isUnanswered ? String(q.num) : isCorrect ? "[X]" : "[ ]";
      d.text(badgeText, this.L.ms + 4, this.y - 0.5, { align: "center" });

      d.setFont(F.B, hs("normal"));
      d.setFontSize(7.5);
      d.setTextColor(...C.CHARCOAL);
      const textLines: string[] = d.splitTextToSize(stripMd(q.stem), this.L.fw - 16);
      d.text(textLines.slice(0, 2), this.L.ms + 12, this.y);
      this.y += rowH;
    }
    this.y += sp(2, fs);
  }
}

// ═══════════════════════════════════════════════════════════════
// § 7  PUBLIC TYPES
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
  styleMode: "standard" | "styled" | "compact" | "detailed" | "mcqnotes";
  answersMode: "inline" | "endchapter" | "endbook" | "none";
  showExplanations: boolean;
  twoCol: boolean;
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
// § 8  FULL QUIZ COMPILATION EXPORT  —  with hyperlinked TOC
// ═══════════════════════════════════════════════════════════════

export function generateQuizCompilationPdf(cfg: PdfExportConfig): jsPDF {
  const isCompact = cfg.styleMode === "compact";
  const doc = new PdfDoc(cfg.page, cfg.cover.title, isCompact);
  const L = doc.L;
  const multiChapter = cfg.chapters.length > 1;
  const totalQ = cfg.chapters.reduce((a, ch) => a + ch.questions.length, 0);

  // ── Cover ──
  if (cfg.includeCover) {
    doc.drawCover(cfg.cover, totalQ, cfg.chapters.length, L.fs);
    doc.newPage(true);
  }

  // ── TOC ──
  if (multiChapter && cfg.includeCover) {
    doc.setHeader("CONTENTS", C.NAVY, C.HEADER_FG.contents);
    doc.y = L.mt;
    doc.drawChrome();

    doc.doc.setFont(F.H, hs("bold"));
    doc.doc.setFontSize(20);
    doc.doc.setTextColor(...C.CHARCOAL);
    doc.doc.text("Table of Contents", L.ms, doc.y);
    doc.y += sp(4, L.fs);
    doc.y = doc.doubleRule(doc.y, L.fw);
    doc.y += sp(2, L.fs);

    // First pass to record chapter page numbers
    // Each chapter starts after TOC + previous chapters
    // We approximate: first chapter starts on the next page
    cfg.chapters.forEach((_ch, i) => {
      const targetPage = doc.page + 1 + i; // TOC occupies current page
      doc.drawTocEntry(
        i + 1, _ch.title, _ch.questions.length, _ch.description ?? "",
        targetPage, L.fs,
      );
    });
    doc.newPage();
  }

  // ── Chapters ──
  doc.setHeader("QUESTIONS", C.COBALT, C.HEADER_FG.questions);
  doc.colX = L.ms;
  doc.y = L.mt;
  doc.drawChrome();

  let globalQ = 0;
  const allAnswers: Array<{ num: number; q: FullQuestion; globalNum: number }> = [];
  const drawOpts: QuestionDrawOpts = {
    answersMode: cfg.answersMode,
    showExplanations: cfg.answersMode === "inline" ? cfg.showExplanations : false,
    styleMode: cfg.styleMode,
    twoCol: cfg.twoCol,
  };

  cfg.chapters.forEach((ch, ci) => {
    if (ci > 0) doc.newPage();
    doc.drawChapterHeader(ci + 1, ch.title, ch.description ?? "", !multiChapter, L.fs);

    for (const q of ch.questions) {
      globalQ++;
      if (cfg.styleMode === "mcqnotes") {
        doc.drawMcqnotesQuestion(q, globalQ, drawOpts, L.fs);
      } else {
        doc.drawQuestion(q, globalQ, drawOpts, L.fs);
      }
      if (cfg.answersMode !== "inline" && cfg.answersMode !== "none" && !q.isWritten) {
        allAnswers.push({ num: globalQ, q, globalNum: globalQ });
      }
    }

    // End-of-chapter answer key
    if (cfg.answersMode === "endchapter" && allAnswers.length > 0) {
      const chapterAnswers = allAnswers.splice(0);
      doc.newPage();
      doc.setHeader("ANSWER KEY", C.EMERALD, C.HEADER_FG.answers);
      doc.y = L.mt;
      doc.drawChrome();
      doc.drawAnswerKeyBanner(`CHAPTER ${ci + 1} - ANSWER KEY`, L.fs);
      for (const entry of chapterAnswers) {
        doc.drawAnswerBlock(entry.q, entry.num, cfg.showExplanations, L.fs);
      }
      doc.setHeader("QUESTIONS", C.COBALT, C.HEADER_FG.questions);
    }
  });

  // ── End-of-book answer key ──
  if (cfg.answersMode === "endbook" && allAnswers.length > 0) {
    doc.newPage();
    doc.setHeader("ANSWER KEY", C.EMERALD, C.HEADER_FG.answers);
    doc.y = L.mt;
    doc.drawChrome();
    doc.drawAnswerKeyBanner("COMPLETE ANSWER KEY", L.fs);
    for (const entry of allAnswers) {
      doc.drawAnswerBlock(entry.q, entry.num, cfg.showExplanations, L.fs);
    }
  }

  doc.drawChrome();
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 9  RESULTS VIEW PDF
// ═══════════════════════════════════════════════════════════════

export function generateResultsPdf(cfg: ResultsPdfConfig): jsPDF {
  const isCompact = cfg.opts.styleMode === "compact";
  const doc = new PdfDoc(cfg.opts.page, cfg.packTitle, isCompact);
  const L = doc.L;
  const opts = cfg.opts;

  // ── Cover ──
  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || cfg.packTitle,
        subtitle: opts.subtitle || `${cfg.mode === "timed" ? "Timed" : "Tutor"} Mode - ${cfg.score.total} Questions`,
        eyebrow: "T E S T   R E S U L T S",
        author: opts.author,
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        features: [
          "Score Analysis & Percentile Rank",
          opts.answersMode === "inline" ? "Inline Answer Key with Explanations" :
          opts.answersMode === "endbook" ? "Complete Answer Key at End" :
          opts.answersMode === "endchapter" ? "Per-Chapter Answer Keys" : "Question Review",
          "Performance Statistics",
        ],
      },
      cfg.score.total, 1, L.fs
    );
    doc.newPage(true);
  }

  // ── Content pages ──
  doc.setHeader("QUESTIONS", C.COBALT, C.HEADER_FG.questions);
  doc.colX = L.ms;
  doc.y = L.mt;
  doc.drawChrome();

  doc.drawScoreSummary(cfg.score, L.fs);

  const allAnswers: Array<{ num: number; q: FullQuestion }> = [];

  const setupTwoCol = (leftCol = true) => {
    if (opts.twoCol) {
      doc.colX = leftCol ? L.ms : L.ms + L.cw + L.gu;
    } else {
      doc.colX = L.ms;
    }
  };

  // Questions
  if (opts.answersMode === "inline" || opts.answersMode === "none") {
    const drawOpts: QuestionDrawOpts = {
      answersMode: opts.answersMode,
      showExplanations: opts.showExplanations,
      styleMode: opts.styleMode,
      twoCol: opts.twoCol,
    };
    setupTwoCol(true);
    cfg.questions.forEach((q, i) => {
      if (opts.twoCol) doc.checkPage(20);
      if (opts.styleMode === "mcqnotes") {
        doc.drawMcqnotesQuestion(q, i + 1, drawOpts, L.fs);
      } else {
        doc.drawQuestion(q, i + 1, drawOpts, L.fs);
      }
    });
  } else {
    const drawOpts: QuestionDrawOpts = {
      answersMode: opts.answersMode,
      showExplanations: false,
      styleMode: opts.styleMode,
      twoCol: opts.twoCol,
    };
    setupTwoCol(true);
    cfg.questions.forEach((q, i) => {
      if (opts.twoCol) doc.checkPage(20);
      if (opts.styleMode === "mcqnotes") {
        doc.drawMcqnotesQuestion(q, i + 1, drawOpts, L.fs);
      } else {
        doc.drawQuestion(q, i + 1, drawOpts, L.fs);
      }
      if (!q.isWritten) allAnswers.push({ num: i + 1, q });
    });
  }

  // ── Answer key section ──
  if (allAnswers.length > 0 && opts.answersMode !== "inline" && opts.answersMode !== "none") {
    doc.newPage();
    doc.setHeader("ANSWER KEY", C.EMERALD, C.HEADER_FG.answers);
    doc.colX = L.ms;
    doc.y = L.mt;
    doc.drawChrome();
    doc.drawAnswerKeyBanner(
      opts.answersMode === "endchapter" ? "ANSWER KEY" : "COMPLETE ANSWER KEY",
      L.fs
    );
    for (const entry of allAnswers) {
      doc.drawAnswerBlock(entry.q, entry.num, opts.showExplanations, L.fs);
    }
  }

  // ── Question review list ──
  doc.newPage();
  doc.setHeader("QUESTIONS", C.COBALT, C.HEADER_FG.questions);
  doc.colX = L.ms;
  doc.y = L.mt;
  doc.drawChrome();

  const reviewItems: QuestionReviewItem[] = cfg.questions.map((q, i) => {
    const ans = cfg.userAnswers[i];
    const isSubmitted = !!cfg.revealed[i];
    const isMCQ = q.correct >= 0;
    const isCorrect = isMCQ
      ? isSubmitted && ans === q.correct
      : false;
    return {
      num: i + 1,
      stem: q.stem,
      correct: !!isCorrect,
      unanswered: !isSubmitted,
    };
  });
  doc.drawQuestionReview(reviewItems, L.fs);

  doc.drawChrome();
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 10  DASHBOARD PERFORMANCE REPORT
// ═══════════════════════════════════════════════════════════════

export function generateDashboardPdf(cfg: DashboardPdfConfig): jsPDF {
  const isCompact = cfg.opts.styleMode === "compact";
  const opts = cfg.opts;
  const doc = new PdfDoc(cfg.opts.page, opts.title || "Performance Report", isCompact);
  const L = doc.L;

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || `${cfg.username}'s Progress`,
        subtitle: opts.subtitle || "Comprehensive Performance Report",
        eyebrow: "P E R F O R M A N C E   R E P O R T",
        author: opts.author || cfg.username,
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        features: ["Overall Accuracy & Progress", "Pack-by-Pack Breakdown", "Study Statistics"],
        footerNote: "Generated by Osler",
      },
      cfg.stats.attempted, cfg.stats.packs, L.fs
    );
    doc.newPage(true);
  }

  doc.setHeader("PERFORMANCE", C.COBALT, C.HEADER_FG.questions);
  doc.y = L.mt;
  doc.drawChrome();

  doc.drawScoreSummary({
    pct: cfg.stats.accuracy,
    correct: cfg.stats.correct,
    total: cfg.stats.attempted,
    answered: cfg.stats.attempted,
    incorrect: cfg.stats.attempted - cfg.stats.correct,
    flagged: 0,
    percentile: Math.min(99, Math.max(1, Math.round(cfg.stats.accuracy * 0.9 + 5))),
    totalTime: "-",
    avgTime: "-",
  }, L.fs);

  if (cfg.recentPacks.length > 0) {
    const d = doc.doc;
    doc.checkPage(16);
    d.setFont(F.H, hs("bold"));
    d.setFontSize(11);
    d.setTextColor(...C.CHARCOAL);
    d.text("Pack Breakdown", L.ms, doc.y);
    doc.y += sp(4, L.fs);

    for (const pack of cfg.recentPacks) {
      doc.checkPage(18);
      const rowY = doc.y;
      const acc = pack.attempted > 0 ? Math.round((pack.correct / pack.attempted) * 100) : 0;

      d.setFillColor(...C.PALE_BLUE);
      d.roundedRect(L.ms, rowY - 3, 24, 7, 1, 1, "F");
      d.setFont(F.H, hs("bold"));
      d.setFontSize(6);
      d.setTextColor(...C.ROYAL);
      d.text(pack.engine.toUpperCase(), L.ms + 12, rowY + 0.5, { align: "center" });

      d.setFont(F.H, hs("bold"));
      d.setFontSize(9);
      d.setTextColor(...C.CHARCOAL);
      d.text(trunc(pack.title, 45), L.ms + 28, rowY);
      if (pack.lastAttempt) {
        d.setFont(F.Hn, hs("normal"));
        d.setFontSize(7);
        d.setTextColor(...C.MUTED);
        d.text(new Date(pack.lastAttempt).toLocaleDateString(), L.ms + L.fw, rowY, { align: "right" });
      }

      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(7);
      d.setTextColor(...C.MUTED);
      d.text(`${pack.attempted} attempted - ${pack.correct} correct - ${acc}%`, L.ms + 28, rowY + 5);

      const barY = rowY + 8;
      const barW = L.fw - 28;
      d.setFillColor(...C.PALE_GRAY);
      d.roundedRect(L.ms + 28, barY, barW, 2.5, 1, 1, "F");
      if (pack.attempted > 0) {
        d.setFillColor(...C.ROYAL);
        d.roundedRect(L.ms + 28, barY, (pack.correct / pack.attempted) * barW, 2.5, 1, 1, "F");
      }

      doc.y = barY + sp(4, L.fs);
      doc.y = doc.hRule(doc.y, L.fw, 0.25);
      doc.y += sp(1, L.fs);
    }
  }

  doc.drawChrome();
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 11  LIBRARY ARTICLE PDF  —  with HTML content handling
// ═══════════════════════════════════════════════════════════════

export function generateArticlePdf(cfg: ArticlePdfConfig): jsPDF {
  const doc = new PdfDoc(cfg.opts.page, cfg.title, cfg.opts.styleMode === "compact");
  const L = doc.L;
  const opts = cfg.opts;

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: cfg.title,
        subtitle: cfg.subtitle,
        eyebrow: "L I B R A R Y   A R T I C L E",
        author: opts.author || cfg.author,
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        features: ["Printed from Osler Library"],
      },
      0, 0, L.fs
    );
    doc.newPage(true);
  }

  doc.setHeader("ARTICLE", C.COBALT, C.HEADER_FG.questions);
  doc.y = L.mt;
  doc.drawChrome();

  const d = doc.doc;
  const x = L.ms;
  const fw = L.fw;

  // Title
  d.setFont(F.H, hs("bold"));
  d.setFontSize(16);
  d.setTextColor(...C.CHARCOAL);
  const titleLines: string[] = d.splitTextToSize(cfg.title, fw);
  d.text(titleLines, x, doc.y);
  doc.y += titleLines.length * lh(16) + sp(3, L.fs);

  // Metadata line
  const metaParts: string[] = [];
  if (cfg.author) metaParts.push(cfg.author);
  metaParts.push(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));
  d.setFont(F.Hn, hs("normal"));
  d.setFontSize(8);
  d.setTextColor(...C.MUTED);
  d.text(metaParts.join("  -  "), x, doc.y);
  doc.y += sp(3, L.fs);

  doc.y = doc.hRule(doc.y, fw, 0.5, C.RULE_GRAY);
  doc.y += sp(3, L.fs);

  // Body — strip HTML and parse into paragraphs
  const plainText = stripHtml(cfg.content);
  const paragraphs = plainText.split(/\n{2,}/).filter(p => p.trim());

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Detect HTML-style headings or markdown headings or ALL-CAPS
    const htmlH = detectHtmlHeading(trimmed);
    const isMdH2 = /^##\s/.test(trimmed);
    const isMdH3 = /^###\s/.test(trimmed);
    const isAllCaps = /^[A-Z][A-Z\s]{3,}$/.test(trimmed) && trimmed.length < 80;

    if (htmlH && htmlH.level === 2) {
      doc.checkPage(16);
      doc.y += sp(2, L.fs);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(13);
      d.setTextColor(...C.CHARCOAL);
      const hLines: string[] = d.splitTextToSize(htmlH.text, fw);
      d.text(hLines, x, doc.y);
      doc.y += hLines.length * lh(13) + sp(1, L.fs);
      doc.y = doc.hRule(doc.y, fw, 0.5, C.GOLD);
      doc.y += sp(2, L.fs);
    } else if (htmlH && htmlH.level === 3) {
      doc.checkPage(12);
      doc.y += sp(1, L.fs);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(11);
      d.setTextColor(...C.COBALT);
      const hLines: string[] = d.splitTextToSize(htmlH.text, fw);
      d.text(hLines, x, doc.y);
      doc.y += hLines.length * lh(11) + sp(2, L.fs);
    } else if (isMdH2) {
      doc.checkPage(16);
      doc.y += sp(2, L.fs);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(13);
      d.setTextColor(...C.CHARCOAL);
      const hLines: string[] = d.splitTextToSize(trimmed.replace(/^##\s+/, ""), fw);
      d.text(hLines, x, doc.y);
      doc.y += hLines.length * lh(13) + sp(1, L.fs);
      doc.y = doc.hRule(doc.y, fw, 0.5, C.GOLD);
      doc.y += sp(2, L.fs);
    } else if (isMdH3) {
      doc.checkPage(12);
      doc.y += sp(1, L.fs);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(11);
      d.setTextColor(...C.COBALT);
      d.text(trimmed.replace(/^###\s+/, ""), x, doc.y);
      doc.y += lh(11) + sp(2, L.fs);
    } else if (isAllCaps) {
      doc.checkPage(16);
      doc.y += sp(2, L.fs);
      d.setFont(F.H, hs("bold"));
      d.setFontSize(12);
      d.setTextColor(...C.CHARCOAL);
      d.text(trimmed, x, doc.y);
      doc.y += lh(12) + sp(2, L.fs);
      doc.y = doc.hRule(doc.y, fw, 0.3);
      doc.y += sp(2, L.fs);
    } else {
      doc.checkPage(10);
      d.setFont(F.B, hs("normal"));
      d.setFontSize(9.5);
      d.setTextColor(...C.CHARCOAL);
      const bodyLines: string[] = d.splitTextToSize(stripMd(trimmed), fw - 4);
      d.text(bodyLines, x + 2, doc.y);
      doc.y += bodyLines.length * lh(9.5) + sp(2, L.fs);
    }
  }

  doc.drawChrome();
  return doc.doc;
}

// ═══════════════════════════════════════════════════════════════
// § 12  DOWNLOAD HELPER
// ═══════════════════════════════════════════════════════════════

export function downloadPdf(doc: jsPDF, filename: string): void {
  const safeName = filename.replace(/[^a-zA-Z0-9\s\-_.]/g, "").trim() || "export";
  doc.save(`${safeName}.pdf`);
}
