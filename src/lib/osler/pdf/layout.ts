/**
 * Page layout & spacing grid — page dimensions, margins, column geometry,
 * the density-scaled spacing helpers (sp/lh), and the style-mode token.
 */
import { clamp } from "./text";

/** Style-mode → spacing density. Font sizes never shrink; whitespace does. */
export type StyleMode = "standard" | "compact" | "mcqnotes";
export const DENSITY: Record<StyleMode, number> = {
  standard: 0.95,
  compact: 0.72,
  mcqnotes: 0.55,
};

/** 4pt base grid, scaled by density (style mode), never by type size. */
export function sp(n: number, density = 1.0): number {
  return Math.round(n * 4 * density * 10) / 10;
}

export function lh(sizePt: number, factor = 1.45): number {
  return sizePt * factor * 0.3528;
}


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

export interface Layout {
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

export function computeLayout(cfg: PdfPageConfig, styleMode: StyleMode, fontSizeOpt?: "small" | "medium" | "large", fontTypeOpt?: "serif" | "sans"): Layout {
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
