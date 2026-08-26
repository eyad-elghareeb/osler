/**
 * Library article generator — DOM-based renderer that mirrors the print
 * view: typed blocks (headings, rich runs, nested lists, quotes, code,
 * tables, images, hr) parsed from the article's rendered HTML.
 */
import type { jsPDF } from "jspdf";
import { hasArabic } from "@/lib/osler/arabic";
import { C, type RGB } from "../tokens";
import { lh, sp } from "../layout";
import { F, hs } from "../fonts";
import { normalizeText, stripHtml, stripMd, tlabel } from "../text";
import { PdfDoc } from "../doc";
import type { ArticlePdfConfig } from "../types";

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
  // Compact editorial leading — 1.5 read as double-spaced next to the UI.
  const lineH = lh(px, 1.36);
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
    doc.y += titleLines.length * lh(17 * ts, titleIsAr ? 1.2 : 1.25) + sp(1.2, density);
  }

  const metaParts: string[] = [];
  if (cfg.author) metaParts.push(cfg.author);
  metaParts.push(doc.formatToday());
  d.setFont(F.Hn, hs("normal"));
  d.setFontSize(8 * ts);
  d.setTextColor(...C.MUTED);
  d.text(tlabel(metaParts.join("   ·   ")), x, doc.y);
  doc.y += sp(1, density);

  doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
  doc.y += sp(1.4, density);

  const blocks = parseArticleBlocks(cfg.content);

  // Render blocks — DOM-derived structure mirrors the print view.
  for (const block of blocks) {
    switch (block.type) {
      case "h": {
        const style = { 2: { size: 14, font: F.H, color: C.INK, rule: true }, 3: { size: 11.5, font: F.H, color: C.COBALT, rule: false }, 4: { size: 10.4, font: F.Hm, color: C.SLATE, rule: false } }[block.level];
        doc.checkPage(sp(style.size * 0.55, density));
        doc.y += sp(1, density);
        const hText = normalizeText(block.runs.map((r) => r.text).join("").trim());
        const hIsAr = hasArabic(hText);
        d.setFont(hIsAr ? "Cairo" : style.font, hs("bold"));
        d.setFontSize(style.size * ts);
        d.setTextColor(...style.color);
        const hLines: string[] = d.splitTextToSize(hText, fw);
        if (hIsAr) d.text(hLines, x + fw, doc.y, { align: "right" });
        else d.text(hLines, x, doc.y);
        doc.y += hLines.length * lh(style.size * ts, hIsAr ? 1.2 : 1.3);
        if (style.rule) {
          doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
          doc.y += sp(0.7, density);
        } else {
          doc.y += sp(0.8, density);
        }
        break;
      }
      case "p": {
        doc.checkPage(sp(3, density));
        renderRichParagraph(doc, block.runs, x, fw, 10, C.CHARCOAL);
        doc.y += sp(1, density);
        break;
      }
      case "list": {
        doc.checkPage(sp(4, density));
        doc.y += sp(0.3, density);
        block.items.forEach((item, i) => {
          const itemIsAr = item.runs.some((r) => hasArabic(r.text));
          const indent = 4 + item.depth * 4;
          const marker = block.ordered ? `${i + 1}.` : "\u2022";
          d.setFont(itemIsAr ? "Cairo" : F.Hm, hs("normal"));
          d.setFontSize(8.8 * ts);
          d.setTextColor(...C.COBALT);
          const markerW = d.getTextWidth(marker) + 2;
          // Reserve room for at least two body lines so a marker is never
          // stranded at a column/page bottom.
          doc.checkPage(lh(10 * ts, 1.36) * 2);
          if (itemIsAr) {
            d.text(marker, x + fw - indent, doc.y, { align: "right" });
            renderRichParagraph(doc, item.runs, x, fw - indent - markerW, 10, C.CHARCOAL);
          } else {
            d.text(marker, x + indent, doc.y);
            renderRichParagraph(doc, item.runs, x + indent + markerW, fw - indent - markerW - 2, 10, C.CHARCOAL);
          }
          doc.y += sp(0.45, density);
        });
        doc.y += sp(1.1, density);
        break;
      }
      case "quote": {
        doc.checkPage(sp(5, density));
        doc.y += sp(0.3, density);
        renderRichParagraph(doc, [{ text: stripMd(block.text) }], x + 5, fw - 7, 9.4, C.SLATE, {
          barColor: C.COBALT,
          italicAll: !hasArabic(block.text),
        });
        doc.y += sp(1.1, density);
        break;
      }
      case "code": {
        const codeLineH = lh(8.2 * ts, 1.35);
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
          d.setFontSize(8.2 * ts);
          d.setTextColor(...C.CHARCOAL);
          d.text(chunk, x + 5, doc.y + 2.8);
          doc.y += panelH + sp(0.4, density);
          li += chunk.length;
        }
        doc.y += sp(1.1, density);
        break;
      }
      case "image": {
        const img = await fetchImageDataUrl(block.src);
        if (!img || img.w === 0 || img.h === 0) break;
        const sc = Math.min((fw - 10) / img.w, (L.ph * 0.45) / img.h, 1);
        const drawW = img.w * sc;
        const drawH = img.h * sc;
        doc.checkPage(drawH + 8);
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
          d.setFontSize(8 * ts);
          d.setTextColor(...C.MUTED);
          const capLines: string[] = d.splitTextToSize(normalizeText(stripMd(block.alt)), fw - 20);
          if (altIsAr) d.text(capLines, x + fw, doc.y, { align: "right" });
          else d.text(capLines, x + fw / 2, doc.y, { align: "center" });
          doc.y += capLines.length * lh(8 * ts);
        }
        doc.y += sp(1.2, density);
        break;
      }
      case "table": {
        doc.checkPage(sp(8, density));
        doc.y += sp(0.6, density);
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
          doc.y += sp(1.1, density);
        }
        break;
      }
      case "hr": {
        doc.checkPage(sp(3, density));
        doc.y += sp(0.6, density);
        doc.y = doc.hRule(doc.y, fw, 0.4, C.RULE);
        doc.y += sp(0.6, density);
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

