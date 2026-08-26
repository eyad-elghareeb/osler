/**
 * PDF design tokens — the single source of truth for every color, tint,
 * accent theme, and color helper in the PDF engine. Never hardcode a
 * palette value in a drawing file; import it from here.
 */

/** RGB triple in 0–255 components — the PDF engine's color unit. */
export type RGB = [number, number, number];

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

export type SectionKey = keyof typeof C.SECTION;

/**
 * Each export family carries its own subtle cover/accent palette so a
 * printed stack is identifiable at a glance:
 *   · content — quiz booklets & packs (navy + gold, the classic Osler look)
 *   · session — session results & performance reports (indigo + champagne)
 *   · article — library article exports (wine + rose gold)
 */
export type PdfDocTheme = "content" | "session" | "article";

export interface ThemePalette {
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

export const DOC_THEMES: Record<PdfDocTheme, ThemePalette> = {
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

export function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

