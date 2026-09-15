/**
 * EPUB rendition theming — the book's own stylesheets are the publisher's,
 * so every rule here is a `!important` override that maps the *live* Osler
 * design tokens onto the section iframes. Palette values are read from the
 * CSS custom properties at runtime (never hardcoded), which is why the book
 * follows the app theme — including themes the user installs from
 * `osler.config.json`.
 *
 * Two problems this fixes:
 *   · a publisher `body { background: #fff }` used to leave near-white text
 *     on a white page in dark mode (invisible text) — the body background is
 *     now pinned to the app background;
 *   · table cells inherit the publisher's colors, so a striped/grey cell
 *     rendered dark-on-dark or light-on-light — text and border colors are
 *     pinned to the theme's foreground/border.
 */

import { EPUB_HIGHLIGHT_OPACITY } from "./tokens";
import { HIGHLIGHT_PALETTE, isHighlightColorKey } from "@/lib/osler/highlight-palette";
import type { EpubReaderLayout } from "./types";

export interface EpubThemePalette {
  /** Page background (`--background`). */
  bg: string;
  /** Body text (`--foreground`). */
  fg: string;
  /** Secondary text (`--muted-foreground`). */
  muted: string;
  /** Links / accents (`--primary`). */
  primary: string;
  /** Hairlines (`--border`). */
  border: string;
  /** Editorial body stack (`--font-serif`). */
  serif: string;
  dark: boolean;
}

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** Live app palette for the rendition (theme-aware, never hardcoded). */
export function readThemePalette(): EpubThemePalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--background", "#ffffff"),
    fg: v("--foreground", "#111827"),
    muted: v("--muted-foreground", "#6b7280"),
    primary: v("--primary", "#1d4ed8"),
    border: v("--border", "#e5e7eb"),
    serif: v("--font-serif", "Georgia, serif"),
    dark: isDarkTheme(),
  };
}

/** Colors applied inside every section document. */
export function buildThemeRules(p: EpubThemePalette): Record<string, Record<string, string>> {
  return {
    html: { "background-color": `${p.bg} !important` },
    body: { "background-color": `${p.bg} !important`, color: `${p.fg} !important` },
    "h1, h2, h3, h4, h5, h6, p, li, dd, dt, figcaption, span, div, em, strong, i, b, u, s, sub, sup, cite, q, time, label":
      { color: `${p.fg} !important` },
    "blockquote, small, caption": { color: `${p.muted} !important` },
    a: { color: `${p.primary} !important` },
    // Tables: pin text + hairlines to the theme and drop publisher cell
    // fills, which are the usual cause of unreadable dark-mode tables.
    "table, thead, tbody, tfoot, tr, th, td": {
      color: `${p.fg} !important`,
      "background-color": "transparent !important",
      "border-color": `${p.border} !important`,
    },
    "th": { color: `${p.fg} !important`, "font-weight": "600 !important" },
    hr: { "background-color": `${p.border} !important`, "border-color": `${p.border} !important` },
    "pre, code, kbd, samp": { color: `${p.fg} !important`, "background-color": "transparent !important" },
    "img, svg, video": { "background-color": "transparent !important" },
  };
}

/** Typography + overflow rules, re-applied whenever the display prefs change. */
export function buildLayoutRules(layout: EpubReaderLayout, p: EpubThemePalette): Record<string, Record<string, string>> {
  return {
    html: { "-webkit-text-size-adjust": "100% !important" },
    body: {
      "line-height": `${layout.lineHeight} !important`,
      "font-family": `${layout.fontFamily ?? p.serif} !important`,
      "max-width": `${layout.maxWidth}px !important`,
      margin: "0 auto !important",
      padding: "0 6px !important",
      "word-wrap": "break-word !important",
    },
    img: { "max-width": "100% !important", height: "auto !important" },
    svg: { "max-width": "100% !important", height: "auto !important" },
    // Wide tables and long code lines must scroll, not blow out the column.
    table: { "max-width": "100% !important", "border-collapse": "collapse !important" },
    pre: { "white-space": "pre-wrap !important", "word-wrap": "break-word !important", "overflow-x": "auto !important" },
  };
}

/**
 * SVG presentation attributes for one highlight rect.
 *
 * epubjs defaults to `mix-blend-mode: multiply`, which all but disappears on
 * a dark page, so the blend mode is pinned to normal and the pastel swatch
 * carries the tint on both themes.
 */
export function epubHighlightStyles(colorKey: string): Record<string, string> {
  const swatch = isHighlightColorKey(colorKey) ? HIGHLIGHT_PALETTE[colorKey].light : colorKey;
  return {
    fill: /^#[0-9a-fA-F]{3,8}$/.test(swatch) ? swatch : HIGHLIGHT_PALETTE.yellow.light,
    "fill-opacity": EPUB_HIGHLIGHT_OPACITY,
    "mix-blend-mode": "normal",
  };
}
