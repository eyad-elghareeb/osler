/**
 * PdfDoc — the stateful page/chrome/content model shared by every PDF
 * generator: page flow with real two-column support, running header/footer
 * chrome, covers, TOC entries, question rendering, answer keys, score
 * summary and review lists. One class, one concern: putting structured
 * content onto paginated, chrome-wrapped pages.
 */
import { jsPDF } from "jspdf";
import { registerPdfFonts } from "../pdf-fonts";
import { bidiReorder, fallbackArabicPres, hasArabic, shapeArabicLetters } from "@/lib/osler/arabic";
import type { StringKey } from "@/lib/osler/i18n";
import { C, DOC_THEMES, lerp, type PdfDocTheme, type RGB, type SectionKey, type ThemePalette } from "./tokens";
import { computeLayout, lh, sp, type Layout, type PdfPageConfig, type StyleMode } from "./layout";
import { LETTERS, clamp, makeT, normalizeText, ordinalSuffix, stripMd, tracked, tlabel, trunc } from "./text";
import { F, hs, resolveFonts } from "./fonts";
import { drawCheck, drawCross, drawPulseMark } from "./icons";
import type {
  CoverConfig,
  FullQuestion,
  PdfLang,
  QuestionDrawOpts,
  QuestionReviewItem,
  ScoreSummaryData,
} from "./types";

export class PdfDoc {
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

